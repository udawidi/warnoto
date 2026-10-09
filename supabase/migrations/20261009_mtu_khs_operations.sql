-- Applied to self-host production on 2026-10-09 after explicit approval.
-- Operational MTU KHS: direct TL edits, ranked search, private evidence and reviewed transfers.

create extension if not exists pg_trgm;

alter table public.mtu_khs_records add column if not exists lokasi_id text references public.lokasi(id) on delete set null;
alter table public.mtu_khs_records add column if not exists search_text text not null default '';
create index if not exists idx_mtu_khs_records_lokasi on public.mtu_khs_records(lokasi_id);
create index if not exists idx_mtu_khs_records_search_trgm on public.mtu_khs_records using gin(search_text gin_trgm_ops);

create table if not exists public.mtu_khs_record_events (
  id uuid primary key default gen_random_uuid(), record_id text not null references public.mtu_khs_records(id) on delete cascade,
  event_type text not null, actor_id uuid references auth.users(id), source_upt_id text references public.upt(id), target_upt_id text references public.upt(id),
  before_data jsonb not null default '{}'::jsonb, after_data jsonb not null default '{}'::jsonb, metadata jsonb not null default '{}'::jsonb,
  idempotency_key text, created_at timestamptz not null default now(), unique(record_id, idempotency_key)
);
create index if not exists idx_mtu_khs_record_events_record on public.mtu_khs_record_events(record_id, created_at desc);

create table if not exists public.mtu_khs_record_evidence (
  id uuid primary key default gen_random_uuid(), record_id text not null references public.mtu_khs_records(id) on delete cascade,
  kind text not null check (kind in ('ITEM','NAMEPLATE')), object_path text not null, mime_type text not null, size_bytes bigint not null,
  uploaded_by uuid not null references auth.users(id), created_at timestamptz not null default now(), superseded_at timestamptz, inherited_from uuid references public.mtu_khs_record_evidence(id)
);
create unique index if not exists uq_mtu_khs_evidence_active on public.mtu_khs_record_evidence(record_id, kind) where superseded_at is null;
create index if not exists idx_mtu_khs_evidence_record on public.mtu_khs_record_evidence(record_id, kind, created_at desc);

create table if not exists public.mtu_khs_transfer_requests (
  id uuid primary key default gen_random_uuid(), source_record_id text not null references public.mtu_khs_records(id) on delete restrict,
  source_version integer not null, idempotency_key text not null, source_upt_id text not null references public.upt(id), target_upt_id text not null references public.upt(id),
  target_ultg_id text, target_gardu_induk_id text, target_bay_id text, target_gudang_id text, target_lokasi_id text,
  qty numeric not null check (qty > 0), note text not null default '', status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  requested_by uuid not null references auth.users(id), requested_at timestamptz not null default now(), decided_by uuid references auth.users(id), decided_at timestamptz,
  decision_note text not null default '', target_record_id text, before_snapshot jsonb not null default '{}'::jsonb, after_snapshot jsonb not null default '{}'
);
create unique index if not exists uq_mtu_khs_transfer_idempotency on public.mtu_khs_transfer_requests(source_record_id, idempotency_key);
create index if not exists idx_mtu_khs_transfer_scope on public.mtu_khs_transfer_requests(source_upt_id, target_upt_id, status);

