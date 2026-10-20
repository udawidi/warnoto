-- TUG-5 UPT: Asman is the final workflow gate and creates the UIT child atomically.
-- Apply only after backup and verifier review. Production application is manual.

create or replace function public.approve_tug5_asman_with_child(
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
  v_transfer text;
  v_child_type text;
  v_child_upt text := null;
  v_child_uit text;
  v_parent_data jsonb;
  v_child_data jsonb;
  v_reference_key text;
  v_epoch_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_now timestamptz := clock_timestamp();
begin
  select * into a from public.profiles where id = auth.uid();
  if a.id is null then raise exception 'TUG_WORKFLOW_AUTH_REQUIRED'; end if;
  if p_parent_id is null or btrim(p_parent_id) = ''
     or p_child_id is null or btrim(p_child_id) = ''
     or p_parent_id = p_child_id then
    raise exception 'TUG_WORKFLOW_PARENT_CHILD_ID_INVALID';
  end if;
  if p_child_data is null or jsonb_typeof(p_child_data) <> 'object'
     or public.tug_workflow_contains_data_url(p_child_data) then
    raise exception 'TUG_WORKFLOW_PATCH_INVALID';
  end if;

  -- Lock the parent before authorization and retry handling. The retry path
  -- returns only a child already owned by this parent and the same request id.
  select * into parent_row
    from public.tug_workflow_transactions
   where id = p_parent_id
   for update;
  if parent_row.id is null then raise exception 'TUG_WORKFLOW_NOT_FOUND'; end if;
  if parent_row.doc_type <> 'TUG5' then raise exception 'TUG_WORKFLOW_DOC_TYPE_INVALID'; end if;
  if parent_row.ultg_id is not null
     or parent_row.uit_id is not null
     or upper(coalesce(parent_row.data->>'sourceType', '')) = 'ULTG'
     or upper(coalesce(parent_row.data->>'docSubType', '')) = 'UIT_INTERCOMPANY' then
    raise exception 'TUG_WORKFLOW_UPT_PARENT_REQUIRED';
  end if;
  if not public.tug_workflow_scope_allowed(parent_row.upt_id, parent_row.uit_id, parent_row.ultg_id) then
    raise exception 'TUG_WORKFLOW_SCOPE_DENIED';
  end if;
  if a.role not in ('ASMAN', 'SUPERADMIN', 'ADMIN_LOG_PUSAT') then
    raise exception 'TUG_WORKFLOW_ROLE_DENIED';
  end if;
  if a.role = 'ASMAN' and (parent_row.upt_id is null or a.upt_id is distinct from parent_row.upt_id) then
    raise exception 'TUG_WORKFLOW_SCOPE_DENIED';
  end if;

  select * into child_row
    from public.tug_workflow_transactions
   where parent_workflow_id = parent_row.id
   for update;
  if child_row.id is not null then
    if child_row.id <> p_child_id then raise exception 'TUG_WORKFLOW_CHILD_ALREADY_EXISTS'; end if;
    if parent_row.stage = 'APPROVED' and parent_row.status = 'APPROVED'
       and parent_row.data->>'approvedByAsman' = auth.uid()::text then
      return jsonb_build_object('ok', true, 'idempotent', true,
        'action', 'TUG5_ASMAN_APPROVE', 'parent', to_jsonb(parent_row), 'child', to_jsonb(child_row));
    end if;
    raise exception 'TUG_WORKFLOW_CHILD_ALREADY_EXISTS';
  end if;
  if p_expected_version is null or parent_row.version <> p_expected_version then
    raise exception 'TUG_WORKFLOW_VERSION_MISMATCH';
  end if;
  if parent_row.stage <> 'PENDING_ASMAN' or parent_row.status <> 'PENDING' then
    raise exception 'TUG_WORKFLOW_STAGE_TRANSITION_INVALID';
  end if;

  v_transfer := upper(coalesce(parent_row.data->>'jenisTransfer', 'INTRACOMPANY'));
  if v_transfer = 'INTRACOMPANY' then
    v_child_type := 'TUG7';
    v_reference_key := 'tug7Id';
  elsif v_transfer = 'INTERCOMPANY' then
    v_child_type := 'TUG5';
    v_reference_key := 'draftTug5UITId';
  else
    raise exception 'TUG_WORKFLOW_TRANSFER_INVALID';
  end if;

  select u.uit_id into v_child_uit
    from public.upt u
   where u.id = parent_row.upt_id;
  if v_child_uit is null or not exists (select 1 from public.uit where id = v_child_uit) then
    raise exception 'TUG_WORKFLOW_UIT_REQUIRED';
  end if;
  if (v_child_upt is null) = (v_child_uit is null) then
    raise exception 'TUG_WORKFLOW_SCOPE_INVALID';
  end if;

  select * into child_row from public.tug_workflow_transactions where id = p_child_id for update;
  if child_row.id is not null then raise exception 'TUG_WORKFLOW_CHILD_ID_CONFLICT'; end if;

  v_parent_data := parent_row.data || jsonb_build_object(
    v_reference_key, p_child_id,
    'approvedByAsman', a.id,
    'approvedAtAsman', v_epoch_ms
  );
  v_child_data := (p_child_data - ARRAY[
    'docType', 'uptId', 'uitId', 'ultgId', 'parentWorkflowId', 'createdBy',
    'createdAt', 'docNumbers', 'docSeq', 'workflowVersion', 'stage',
    'status', 'requiredApprover', 'uptPengirimId', 'tug5Id', 'tug5UptId',
    'docSubType', 'sourceType', 'stockItems'
  ]) || jsonb_build_object(
    'docType', v_child_type,
    'parentWorkflowId', parent_row.id,
    'createdBy', a.id,
    'createdAt', v_epoch_ms,
    'docNumbers', '{}'::jsonb,
    'docSeq', null
  ) || case when v_child_type = 'TUG7'
    then jsonb_build_object('tug5Id', parent_row.id)
    else jsonb_build_object('tug5UptId', parent_row.id)
  end;
  if v_child_type = 'TUG7' then
    v_child_data := jsonb_set(v_child_data, '{stockItems}', coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'qty', coalesce(nullif(item->'permintaan', 'null'::jsonb), nullif(item->'qty', 'null'::jsonb), '0'::jsonb)
      ) order by ord)
      from jsonb_array_elements(coalesce(parent_row.data->'stockItems', '[]'::jsonb)) with ordinality as source(item, ord)
    ), '[]'::jsonb), true);
  else
    v_child_data := jsonb_set(v_child_data, '{docSubType}', '"UIT_INTERCOMPANY"'::jsonb, true);
    v_child_data := jsonb_set(v_child_data, '{stockItems}', coalesce(parent_row.data->'stockItems', '[]'::jsonb), true);
  end if;

  update public.tug_workflow_transactions
     set stage = 'APPROVED', status = 'APPROVED', data = v_parent_data,
         version = version + 1, updated_at = v_now
   where id = parent_row.id
   returning * into parent_row;

  insert into public.tug_workflow_transactions(
    id, doc_type, upt_id, uit_id, ultg_id, created_by, stage, status,
    doc_number, doc_sequence, version, parent_workflow_id, data, created_at, updated_at
  ) values (
    p_child_id, v_child_type, v_child_upt, v_child_uit, null, a.id,
    'DRAFT_UIT', 'PENDING', null, null, 1, parent_row.id, v_child_data, v_now, v_now
  ) returning * into child_row;

  return jsonb_build_object('ok', true, 'idempotent', false,
    'action', 'TUG5_ASMAN_APPROVE', 'parent', to_jsonb(parent_row), 'child', to_jsonb(child_row));
end
$$;

revoke all on function public.approve_tug5_asman_with_child(text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.approve_tug5_asman_with_child(text, integer, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- The generic transition RPC remains valid for legacy rows already waiting for
-- Manager, but a new UPT TUG-5 can no longer be routed there by spoofing a
-- PENDING_MANAGER target after Asman has received it.
create or replace function public.guard_tug5_asman_final_stage()
returns trigger
language plpgsql
security definer set search_path = public, pg_catalog
as $$
begin
  if old.doc_type = 'TUG5' and old.stage = 'PENDING_ASMAN' and new.stage = 'PENDING_MANAGER' then
    raise exception 'TUG_WORKFLOW_ASMAN_FINAL_ONLY';
  end if;
  return new;
end
$$;

drop trigger if exists tug5_asman_final_stage_guard on public.tug_workflow_transactions;
create trigger tug5_asman_final_stage_guard
before update of stage on public.tug_workflow_transactions
for each row execute function public.guard_tug5_asman_final_stage();
revoke all on function public.guard_tug5_asman_final_stage() from public, anon, authenticated;
