-- Durable drafts and non-canonical TUG workflow rows.
-- Apply only after backup and verifier review. Production application is manual.

create table if not exists public.tug_workflow_transactions (
  id text primary key,
  doc_type text not null check (doc_type in ('TUG5','TUG7','TUG8','TUG9')),
  upt_id text,
  uit_id text,
  ultg_id text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  stage text not null default 'DRAFT',
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED')),
  doc_number text,
  doc_sequence bigint,
  version integer not null default 1 check (version > 0),
  parent_workflow_id text references public.tug_workflow_transactions(id) on delete restrict,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tug_workflow_scope_one check (num_nonnulls(upt_id, uit_id) = 1),
  constraint tug_workflow_draft_number check (
    status <> 'DRAFT' or doc_number is null or (data->>'legacyImport') = 'true'
  ),
  constraint tug_workflow_canonical_draft_only check (
    doc_type not in ('TUG8','TUG9') or status = 'DRAFT'
  )
);

create index if not exists tug_workflow_scope_idx
  on public.tug_workflow_transactions (upt_id, uit_id, doc_type, status, updated_at desc);
create index if not exists tug_workflow_creator_idx
  on public.tug_workflow_transactions (created_by, updated_at desc);
create unique index if not exists tug_workflow_parent_unique_idx
  on public.tug_workflow_transactions (parent_workflow_id)
  where parent_workflow_id is not null;

alter table public.tug_workflow_transactions enable row level security;
drop policy if exists "Scoped read tug workflow" on public.tug_workflow_transactions;
create policy "Scoped read tug workflow" on public.tug_workflow_transactions
  for select to authenticated
  using (
    public.can_access_upt(upt_id)
    or exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and actor.uit_id = tug_workflow_transactions.uit_id
        and actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','SUPERADMIN','ADMIN_LOG_PUSAT')
    )
    or exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and actor.ultg_id = tug_workflow_transactions.ultg_id
        and actor.role in ('MGR_ULTG','SUPERADMIN','ADMIN_LOG_PUSAT')
    )
  );

revoke all on public.tug_workflow_transactions from anon, authenticated;
grant select on public.tug_workflow_transactions to authenticated;

create or replace function public.tug_workflow_actor()
returns public.profiles
language sql stable security definer set search_path = public, pg_catalog
as $$ select p from public.profiles p where p.id = auth.uid() $$;

create or replace function public.tug_workflow_scope_allowed(
  p_upt_id text, p_uit_id text, p_ultg_id text
)
returns boolean
language sql stable security definer set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and (
        actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
        or (p_upt_id is not null and p_uit_id is null and public.can_access_upt(p_upt_id))
        or (p_upt_id is not null and p_uit_id is null and actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and exists (select 1 from public.upt u where u.id=p_upt_id and u.uit_id=actor.uit_id))
        or (p_upt_id is not null and p_uit_id is null and actor.role = 'MANAGER' and actor.upt_id = p_upt_id)
        or (p_uit_id is not null and actor.uit_id = p_uit_id and actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT'))
        or (p_ultg_id is not null and actor.ultg_id = p_ultg_id and actor.role = 'MGR_ULTG')
      )
  )
$$;

create or replace function public.tug_workflow_contains_data_url(p_data jsonb)
returns boolean
language sql immutable
as $$ select coalesce(p_data::text ~* 'data:image/[a-z0-9.+-]+;base64,', false) $$;