create or replace function public.mtu_khs_search_text(p_data jsonb)
returns text language sql immutable as $$
  select lower(regexp_replace(regexp_replace(coalesce(p_data::text, ''), '[^[:alnum:]]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;

create or replace function public.mtu_khs_refresh_search_text()
returns trigger language plpgsql as $$
begin
  new.search_text := public.mtu_khs_search_text(coalesce(new.data, '{}'::jsonb) || jsonb_build_object('id', new.id, 'uptId', new.upt_id, 'katalogId', new.katalog_id));
  return new;
end;
$$;
drop trigger if exists trg_mtu_khs_refresh_search_text on public.mtu_khs_records;
create trigger trg_mtu_khs_refresh_search_text before insert or update of data, katalog_id, upt_id on public.mtu_khs_records for each row execute function public.mtu_khs_refresh_search_text();
update public.mtu_khs_records set search_text = public.mtu_khs_search_text(coalesce(data, '{}'::jsonb) || jsonb_build_object('id', id, 'uptId', upt_id, 'katalogId', katalog_id)) where search_text = '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mtu-khs-evidence', 'mtu-khs-evidence', false, 2097152, array['image/*']::text[])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/*']::text[];
drop policy if exists "MTU KHS evidence upload scoped" on storage.objects;
create policy "MTU KHS evidence upload scoped" on storage.objects for insert to authenticated with check (
  bucket_id = 'mtu-khs-evidence' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('TL','SUPERADMIN')) and exists (select 1 from public.mtu_khs_records r where split_part(name, '/', 2) = r.id and public.mtu_khs_can_access_upt(r.upt_id))
);
drop policy if exists "MTU KHS evidence read scoped" on storage.objects;
create policy "MTU KHS evidence read scoped" on storage.objects for select to authenticated using (
  bucket_id = 'mtu-khs-evidence' and exists (select 1 from public.mtu_khs_records r where public.mtu_khs_can_access_upt(r.upt_id) and (split_part(name, '/', 2) = r.id or exists (select 1 from public.mtu_khs_record_evidence e where e.record_id = r.id and e.object_path = storage.objects.name)))
);

alter table public.mtu_khs_record_events enable row level security;
alter table public.mtu_khs_record_evidence enable row level security;
alter table public.mtu_khs_transfer_requests enable row level security;
drop policy if exists "MTU KHS events scoped" on public.mtu_khs_record_events;
create policy "MTU KHS events scoped" on public.mtu_khs_record_events for select to authenticated using (public.mtu_khs_can_access_upt(source_upt_id) or (event_type = 'TRANSFER_APPROVED' and public.mtu_khs_can_access_upt(target_upt_id)));
drop policy if exists "MTU KHS evidence scoped" on public.mtu_khs_record_evidence;
create policy "MTU KHS evidence scoped" on public.mtu_khs_record_evidence for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS transfers scoped" on public.mtu_khs_transfer_requests;
create policy "MTU KHS transfers scoped" on public.mtu_khs_transfer_requests for select to authenticated using (public.mtu_khs_can_access_upt(source_upt_id) or (status = 'APPROVED' and public.mtu_khs_can_access_upt(target_upt_id)));
grant select on public.mtu_khs_record_events, public.mtu_khs_record_evidence, public.mtu_khs_transfer_requests to authenticated;
revoke insert, update, delete on public.mtu_khs_record_events, public.mtu_khs_record_evidence, public.mtu_khs_transfer_requests from authenticated;

create or replace function public.mtu_khs_update_operational(p_record_id text, p_expected_version integer, p_patch jsonb, p_idempotency_key text)
returns public.mtu_khs_records language plpgsql security definer set search_path = public as $$
declare r public.mtu_khs_records; actor public.profiles; result public.mtu_khs_records; patch jsonb := coalesce(p_patch, '{}'::jsonb); effective_ultg text; effective_gi text; effective_bay text; effective_gudang text; effective_lokasi text; selected_katalog text; katalog_snapshot jsonb;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.role not in ('TL','SUPERADMIN') then raise exception 'MTU_ROLE_DENIED'; end if;
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if exists (select 1 from public.mtu_khs_record_events where record_id = r.id and idempotency_key = p_idempotency_key and event_type = 'OPERATIONAL_UPDATE') then select * into result from public.mtu_khs_records where id = r.id; return result; end if;
  if p_expected_version is distinct from r.version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  if exists (select 1 from jsonb_object_keys(patch) k where k not in ('katalogId','lifecycleStatus','gudangId','lokasiId','ultgId','garduIndukId','bayId')) then raise exception 'MTU_FIELD_FORBIDDEN'; end if;
  if patch ? 'katalogId' and nullif(patch->>'katalogId','') is null then raise exception 'MTU_CATALOG_REQUIRED'; end if;
  if patch ? 'katalogId' and nullif(patch->>'katalogId','') is not null and not exists (select 1 from public.katalog where id = patch->>'katalogId') then raise exception 'MTU_CATALOG_INVALID'; end if;
  if patch ? 'katalogId' and nullif(patch->>'katalogId','') is distinct from r.katalog_id and (exists (select 1 from public.mtu_khs_receipts where mtu_record_id=r.id) or exists (select 1 from public.mtu_khs_usage_links where mtu_record_id=r.id and status='APPROVED') or exists (select 1 from public.mtu_khs_stock_links where mtu_record_id=r.id)) then raise exception 'MTU_CATALOG_LOCKED'; end if;
  if patch ? 'lifecycleStatus' and (patch->>'lifecycleStatus') not in ('VENDOR','IN_TRANSIT','WAREHOUSE','ON_SITE','INSTALLED','PLANNED_ARRIVAL','CANCELLED') then raise exception 'MTU_STATUS_INVALID'; end if;
  effective_ultg := case when patch ? 'ultgId' then nullif(patch->>'ultgId','') else r.ultg_id end;
  effective_gi := case when patch ? 'garduIndukId' then nullif(patch->>'garduIndukId','') else r.gardu_induk_id end;
  effective_bay := case when patch ? 'bayId' then nullif(patch->>'bayId','') else r.bay_id end;
  effective_gudang := case when patch ? 'gudangId' then nullif(patch->>'gudangId','') else r.gudang_id end;
  effective_lokasi := case when patch ? 'lokasiId' then nullif(patch->>'lokasiId','') else r.lokasi_id end;
  if effective_ultg is not null and not exists (select 1 from public.ultg where id = effective_ultg and upt_id = r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_gi is not null and not exists (select 1 from public.mtu_khs_gardu_induk where id = effective_gi and upt_id = r.upt_id and (effective_ultg is null or ultg_id = effective_ultg)) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_bay is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay b join public.mtu_khs_gardu_induk g on g.id=b.gardu_induk_id where b.id=effective_bay and g.upt_id=r.upt_id and g.id=effective_gi) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_gudang is not null and not exists (select 1 from public.gudang where id=effective_gudang and upt_id=r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_lokasi is not null and not exists (select 1 from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=effective_lokasi and g.upt_id=r.upt_id and (effective_gudang is null or g.id=effective_gudang)) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  selected_katalog := case when patch ? 'katalogId' then nullif(patch->>'katalogId','') else r.katalog_id end;
  select coalesce(data,'{}'::jsonb) into katalog_snapshot from public.katalog where id=selected_katalog;
  if selected_katalog is not null and (
    nullif(coalesce(katalog_snapshot->>'katalog',katalog_snapshot->>'kode',katalog_snapshot->>'kode_material',katalog_snapshot->>'code',katalog_snapshot->'mara'->>'katalog',katalog_snapshot->'mara'->>'kode_material'),'') is null or
    nullif(coalesce(katalog_snapshot->>'name',katalog_snapshot->>'nama',katalog_snapshot->>'nama_material',katalog_snapshot->>'materialDescription',katalog_snapshot->'mara'->>'name',katalog_snapshot->'mara'->>'nama'),'') is null or
    nullif(coalesce(katalog_snapshot->>'description',katalog_snapshot->>'deskripsi',katalog_snapshot->>'materialDescription',katalog_snapshot->>'name',katalog_snapshot->>'nama',katalog_snapshot->'mara'->>'description',katalog_snapshot->'mara'->>'deskripsi',katalog_snapshot->'mara'->>'name',katalog_snapshot->'mara'->>'nama'),'') is null or
    nullif(coalesce(katalog_snapshot->>'satuan',katalog_snapshot->>'unit',katalog_snapshot->'mara'->>'satuan',katalog_snapshot->'mara'->>'unit'),'') is null
  ) then raise exception 'MTU_CATALOG_SNAPSHOT_INVALID'; end if;
  update public.mtu_khs_records set katalog_id = selected_katalog, lifecycle_status = case when patch ? 'lifecycleStatus' then patch->>'lifecycleStatus' else lifecycle_status end, ultg_id = effective_ultg, gudang_id = effective_gudang, lokasi_id = effective_lokasi, gardu_induk_id = effective_gi, bay_id = effective_bay, data = data || patch || jsonb_strip_nulls(jsonb_build_object('katalogId',selected_katalog,'catalogNumber',coalesce(katalog_snapshot->>'katalog',katalog_snapshot->>'kode',katalog_snapshot->>'kode_material',katalog_snapshot->>'code',katalog_snapshot->'mara'->>'katalog',katalog_snapshot->'mara'->>'kode_material'), 'materialName',coalesce(katalog_snapshot->>'name',katalog_snapshot->>'nama',katalog_snapshot->>'nama_material',katalog_snapshot->>'materialDescription',katalog_snapshot->'mara'->>'name',katalog_snapshot->'mara'->>'nama'), 'materialDescription',coalesce(katalog_snapshot->>'description',katalog_snapshot->>'deskripsi',katalog_snapshot->>'materialDescription',katalog_snapshot->>'name',katalog_snapshot->>'nama',katalog_snapshot->'mara'->>'description',katalog_snapshot->'mara'->>'deskripsi',katalog_snapshot->'mara'->>'name',katalog_snapshot->'mara'->>'nama'), 'unit',coalesce(katalog_snapshot->>'satuan',katalog_snapshot->>'unit',katalog_snapshot->'mara'->>'satuan',katalog_snapshot->'mara'->>'unit'), 'satuan',coalesce(katalog_snapshot->>'satuan',katalog_snapshot->>'unit',katalog_snapshot->'mara'->>'satuan',katalog_snapshot->'mara'->>'unit'), 'qty',qty,'physicalQty',qty)), version = version + 1, updated_at = now() where id=r.id returning * into result;
  insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,before_data,after_data,metadata,idempotency_key) values (r.id,'OPERATIONAL_UPDATE',auth.uid(),r.upt_id,to_jsonb(r),to_jsonb(result),jsonb_build_object('patch',patch),p_idempotency_key);
  return result;
end; $$;

create or replace function public.mtu_khs_request_transfer(p_record_id text, p_expected_version integer, p_qty numeric, p_target_upt_id text, p_target_ultg_id text, p_target_gardu_induk_id text, p_target_bay_id text, p_target_gudang_id text, p_target_lokasi_id text, p_note text, p_idempotency_key text)
returns public.mtu_khs_transfer_requests language plpgsql security definer set search_path = public as $$
declare r public.mtu_khs_records; actor public.profiles; result public.mtu_khs_transfer_requests; available numeric;
begin
  select * into actor from public.profiles where id=auth.uid(); if actor.role not in ('TL','SUPERADMIN') then raise exception 'MTU_ROLE_DENIED'; end if;
  select * into r from public.mtu_khs_records where id=p_record_id for update; if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  select * into result from public.mtu_khs_transfer_requests where source_record_id=r.id and idempotency_key=p_idempotency_key; if found then return result; end if;
  if r.version is distinct from p_expected_version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  if r.sifat_pekerjaan = 'SUPERVISI' or p_qty is null or p_qty <= 0 then raise exception 'MTU_QTY_INVALID'; end if;
  if r.upt_id = p_target_upt_id then raise exception 'MTU_TRANSFER_SAME_UPT'; end if;
  if not exists (select 1 from public.upt a join public.upt b on b.id=p_target_upt_id where a.id=r.upt_id and a.uit_id is not null and a.uit_id=b.uit_id) then raise exception 'MTU_TRANSFER_CROSS_UIT'; end if;
  if (p_target_gudang_id is null) <> (p_target_lokasi_id is null) then raise exception 'MTU_TARGET_LOCATION_REQUIRED'; end if;
  if (p_target_ultg_id is not null or p_target_gardu_induk_id is not null or p_target_bay_id is not null) and (p_target_ultg_id is null or p_target_gardu_induk_id is null or p_target_bay_id is null) then raise exception 'MTU_TARGET_HIERARCHY_REQUIRED'; end if;
  if (p_target_gardu_induk_id is null or p_target_bay_id is null) and p_target_gudang_id is null then raise exception 'MTU_TARGET_LOCATION_REQUIRED'; end if;
  if p_target_gudang_id is not null and not exists (select 1 from public.gudang where id=p_target_gudang_id and upt_id=p_target_upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_target_lokasi_id is not null and not exists (select 1 from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=p_target_lokasi_id and g.upt_id=p_target_upt_id and g.id=p_target_gudang_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_target_ultg_id is not null and not exists (select 1 from public.ultg where id=p_target_ultg_id and upt_id=p_target_upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_target_gardu_induk_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk where id=p_target_gardu_induk_id and upt_id=p_target_upt_id and (p_target_ultg_id is null or ultg_id=p_target_ultg_id)) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_target_bay_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay where id=p_target_bay_id and gardu_induk_id=p_target_gardu_induk_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  available := r.qty - greatest(coalesce((select sum(qty) from public.mtu_khs_receipts where mtu_record_id=r.id),0), coalesce((select sum(qty) from public.mtu_khs_usage_links where mtu_record_id=r.id and status='APPROVED'),0), coalesce((select sum(qty) from public.mtu_khs_stock_links where mtu_record_id=r.id),0));
  if p_qty > available then raise exception 'MTU_QTY_BOUND'; end if;
  insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,target_upt_id,metadata,idempotency_key) values (r.id,'TRANSFER_REQUESTED',auth.uid(),r.upt_id,p_target_upt_id,jsonb_build_object('qty',p_qty,'targetGudangId',p_target_gudang_id,'targetLokasiId',p_target_lokasi_id),p_idempotency_key);
  insert into public.mtu_khs_transfer_requests(source_record_id,source_version,idempotency_key,source_upt_id,target_upt_id,target_ultg_id,target_gardu_induk_id,target_bay_id,target_gudang_id,target_lokasi_id,qty,note,requested_by,before_snapshot) values (r.id,r.version,p_idempotency_key,r.upt_id,p_target_upt_id,p_target_ultg_id,p_target_gardu_induk_id,p_target_bay_id,p_target_gudang_id,p_target_lokasi_id,p_qty,coalesce(p_note,''),auth.uid(),to_jsonb(r)) returning * into result;
  return result;
end; $$;

create or replace function public.mtu_khs_decide_transfer(p_request_id uuid, p_decision text, p_note text default '')
returns public.mtu_khs_transfer_requests language plpgsql security definer set search_path = public as $$
declare t public.mtu_khs_transfer_requests; r public.mtu_khs_records; actor public.profiles; result public.mtu_khs_transfer_requests; available numeric; new_id text; target_data jsonb;
begin
  if p_decision not in ('APPROVED','REJECTED') then raise exception 'MTU_TRANSFER_DECISION_INVALID'; end if;
  select * into t from public.mtu_khs_transfer_requests where id=p_request_id for update; if not found then raise exception 'MTU_TRANSFER_NOT_FOUND'; end if;
  select * into actor from public.profiles where id=auth.uid(); if actor.role <> 'SUPERADMIN' and not (actor.role='ASMAN' and actor.upt_id=t.source_upt_id) then raise exception 'MTU_TRANSFER_APPROVER_INVALID'; end if;
  if t.status <> 'PENDING' then return t; end if;
  if p_decision = 'REJECTED' then update public.mtu_khs_transfer_requests set status='REJECTED',decision_note=coalesce(p_note,''),decided_by=auth.uid(),decided_at=now() where id=t.id returning * into result; insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,target_upt_id,metadata,idempotency_key) values (t.source_record_id,'TRANSFER_REJECTED',auth.uid(),t.source_upt_id,t.target_upt_id,jsonb_build_object('transferId',t.id,'note',p_note),t.id::text); return result; end if;
  select * into r from public.mtu_khs_records where id=t.source_record_id for update; if not found or r.version is distinct from t.source_version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  if not exists (select 1 from public.upt a join public.upt b on b.id=t.target_upt_id where a.id=r.upt_id and a.uit_id is not null and a.uit_id=b.uit_id) then raise exception 'MTU_TRANSFER_CROSS_UIT'; end if;
  if (t.target_gudang_id is null) <> (t.target_lokasi_id is null) then raise exception 'MTU_TARGET_LOCATION_REQUIRED'; end if;
  if (t.target_ultg_id is not null or t.target_gardu_induk_id is not null or t.target_bay_id is not null) and (t.target_ultg_id is null or t.target_gardu_induk_id is null or t.target_bay_id is null) then raise exception 'MTU_TARGET_HIERARCHY_REQUIRED'; end if;
  if (t.target_gardu_induk_id is null or t.target_bay_id is null) and t.target_gudang_id is null then raise exception 'MTU_TARGET_LOCATION_REQUIRED'; end if;
  if t.target_gudang_id is not null and not exists (select 1 from public.gudang where id=t.target_gudang_id and upt_id=t.target_upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if t.target_lokasi_id is not null and not exists (select 1 from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=t.target_lokasi_id and g.upt_id=t.target_upt_id and g.id=t.target_gudang_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if t.target_ultg_id is not null and not exists (select 1 from public.ultg where id=t.target_ultg_id and upt_id=t.target_upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if t.target_gardu_induk_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk where id=t.target_gardu_induk_id and upt_id=t.target_upt_id and ultg_id=t.target_ultg_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if t.target_bay_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay where id=t.target_bay_id and gardu_induk_id=t.target_gardu_induk_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  select r.data || jsonb_strip_nulls(jsonb_build_object(
    'uptId',t.target_upt_id,
    'uptName',coalesce(u.data->>'nama',u.data->>'name',u.id),
    'ultgId',t.target_ultg_id,
    'ultgName',(select coalesce(x.data->>'nama',x.data->>'name',x.id) from public.ultg x where x.id=t.target_ultg_id),
    'garduIndukId',t.target_gardu_induk_id,
    'giName',(select coalesce(x.data->>'nama',x.data->>'name',x.id) from public.mtu_khs_gardu_induk x where x.id=t.target_gardu_induk_id),
    'bayId',t.target_bay_id,
    'bayName',(select coalesce(x.data->>'nama',x.data->>'name',x.id) from public.mtu_khs_gardu_induk_bay x where x.id=t.target_bay_id),
    'gudangId',t.target_gudang_id,
    'gudangName',(select coalesce(x.data->>'nama',x.data->>'name',x.id) from public.gudang x where x.id=t.target_gudang_id),
    'lokasiId',t.target_lokasi_id,
    'lokasiName',(select coalesce(x.data->>'nama',x.data->>'name',x.data->>'kode',x.id) from public.lokasi x where x.id=t.target_lokasi_id),
    'qty',t.qty,'physicalQty',t.qty,'remainingQty',t.qty,'transferId',t.id,'transferredFrom',r.id
  )) into target_data from public.upt u where u.id=t.target_upt_id;
  available := r.qty - greatest(coalesce((select sum(qty) from public.mtu_khs_receipts where mtu_record_id=r.id),0), coalesce((select sum(qty) from public.mtu_khs_usage_links where mtu_record_id=r.id and status='APPROVED'),0), coalesce((select sum(qty) from public.mtu_khs_stock_links where mtu_record_id=r.id),0)); if t.qty > available then raise exception 'MTU_QTY_BOUND'; end if;
  if t.qty = r.qty then
    update public.mtu_khs_records set upt_id=t.target_upt_id,ultg_id=t.target_ultg_id,gardu_induk_id=t.target_gardu_induk_id,bay_id=t.target_bay_id,gudang_id=t.target_gudang_id,lokasi_id=t.target_lokasi_id,version=version+1,updated_at=now(),data=target_data where id=r.id returning id into new_id;
    update public.mtu_khs_transfer_requests set target_record_id=new_id,after_snapshot=(select to_jsonb(x) from public.mtu_khs_records x where x.id=new_id) where id=t.id;
  else
    new_id := 'MTU-KHS-TRANSFER-' || gen_random_uuid()::text;
    insert into public.mtu_khs_records(id,upt_id,ultg_id,gardu_induk_id,bay_id,gudang_id,lokasi_id,mtu_spec_id,katalog_id,supplier_id,procurement_year,lifecycle_status,sifat_pekerjaan,qty,data,created_by) select new_id,t.target_upt_id,t.target_ultg_id,t.target_gardu_induk_id,t.target_bay_id,t.target_gudang_id,t.target_lokasi_id,r.mtu_spec_id,r.katalog_id,r.supplier_id,r.procurement_year,r.lifecycle_status,r.sifat_pekerjaan,t.qty,target_data,auth.uid();
    insert into public.mtu_khs_record_evidence(record_id,kind,object_path,mime_type,size_bytes,uploaded_by,inherited_from) select new_id,kind,object_path,mime_type,size_bytes,auth.uid(),id from public.mtu_khs_record_evidence where record_id=r.id and superseded_at is null;
    update public.mtu_khs_records set qty=qty-t.qty,version=version+1,updated_at=now(),data=coalesce(data,'{}'::jsonb)||jsonb_build_object('qty',qty-t.qty,'physicalQty',qty-t.qty,'remainingQty',qty-t.qty) where id=r.id;
    update public.mtu_khs_transfer_requests set target_record_id=new_id,after_snapshot=(select to_jsonb(x) from public.mtu_khs_records x where x.id=new_id) where id=t.id;
    insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,target_upt_id,before_data,after_data,metadata,idempotency_key) values (r.id,'TRANSFER_SPLIT',auth.uid(),t.source_upt_id,t.target_upt_id,to_jsonb(r),(select to_jsonb(x) from public.mtu_khs_records x where x.id=r.id),jsonb_build_object('transferId',t.id,'targetRecordId',new_id,'qty',t.qty),t.id::text || ':split');
  end if;
  update public.mtu_khs_transfer_requests set status='APPROVED',decision_note=coalesce(p_note,''),decided_by=auth.uid(),decided_at=now() where id=t.id returning * into result;
  insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,target_upt_id,before_data,after_data,metadata,idempotency_key) values (r.id,'TRANSFER_APPROVED',auth.uid(),t.source_upt_id,t.target_upt_id,to_jsonb(r),(select to_jsonb(x) from public.mtu_khs_records x where x.id=r.id),jsonb_build_object('transferId',t.id,'targetRecordId',new_id),t.id::text);
  return result;
end; $$;

create or replace function public.mtu_khs_transfer_destinations(p_target_upt_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.profiles; target_uit text; result jsonb;
begin
  select * into actor from public.profiles where id=auth.uid();
  select uit_id into target_uit from public.upt where id=p_target_upt_id;
  if target_uit is null then raise exception 'MTU_TARGET_UPT_INVALID'; end if;
  if actor.role not in ('SUPERADMIN','ADMIN_LOG_PUSAT','PENGADAAN') and not exists (select 1 from public.upt own where own.id=actor.upt_id and own.uit_id=target_uit) and actor.uit_id is distinct from target_uit then raise exception 'MTU_SCOPE_DENIED'; end if;
  select jsonb_build_object(
    'ultg', coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.data->>'nama',u.data->>'name',u.id),'uptId',u.upt_id) order by u.id) from public.ultg u where u.upt_id=p_target_upt_id and lower(coalesce(u.data->>'active','true')) <> 'false'),'[]'::jsonb),
    'gis', coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',coalesce(g.data->>'nama',g.data->>'name',g.id),'uptId',g.upt_id,'ultgId',g.ultg_id) order by g.id) from public.mtu_khs_gardu_induk g where g.upt_id=p_target_upt_id and g.active),'[]'::jsonb),
    'bays', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',coalesce(b.data->>'nama',b.data->>'name',b.id),'garduIndukId',b.gardu_induk_id) order by b.id) from public.mtu_khs_gardu_induk_bay b join public.mtu_khs_gardu_induk g on g.id=b.gardu_induk_id where g.upt_id=p_target_upt_id and b.active),'[]'::jsonb),
    'gudangs', coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',coalesce(g.data->>'nama',g.data->>'name',g.id),'uptId',g.upt_id) order by g.id) from public.gudang g where g.upt_id=p_target_upt_id and lower(coalesce(g.data->>'active','true')) <> 'false'),'[]'::jsonb),
    'lokasis', coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',coalesce(l.data->>'nama',l.data->>'name',l.data->>'kode',l.id),'gudangId',l.gudang_id) order by l.id) from public.lokasi l join public.gudang g on g.id=l.gudang_id where g.upt_id=p_target_upt_id and lower(coalesce(l.data->>'active','true')) <> 'false' and lower(coalesce(g.data->>'active','true')) <> 'false'),'[]'::jsonb)
  ) into result;
  return result;
end; $$;

create or replace function public.mtu_khs_register_evidence(p_record_id text, p_kind text, p_object_path text, p_mime_type text, p_size_bytes bigint, p_idempotency_key text)
returns public.mtu_khs_record_evidence language plpgsql security definer set search_path = public, storage as $$
declare r public.mtu_khs_records; result public.mtu_khs_record_evidence; old public.mtu_khs_record_evidence;
begin
  select * into r from public.mtu_khs_records where id=p_record_id; if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.profiles where id=auth.uid() and role in ('TL','SUPERADMIN')) then raise exception 'MTU_ROLE_DENIED'; end if;
  if p_kind not in ('ITEM','NAMEPLATE') or p_mime_type not like 'image/%' or p_size_bytes <= 0 or p_size_bytes > 2097152 or p_object_path not like r.upt_id || '/' || r.id || '/%' then raise exception 'MTU_EVIDENCE_INVALID'; end if;
  if not exists (select 1 from storage.objects where bucket_id='mtu-khs-evidence' and name=p_object_path and lower(coalesce(metadata->>'mimetype','')) = lower(p_mime_type) and (metadata->>'size') ~ '^[0-9]+$' and case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end = p_size_bytes and case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end <= 2097152) then raise exception 'MTU_EVIDENCE_OBJECT_MISSING'; end if;
  select * into result from public.mtu_khs_record_evidence where record_id=r.id and kind=p_kind and superseded_at is null order by created_at desc limit 1;
  if found and result.object_path = p_object_path then return result; end if;
  update public.mtu_khs_record_evidence set superseded_at=now() where record_id=r.id and kind=p_kind and superseded_at is null returning * into old;
  insert into public.mtu_khs_record_evidence(record_id,kind,object_path,mime_type,size_bytes,uploaded_by,inherited_from) values (r.id,p_kind,p_object_path,p_mime_type,p_size_bytes,auth.uid(),old.id) returning * into result;
  insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,after_data,metadata,idempotency_key) values (r.id,'EVIDENCE_REGISTERED',auth.uid(),r.upt_id,to_jsonb(result),jsonb_build_object('kind',p_kind),p_idempotency_key);
  return result;
end; $$;

create or replace function public.mtu_khs_list_records(p_year integer default null, p_lifecycle_status text default null, p_vendor text default null, p_upt_id text default null, p_search text default null, p_rfq text default null, p_contract_kr text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q text := public.mtu_khs_search_text(to_jsonb(coalesce(p_search,''))); result jsonb;
begin
  with filtered as (
    select r.*, case when q='' then 0 else (case when lower(coalesce(r.data->>'mtuCode',''))=q or lower(coalesce(r.data->>'noKontrak',''))=q or lower(coalesce(r.data->>'contractDetailNumber',''))=q then 100 else 0 end) + (case when r.search_text like q||'%' then 20 else 0 end) + similarity(r.search_text,q)*10 end score
    from public.mtu_khs_records r where public.mtu_khs_can_access_upt(r.upt_id) and (p_year is null or r.procurement_year=p_year) and (p_lifecycle_status is null or r.lifecycle_status=p_lifecycle_status) and (p_vendor is null or lower(coalesce(r.data->>'vendor',''))=lower(p_vendor)) and (p_upt_id is null or r.upt_id=p_upt_id) and (p_rfq is null or lower(coalesce(r.data->>'mtuCode',''))=lower(p_rfq)) and (p_contract_kr is null or lower(coalesce(r.data->>'contractDetailNumber',r.data->>'noKontrak',''))=lower(p_contract_kr)) and (q='' or not exists (select 1 from regexp_split_to_table(q, '\s+') token where token <> '' and r.search_text not like '%' || token || '%' and word_similarity(token, r.search_text) < 0.45))
  ), items as (select coalesce(jsonb_agg(to_jsonb(page_rows) order by score desc, updated_at desc), '[]'::jsonb) value from (select * from filtered order by score desc,updated_at desc limit greatest(1,least(p_limit,1000)) offset greatest(0,p_offset)) page_rows), facets as (select coalesce(jsonb_agg(distinct data->>'mtuCode') filter (where data->>'mtuCode' is not null),'[]'::jsonb) rfqs, coalesce(jsonb_agg(distinct coalesce(data->>'contractDetailNumber',data->>'noKontrak')) filter (where coalesce(data->>'contractDetailNumber',data->>'noKontrak') is not null),'[]'::jsonb) contract_krs from filtered)
  select jsonb_build_object('items',items.value,'total',(select count(*) from filtered),'facets',jsonb_build_object('rfqs',facets.rfqs,'contractKrs',facets.contract_krs),'vendors',(select coalesce(jsonb_agg(distinct data->>'vendor'),'[]'::jsonb) from filtered)) into result from items,facets;
  return result;
end; $$;

revoke all on function public.mtu_khs_update_operational(text,integer,jsonb,text), public.mtu_khs_request_transfer(text,integer,numeric,text,text,text,text,text,text,text,text), public.mtu_khs_decide_transfer(uuid,text,text), public.mtu_khs_transfer_destinations(text), public.mtu_khs_register_evidence(text,text,text,text,bigint,text), public.mtu_khs_list_records(integer,text,text,text,text,text,text,integer,integer) from public;
grant execute on function public.mtu_khs_update_operational(text,integer,jsonb,text), public.mtu_khs_request_transfer(text,integer,numeric,text,text,text,text,text,text,text,text), public.mtu_khs_decide_transfer(uuid,text,text), public.mtu_khs_transfer_destinations(text), public.mtu_khs_register_evidence(text,text,text,text,bigint,text), public.mtu_khs_list_records(integer,text,text,text,text,text,text,integer,integer) to authenticated;
notify pgrst, 'reload schema';