create or replace function public.save_tug_workflow_transaction(
  p_id text,
  p_doc_type text,
  p_upt_id text,
  p_uit_id text,
  p_ultg_id text,
  p_stage text,
  p_status text,
  p_doc_number text,
  p_doc_sequence bigint,
  p_data jsonb,
  p_expected_version integer default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  a public.profiles;
  old_row public.tug_workflow_transactions;
  new_version integer;
  v_type text := upper(btrim(coalesce(p_doc_type,'')));
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
begin
  select * into a from public.profiles where id = auth.uid();
  if a.id is null then raise exception 'TUG_WORKFLOW_AUTH_REQUIRED'; end if;
  if p_id is null or btrim(p_id) = '' then raise exception 'TUG_WORKFLOW_ID_REQUIRED'; end if;
  if v_type not in ('TUG5','TUG7','TUG8','TUG9') then raise exception 'TUG_WORKFLOW_DOC_TYPE_INVALID'; end if;
  if num_nonnulls(p_upt_id, p_uit_id) <> 1 then raise exception 'TUG_WORKFLOW_SCOPE_INVALID'; end if;
  if not public.tug_workflow_scope_allowed(p_upt_id, p_uit_id, p_ultg_id) then raise exception 'TUG_WORKFLOW_SCOPE_DENIED'; end if;
  if v_type='TUG5' and a.role not in ('ADMIN','TL','ASMAN','ADMIN_ULTG','MANAGER','MGR_ULTG','SUPERADMIN','ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if v_type='TUG7' and a.role not in ('MANAGER','ADMIN_UIT','MGR_LOGISTIK_UIT','SUPERADMIN','ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if v_type in ('TUG8','TUG9') and a.role not in ('ADMIN','TL','ADMIN_UIT','MGR_LOGISTIK_UIT','SUPERADMIN','ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if v_type in ('TUG8','TUG9') and coalesce(p_status,'DRAFT') <> 'DRAFT' then raise exception 'TUG_WORKFLOW_CANONICAL_ONLY_ON_SUBMIT'; end if;
  if public.tug_workflow_contains_data_url(v_data) then raise exception 'TUG_WORKFLOW_DATA_URL_FORBIDDEN'; end if;
  if coalesce(v_data->>'docType', v_type) <> v_type then raise exception 'TUG_WORKFLOW_DOC_TYPE_MISMATCH'; end if;

  select * into old_row from public.tug_workflow_transactions where id = p_id for update;
  if old_row.id is null then
    if p_expected_version is not null then raise exception 'TUG_WORKFLOW_NOT_FOUND'; end if;
    if (p_doc_number is not null or p_doc_sequence is not null) and coalesce(v_data->>'legacyImport','false') <> 'true' then raise exception 'TUG_WORKFLOW_NEW_NUMBER_FORBIDDEN'; end if;
    insert into public.tug_workflow_transactions(id,doc_type,upt_id,uit_id,ultg_id,created_by,stage,status,doc_number,doc_sequence,version,data)
    values (p_id,v_type,p_upt_id,p_uit_id,p_ultg_id,auth.uid(),coalesce(p_stage,'DRAFT'),coalesce(p_status,'DRAFT'),null,null,1,v_data);
    return jsonb_build_object('ok',true,'id',p_id,'version',1,'updatedAt',now());
  end if;

  if p_expected_version is null or old_row.version <> p_expected_version then raise exception 'TUG_WORKFLOW_VERSION_MISMATCH'; end if;
  if old_row.doc_type <> v_type or old_row.upt_id is distinct from p_upt_id or old_row.uit_id is distinct from p_uit_id or old_row.ultg_id is distinct from p_ultg_id then raise exception 'TUG_WORKFLOW_SCOPE_IMMUTABLE'; end if;
  if old_row.stage is distinct from coalesce(p_stage, old_row.stage)
     or old_row.status is distinct from coalesce(p_status, old_row.status) then
    raise exception 'TUG_WORKFLOW_TRANSITION_RPC_REQUIRED';
  end if;
  if old_row.status = 'DRAFT' and p_doc_number is not null and old_row.doc_number is null and coalesce(v_data->>'legacyImport','false') <> 'true' then raise exception 'TUG_WORKFLOW_NUMBER_ONLY_ON_ISSUE'; end if;
  if old_row.created_by <> auth.uid() and a.role not in ('TL','ASMAN','MANAGER','ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','MGR_ULTG','SUPERADMIN','ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_OWNER_REQUIRED'; end if;
  new_version := old_row.version + 1;
  update public.tug_workflow_transactions
     set stage = coalesce(p_stage, stage), status = coalesce(p_status, status),
         doc_number = coalesce(p_doc_number, doc_number), doc_sequence = coalesce(p_doc_sequence, doc_sequence),
         data = v_data, version = new_version, updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok',true,'id',p_id,'version',new_version,'updatedAt',now());
end
$$;

create or replace function public.issue_tug_workflow_document_number(
  p_id text, p_expected_version integer, p_number_upt_id text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare r public.tug_workflow_transactions; a public.profiles; v_seq bigint; v_unit text; v_number text; v_upt text;
begin
  select * into a from public.profiles where id=auth.uid();
  select * into r from public.tug_workflow_transactions where id=p_id for update;
  if r.id is null then raise exception 'TUG_WORKFLOW_NOT_FOUND'; end if;
  if not public.tug_workflow_scope_allowed(r.upt_id,r.uit_id,r.ultg_id) then raise exception 'TUG_WORKFLOW_SCOPE_DENIED'; end if;
  if r.version <> p_expected_version then raise exception 'TUG_WORKFLOW_VERSION_MISMATCH'; end if;
  if r.doc_type not in ('TUG5','TUG7') then raise exception 'TUG_WORKFLOW_NUMBER_DOC_TYPE_INVALID'; end if;
  if (r.doc_type='TUG5' and r.stage not in ('PENDING_ASMAN','PENDING_MGR_ULTG'))
     or (r.doc_type='TUG7' and r.stage <> 'PENDING_MGR_LOGISTIK') then
    raise exception 'TUG_WORKFLOW_NUMBER_STAGE_INVALID';
  end if;
  if (r.doc_type='TUG5' and a.role not in ('ADMIN','TL','ADMIN_ULTG','MANAGER','MGR_ULTG','SUPERADMIN','ADMIN_LOG_PUSAT')) or (r.doc_type='TUG7' and a.role not in ('ADMIN_UIT','MGR_LOGISTIK_UIT','SUPERADMIN','ADMIN_LOG_PUSAT')) then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if r.doc_number is not null then return jsonb_build_object('ok',true,'id',r.id,'version',r.version,'docNumber',r.doc_number,'docSequence',r.doc_sequence); end if;
  v_upt := coalesce(nullif(btrim(p_number_upt_id),''), r.upt_id, nullif(r.data->>'uptPengirimId',''), nullif(r.data->>'uptId',''));
  if v_upt is null then raise exception 'TUG_UPT_REQUIRED'; end if;
  update public.tug_global_document_counters
     set last_value=last_value+1, updated_at=now()
   where upt_id=v_upt
   returning last_value, document_unit_code into v_seq, v_unit;
  if v_seq is null then raise exception 'TUG_DOCUMENT_UNIT_CONFIG_REQUIRED'; end if;
  v_number := public.tug_doc_number(v_seq, r.doc_type, coalesce(v_unit,v_upt), now());
  update public.tug_workflow_transactions
     set doc_number=v_number, doc_sequence=v_seq, version=version+1, updated_at=now()
   where id=r.id;
  return jsonb_build_object('ok',true,'id',r.id,'version',r.version+1,'docNumber',v_number,'docSequence',v_seq);
end
$$;

create or replace function public.delete_tug_workflow_transaction(p_id text, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare r public.tug_workflow_transactions; a public.profiles;
begin
  select * into a from public.profiles where id=auth.uid();
  select * into r from public.tug_workflow_transactions where id=p_id for update;
  if r.id is null then raise exception 'TUG_WORKFLOW_NOT_FOUND'; end if;
  if not public.tug_workflow_scope_allowed(r.upt_id,r.uit_id,r.ultg_id) then raise exception 'TUG_WORKFLOW_SCOPE_DENIED'; end if;
  if r.version <> p_expected_version then raise exception 'TUG_WORKFLOW_VERSION_MISMATCH'; end if;
  if r.doc_type in ('TUG8','TUG9') and r.status <> 'DRAFT' then raise exception 'TUG_WORKFLOW_DELETE_FORBIDDEN'; end if;
  if r.created_by <> auth.uid() and a.role not in ('TL','SUPERADMIN','ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_OWNER_REQUIRED'; end if;
  delete from public.tug_workflow_transactions where id=p_id;
  return jsonb_build_object('ok',true,'id',p_id);
end
$$;

create or replace function public.transition_tug_workflow_transaction(
  p_id text, p_expected_version integer, p_target_stage text, p_target_status text, p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare r public.tug_workflow_transactions; a public.profiles; v_data jsonb; v_seq bigint; v_unit text; v_number text; v_upt text;
begin
  select * into a from public.profiles where id=auth.uid();
  select * into r from public.tug_workflow_transactions where id=p_id for update;
  if r.id is null then raise exception 'TUG_WORKFLOW_NOT_FOUND'; end if;
  if not public.tug_workflow_scope_allowed(r.upt_id,r.uit_id,r.ultg_id) then raise exception 'TUG_WORKFLOW_SCOPE_DENIED'; end if;
  if r.version <> p_expected_version then raise exception 'TUG_WORKFLOW_VERSION_MISMATCH'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or public.tug_workflow_contains_data_url(p_patch) then raise exception 'TUG_WORKFLOW_PATCH_INVALID'; end if;
  if r.doc_type in ('TUG8','TUG9') and coalesce(p_target_status,r.status) <> 'DRAFT' then raise exception 'TUG_WORKFLOW_CANONICAL_ONLY_ON_SUBMIT'; end if;
  if r.doc_type = 'TUG5' and not (
    (r.stage = 'DRAFT' and p_target_stage in ('PENDING_ASMAN','PENDING_MGR_ULTG')) or
    (r.stage = 'PENDING_ASMAN' and p_target_stage in ('PENDING_MANAGER','REJECTED')) or
    (r.stage = 'PENDING_MANAGER' and p_target_stage in ('APPROVED','REJECTED')) or
    (r.stage = 'PENDING_MGR_ULTG' and p_target_stage in ('APPROVED_ULTG','REJECTED'))
  ) then raise exception 'TUG_WORKFLOW_STAGE_TRANSITION_INVALID'; end if;
  if r.doc_type = 'TUG7' and not (
    (r.stage = 'DRAFT_UIT' and p_target_stage = 'PENDING_MGR_LOGISTIK') or
    (r.stage = 'PENDING_MGR_LOGISTIK' and p_target_stage in ('APPROVED','REJECTED'))
  ) then raise exception 'TUG_WORKFLOW_STAGE_TRANSITION_INVALID'; end if;
  if r.doc_type in ('TUG8','TUG9') and r.stage <> 'DRAFT' then
    raise exception 'TUG_WORKFLOW_STAGE_TRANSITION_INVALID';
  end if;
  if r.doc_type = 'TUG5' and p_target_stage = 'PENDING_ASMAN' and a.role not in ('ADMIN','TL','SUPERADMIN') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if r.doc_type = 'TUG5' and p_target_stage = 'PENDING_MANAGER' and a.role not in ('ASMAN','SUPERADMIN') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if r.doc_type = 'TUG5' and p_target_stage = 'PENDING_MGR_ULTG' and a.role not in ('ADMIN_ULTG','SUPERADMIN') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if r.doc_type = 'TUG5' and p_target_stage = 'APPROVED' and a.role not in ('MANAGER','SUPERADMIN') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if r.doc_type = 'TUG5' and p_target_stage = 'APPROVED_ULTG' and a.role not in ('MGR_ULTG','SUPERADMIN') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if r.doc_type = 'TUG7' and p_target_stage = 'PENDING_MGR_LOGISTIK' and a.role not in ('ADMIN_UIT','SUPERADMIN') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if r.doc_type = 'TUG7' and p_target_stage = 'APPROVED' and a.role not in ('MGR_LOGISTIK_UIT','SUPERADMIN') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if p_target_stage = 'REJECTED' and a.role not in ('ASMAN','MANAGER','MGR_ULTG','MGR_LOGISTIK_UIT','SUPERADMIN','ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  if r.doc_type in ('TUG8','TUG9') and p_target_stage <> 'DRAFT' then raise exception 'TUG_WORKFLOW_CANONICAL_ONLY_ON_SUBMIT'; end if;
  if p_target_stage in ('PENDING_ASMAN','PENDING_MANAGER','PENDING_MGR_ULTG','PENDING_MGR_LOGISTIK') and coalesce(p_target_status,r.status) <> 'PENDING' then raise exception 'TUG_WORKFLOW_STATUS_TRANSITION_INVALID'; end if;
  if p_target_stage in ('APPROVED','APPROVED_ULTG') and coalesce(p_target_status,r.status) <> 'APPROVED' then raise exception 'TUG_WORKFLOW_STATUS_TRANSITION_INVALID'; end if;
  if p_target_stage = 'REJECTED' and coalesce(p_target_status,r.status) <> 'REJECTED' then raise exception 'TUG_WORKFLOW_STATUS_TRANSITION_INVALID'; end if;
  if a.role not in ('TL','ASMAN','MANAGER','ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','MGR_ULTG','SUPERADMIN','ADMIN_LOG_PUSAT') and r.created_by <> auth.uid() then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
  v_data := r.data || p_patch;
  update public.tug_workflow_transactions
     set stage=coalesce(p_target_stage,stage), status=coalesce(p_target_status,status), data=v_data,
         version=version+1, updated_at=now()
   where id=p_id;
  return jsonb_build_object('ok',true,'id',p_id,'version',r.version+1,'stage',coalesce(p_target_stage,r.stage),'status',coalesce(p_target_status,r.status),'docNumber',r.doc_number);
end
$$;

-- Atomic approval transitions that create their required child workflow row.
-- The parent lock, scope, actor, timestamps, references, stage and status are
-- all server-derived. Retry is safe when the same parent already owns the
-- requested child; no new idempotency operation is added to the canonical key
-- table because that table has a deliberately closed operation constraint.
create or replace function public.transition_tug_workflow_with_child(
  p_action text,
  p_parent_id text,
  p_expected_version integer,
  p_child_id text,
  p_child_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  a public.profiles;
  parent_row public.tug_workflow_transactions;
  child_row public.tug_workflow_transactions;
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_child_type text;
  v_child_stage text;
  v_child_status text;
  v_child_upt text;
  v_child_uit text;
  v_transfer text;
  v_ultg_upt text;
  v_parent_data jsonb;
  v_child_data jsonb;
  v_reference_key text;
  v_actor_key text;
  v_timestamp_key text;
  v_epoch_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_now timestamptz := clock_timestamp();
begin
  select * into a from public.profiles where id = auth.uid();
  if a.id is null then raise exception 'TUG_WORKFLOW_AUTH_REQUIRED'; end if;
  if v_action not in ('TUG5_MANAGER_APPROVE', 'TUG5_ULTG_ADOPT', 'TUG7_MGR_LOG_APPROVE') then
    raise exception 'TUG_WORKFLOW_ATOMIC_ACTION_INVALID';
  end if;
  if p_parent_id is null or btrim(p_parent_id) = '' or p_child_id is null or btrim(p_child_id) = '' or p_parent_id = p_child_id then
    raise exception 'TUG_WORKFLOW_PARENT_CHILD_ID_INVALID';
  end if;
  if p_child_data is null or jsonb_typeof(p_child_data) <> 'object' or public.tug_workflow_contains_data_url(p_child_data) then
    raise exception 'TUG_WORKFLOW_PATCH_INVALID';
  end if;

  -- Serialize the entire transition on the parent row.
  select * into parent_row
    from public.tug_workflow_transactions
   where id = p_parent_id
   for update;
  if parent_row.id is null then raise exception 'TUG_WORKFLOW_NOT_FOUND'; end if;

  -- Authorize and validate the action scope before any retry response. This
  -- function is SECURITY DEFINER; a caller who knows an ID must not be able
  -- to use the idempotent path as a cross-scope snapshot oracle.
  if v_action = 'TUG5_MANAGER_APPROVE' then
    if parent_row.doc_type <> 'TUG5' then raise exception 'TUG_WORKFLOW_DOC_TYPE_INVALID'; end if;
    if a.role not in ('MANAGER', 'SUPERADMIN', 'ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
    if a.role = 'MANAGER' and (parent_row.upt_id is null or a.upt_id is distinct from parent_row.upt_id) then
      raise exception 'TUG_WORKFLOW_SCOPE_DENIED';
    end if;
    select u.uit_id into v_child_uit
      from public.upt u
     where u.id = parent_row.upt_id;
    if v_child_uit is null or not exists (select 1 from public.uit where id = v_child_uit) then
      raise exception 'TUG_WORKFLOW_UIT_REQUIRED';
    end if;
  elsif v_action = 'TUG5_ULTG_ADOPT' then
    if parent_row.doc_type <> 'TUG5' then raise exception 'TUG_WORKFLOW_DOC_TYPE_INVALID'; end if;
    if a.role not in ('ADMIN', 'TL', 'SUPERADMIN', 'ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
    if parent_row.ultg_id is null then raise exception 'TUG_WORKFLOW_ULTG_REQUIRED'; end if;
    select u.upt_id into v_ultg_upt from public.ultg u where u.id = parent_row.ultg_id;
    if v_ultg_upt is null or parent_row.upt_id is distinct from v_ultg_upt then
      raise exception 'TUG_WORKFLOW_ULTG_PARENT_UPT_INVALID';
    end if;
    if a.role in ('ADMIN', 'TL') and a.upt_id is distinct from v_ultg_upt then raise exception 'TUG_WORKFLOW_SCOPE_DENIED'; end if;
  else
    if parent_row.doc_type <> 'TUG7' then raise exception 'TUG_WORKFLOW_DOC_TYPE_INVALID'; end if;
    if a.role not in ('MGR_LOGISTIK_UIT', 'SUPERADMIN', 'ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
    if a.role = 'MGR_LOGISTIK_UIT' and (parent_row.uit_id is null or a.uit_id is distinct from parent_row.uit_id) then
      raise exception 'TUG_WORKFLOW_SCOPE_DENIED';
    end if;
    v_child_upt := coalesce(nullif(btrim(parent_row.data->>'uptPengirimId'), ''), parent_row.upt_id);
    if v_child_upt is null or not exists (select 1 from public.upt u where u.id = v_child_upt and (parent_row.uit_id is null or u.uit_id = parent_row.uit_id)) then
      raise exception 'TUG_WORKFLOW_UPT_SCOPE_INVALID';
    end if;
  end if;

  -- Safe retry: the first transaction committed both rows, so return the
  -- committed pair even when the network retry carries the old version.
  select * into child_row
    from public.tug_workflow_transactions
   where parent_workflow_id = parent_row.id
   for update;
  if child_row.id is not null then
    if child_row.id <> p_child_id then raise exception 'TUG_WORKFLOW_CHILD_ALREADY_EXISTS'; end if;
    if (v_action = 'TUG5_MANAGER_APPROVE' and parent_row.doc_type = 'TUG5' and parent_row.stage = 'APPROVED' and parent_row.status = 'APPROVED')
       or (v_action = 'TUG5_ULTG_ADOPT' and parent_row.doc_type = 'TUG5' and parent_row.stage = 'APPROVED_ULTG' and parent_row.status = 'APPROVED')
       or (v_action = 'TUG7_MGR_LOG_APPROVE' and parent_row.doc_type = 'TUG7' and parent_row.stage = 'APPROVED' and parent_row.status = 'APPROVED') then
      return jsonb_build_object('ok', true, 'idempotent', true, 'action', v_action,
        'parent', to_jsonb(parent_row), 'child', to_jsonb(child_row));
    end if;
    raise exception 'TUG_WORKFLOW_CHILD_ALREADY_EXISTS';
  end if;
  if p_expected_version is null or parent_row.version <> p_expected_version then
    raise exception 'TUG_WORKFLOW_VERSION_MISMATCH';
  end if;

  if v_action = 'TUG5_MANAGER_APPROVE' then
    if parent_row.doc_type <> 'TUG5' or parent_row.stage <> 'PENDING_MANAGER' or parent_row.status <> 'PENDING' then
      raise exception 'TUG_WORKFLOW_STAGE_TRANSITION_INVALID';
    end if;
    if a.role not in ('MANAGER', 'SUPERADMIN', 'ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
    if a.role = 'MANAGER' and (parent_row.upt_id is null or a.upt_id is distinct from parent_row.upt_id) then
      raise exception 'TUG_WORKFLOW_SCOPE_DENIED';
    end if;
    v_transfer := upper(coalesce(parent_row.data->>'jenisTransfer', 'INTRACOMPANY'));
    if v_transfer = 'INTRACOMPANY' then
      v_child_type := 'TUG7';
    elsif v_transfer = 'INTERCOMPANY' then
      v_child_type := 'TUG5';
    else
      raise exception 'TUG_WORKFLOW_TRANSFER_INVALID';
    end if;
    select u.uit_id into v_child_uit
      from public.upt u
     where u.id = parent_row.upt_id;
    if v_child_uit is null or not exists (select 1 from public.uit where id = v_child_uit) then
      raise exception 'TUG_WORKFLOW_UIT_REQUIRED';
    end if;
    v_child_stage := 'DRAFT_UIT';
    v_child_status := 'PENDING';
    v_reference_key := case when v_child_type = 'TUG7' then 'tug7Id' else 'draftTug5UITId' end;
    v_actor_key := 'approvedByManager';
    v_timestamp_key := 'approvedAtManager';
  elsif v_action = 'TUG5_ULTG_ADOPT' then
    if parent_row.doc_type <> 'TUG5' or parent_row.stage <> 'APPROVED_ULTG' or parent_row.status <> 'APPROVED' then
      raise exception 'TUG_WORKFLOW_STAGE_TRANSITION_INVALID';
    end if;
    if a.role not in ('ADMIN', 'TL', 'SUPERADMIN', 'ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
    if parent_row.ultg_id is null then raise exception 'TUG_WORKFLOW_ULTG_REQUIRED'; end if;
    select u.upt_id into v_ultg_upt from public.ultg u where u.id = parent_row.ultg_id;
    if v_ultg_upt is null or parent_row.upt_id is distinct from v_ultg_upt then
      raise exception 'TUG_WORKFLOW_ULTG_PARENT_UPT_INVALID';
    end if;
    if a.role in ('ADMIN', 'TL') and a.upt_id is distinct from v_ultg_upt then raise exception 'TUG_WORKFLOW_SCOPE_DENIED'; end if;
    v_child_type := 'TUG9';
    v_child_stage := 'DRAFT';
    v_child_status := 'DRAFT';
    v_child_upt := v_ultg_upt;
    v_reference_key := 'adoptedTug9Id';
    v_actor_key := 'adoptedBy';
    v_timestamp_key := 'adoptedAt';
  else
    if parent_row.doc_type <> 'TUG7' or parent_row.stage <> 'PENDING_MGR_LOGISTIK' or parent_row.status <> 'PENDING' then
      raise exception 'TUG_WORKFLOW_STAGE_TRANSITION_INVALID';
    end if;
    if a.role not in ('MGR_LOGISTIK_UIT', 'SUPERADMIN', 'ADMIN_LOG_PUSAT') then raise exception 'TUG_WORKFLOW_ROLE_DENIED'; end if;
    if a.role = 'MGR_LOGISTIK_UIT' and (parent_row.uit_id is null or a.uit_id is distinct from parent_row.uit_id) then
      raise exception 'TUG_WORKFLOW_SCOPE_DENIED';
    end if;
    v_child_upt := coalesce(nullif(btrim(parent_row.data->>'uptPengirimId'), ''), parent_row.upt_id);
    if v_child_upt is null or not exists (select 1 from public.upt u where u.id = v_child_upt and (parent_row.uit_id is null or u.uit_id = parent_row.uit_id)) then
      raise exception 'TUG_WORKFLOW_UPT_SCOPE_INVALID';
    end if;
    v_child_type := 'TUG8';
    v_child_stage := 'DRAFT_TUG8';
    v_child_status := 'DRAFT';
    v_reference_key := 'tug8DraftId';
    v_actor_key := 'approvedByMgrLogistik';
    v_timestamp_key := 'approvedAtMgrLogistik';
  end if;

  select * into child_row from public.tug_workflow_transactions where id = p_child_id for update;
  if child_row.id is not null then raise exception 'TUG_WORKFLOW_CHILD_ID_CONFLICT'; end if;
  if (v_child_upt is null) = (v_child_uit is null) then raise exception 'TUG_WORKFLOW_SCOPE_INVALID'; end if;

  v_parent_data := parent_row.data || jsonb_build_object(v_reference_key, p_child_id, v_actor_key, a.id, v_timestamp_key, v_epoch_ms);
  v_child_data := p_child_data || jsonb_build_object(
    'docType', v_child_type,
    'parentWorkflowId', parent_row.id,
    'createdBy', a.id,
    'createdAt', v_epoch_ms,
    'docNumbers', '{}'::jsonb,
    'docSeq', null
  );

  update public.tug_workflow_transactions
     set stage = case when v_action = 'TUG5_ULTG_ADOPT' then 'APPROVED_ULTG' else 'APPROVED' end,
         status = 'APPROVED', data = v_parent_data, version = version + 1,
         updated_at = v_now
   where id = parent_row.id
   returning * into parent_row;

  insert into public.tug_workflow_transactions(
    id, doc_type, upt_id, uit_id, ultg_id, created_by, stage, status,
    doc_number, doc_sequence, version, parent_workflow_id, data, created_at, updated_at
  ) values (
    p_child_id, v_child_type, v_child_upt, v_child_uit, null, a.id, v_child_stage, v_child_status,
    null, null, 1, parent_row.id, v_child_data, v_now, v_now
  ) returning * into child_row;

  return jsonb_build_object('ok', true, 'idempotent', false, 'action', v_action,
    'parent', to_jsonb(parent_row), 'child', to_jsonb(child_row));
end
$$;

revoke all on function public.tug_workflow_actor() from public, anon, authenticated;
revoke all on function public.tug_workflow_scope_allowed(text,text,text) from public, anon, authenticated;
revoke all on function public.tug_workflow_contains_data_url(jsonb) from public, anon, authenticated;
revoke all on function public.save_tug_workflow_transaction(text,text,text,text,text,text,text,text,bigint,jsonb,integer) from public, anon, authenticated;
revoke all on function public.delete_tug_workflow_transaction(text,integer) from public, anon, authenticated;
revoke all on function public.transition_tug_workflow_transaction(text,integer,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.transition_tug_workflow_with_child(text,text,integer,text,jsonb) from public, anon, authenticated;
revoke all on function public.issue_tug_workflow_document_number(text,integer,text) from public, anon, authenticated;
grant execute on function public.save_tug_workflow_transaction(text,text,text,text,text,text,text,text,bigint,jsonb,integer) to authenticated;
grant execute on function public.delete_tug_workflow_transaction(text,integer) to authenticated;
grant execute on function public.transition_tug_workflow_transaction(text,integer,text,text,jsonb) to authenticated;
grant execute on function public.transition_tug_workflow_with_child(text,text,integer,text,jsonb) to authenticated;
grant execute on function public.issue_tug_workflow_document_number(text,integer,text) to authenticated;
