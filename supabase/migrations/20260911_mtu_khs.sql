-- PROPOSAL ONLY: MTU KHS dedicated data model.
-- Do not apply to production without explicit user approval.
-- Depends on public.profiles, public.uit, public.upt, public.ultg and can_access_upt(text).

create or replace function public.mtu_khs_can_access_upt(p_upt_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in ('SUPERADMIN', 'ADMIN_LOG_PUSAT', 'PENGADAAN')
        or public.can_access_upt(p_upt_id)
        or (
          p.role in ('ADMIN_UIT', 'ASMAN_LOG_UIT', 'MGR_LOGISTIK_UIT')
          and exists (select 1 from public.upt u where u.id = p_upt_id and u.uit_id = p.uit_id)
        )
      )
  );
$$;
revoke all on function public.mtu_khs_can_access_upt(text) from public;
grant execute on function public.mtu_khs_can_access_upt(text) to authenticated;

create table if not exists public.mtu_khs_gardu_induk (
  id text primary key,
  upt_id text references public.upt(id) on delete restrict,
  ultg_id text not null references public.ultg(id) on delete restrict,
  normalized_name text,
  data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mtu_khs_gardu_induk add column if not exists upt_id text;
alter table public.mtu_khs_gardu_induk add column if not exists normalized_name text;
update public.mtu_khs_gardu_induk gi
set upt_id = coalesce(gi.upt_id, u.upt_id),
    normalized_name = coalesce(nullif(gi.normalized_name, ''), upper(regexp_replace(btrim(coalesce(gi.data->>'normalizedName', gi.data->>'nama', gi.data->>'name', gi.id)), '\s+', ' ', 'g')))
from public.ultg u
where u.id = gi.ultg_id;
alter table public.mtu_khs_gardu_induk alter column upt_id set not null;
alter table public.mtu_khs_gardu_induk alter column normalized_name set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mtu_khs_gardu_induk_upt_id_fkey') then
    alter table public.mtu_khs_gardu_induk add constraint mtu_khs_gardu_induk_upt_id_fkey foreign key (upt_id) references public.upt(id) on delete restrict;
  end if;
end $$;
create unique index if not exists uq_mtu_khs_gi_upt_name on public.mtu_khs_gardu_induk(upt_id, normalized_name);
create index if not exists idx_mtu_khs_gi_ultg on public.mtu_khs_gardu_induk(ultg_id);
create index if not exists idx_mtu_khs_gi_upt on public.mtu_khs_gardu_induk(upt_id);

create table if not exists public.mtu_khs_gardu_induk_bay (
  id text primary key,
  gardu_induk_id text not null references public.mtu_khs_gardu_induk(id) on delete restrict,
  normalized_name text,
  data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mtu_khs_gardu_induk_bay add column if not exists normalized_name text;
update public.mtu_khs_gardu_induk_bay bay
set normalized_name = coalesce(nullif(bay.normalized_name, ''), upper(regexp_replace(btrim(coalesce(bay.data->>'normalizedName', bay.data->>'nama', bay.data->>'name', bay.id)), '\s+', ' ', 'g')));
alter table public.mtu_khs_gardu_induk_bay alter column normalized_name set not null;
create unique index if not exists uq_mtu_khs_bay_gi_name on public.mtu_khs_gardu_induk_bay(gardu_induk_id, normalized_name);
create index if not exists idx_mtu_khs_bay_gi on public.mtu_khs_gardu_induk_bay(gardu_induk_id);

create table if not exists public.mtu_khs_specs (
  id text primary key,
  procurement_year integer not null,
  mtu_code text not null,
  vendor text,
  katalog_id text references public.katalog(id) on delete set null,
  mapping_status text not null default 'CANDIDATE' check (mapping_status in ('CANDIDATE', 'APPROVED', 'REJECTED')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (procurement_year, mtu_code, vendor)
);
create index if not exists idx_mtu_khs_specs_code on public.mtu_khs_specs(mtu_code);

create table if not exists public.mtu_khs_records (
  id text primary key,
  upt_id text not null references public.upt(id) on delete restrict,
  ultg_id text references public.ultg(id) on delete restrict,
  gardu_induk_id text references public.mtu_khs_gardu_induk(id) on delete restrict,
  bay_id text references public.mtu_khs_gardu_induk_bay(id) on delete restrict,
  gudang_id text references public.gudang(id) on delete restrict,
  mtu_spec_id text references public.mtu_khs_specs(id) on delete set null,
  katalog_id text references public.katalog(id) on delete set null,
  supplier_id text references public.supplier(id) on delete set null,
  procurement_year integer not null,
  lifecycle_status text not null default 'VENDOR' check (lifecycle_status in ('VENDOR', 'IN_TRANSIT', 'WAREHOUSE', 'ON_SITE', 'INSTALLED', 'CANCELLED')),
  sifat_pekerjaan text not null default 'MATERIAL' check (sifat_pekerjaan in ('MATERIAL', 'SUPERVISI')),
  qty numeric not null default 0 check (qty >= 0),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
alter table public.mtu_khs_records add column if not exists katalog_id text references public.katalog(id) on delete set null;
alter table public.mtu_khs_records add column if not exists supplier_id text references public.supplier(id) on delete set null;
create index if not exists idx_mtu_khs_records_upt on public.mtu_khs_records(upt_id);
create index if not exists idx_mtu_khs_records_year on public.mtu_khs_records(procurement_year);
create index if not exists idx_mtu_khs_records_status on public.mtu_khs_records(lifecycle_status);

create table if not exists public.mtu_khs_units (
  id text primary key,
  record_id text not null references public.mtu_khs_records(id) on delete cascade,
  serial_number text,
  lifecycle_status text not null default 'VENDOR' check (lifecycle_status in ('VENDOR', 'IN_TRANSIT', 'WAREHOUSE', 'ON_SITE', 'INSTALLED', 'CANCELLED')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_mtu_khs_units_record on public.mtu_khs_units(record_id);

create table if not exists public.mtu_khs_documents (
  id text primary key,
  vendor text not null,
  procurement_year integer not null,
  mtu_code text not null,
  document_type text not null check (document_type in ('DRAWING', 'CATALOG', 'TPG', 'TYPE_TEST', 'SCHEMATIC', 'NAMEPLATE', 'OTHER')),
  revision text not null default '',
  title text not null,
  url text not null check (url ~* '^https://'),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (vendor, procurement_year, mtu_code, document_type, revision, url)
);
create index if not exists idx_mtu_khs_documents_match on public.mtu_khs_documents(vendor, procurement_year, mtu_code);

create table if not exists public.mtu_khs_record_documents (
  record_id text not null references public.mtu_khs_records(id) on delete cascade,
  document_id text not null references public.mtu_khs_documents(id) on delete restrict,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (record_id, document_id)
);

create table if not exists public.mtu_khs_usage_links (
  id text primary key,
  mtu_record_id text not null references public.mtu_khs_records(id) on delete cascade,
  tug_item_id text not null,
  qty numeric not null check (qty > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.mtu_khs_change_requests (
  id text primary key,
  record_id text not null references public.mtu_khs_records(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  requester_role text not null,
  approver_role text not null check (approver_role in ('ASMAN', 'ASMAN_LOG_UIT')),
  approver_upt_id text references public.upt(id),
  approver_uit_id text references public.uit(id),
  patch jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  decision_note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_mtu_khs_changes_status on public.mtu_khs_change_requests(status);

create table if not exists public.mtu_khs_import_batches (
  id text primary key,
  procurement_year integer not null,
  uit_id text references public.uit(id),
  source_file text not null,
  status text not null default 'STAGED' check (status in ('STAGED', 'REVIEW', 'APPROVED', 'REJECTED')),
  summary jsonb not null default '{}'::jsonb,
  file_sha256 text not null default '',
  sheet_name text not null default '',
  committed_at timestamptz,
  commit_idempotency_key text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.mtu_khs_import_rows (
  id text primary key,
  batch_id text not null references public.mtu_khs_import_batches(id) on delete cascade,
  source_row integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  duplicate_candidate boolean not null default false,
  raw_row_sha256 text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_mtu_khs_import_rows_batch on public.mtu_khs_import_rows(batch_id);

alter table public.mtu_khs_gardu_induk enable row level security;
alter table public.mtu_khs_gardu_induk_bay enable row level security;
alter table public.mtu_khs_specs enable row level security;
alter table public.mtu_khs_records enable row level security;
alter table public.mtu_khs_units enable row level security;
alter table public.mtu_khs_documents enable row level security;
alter table public.mtu_khs_record_documents enable row level security;
alter table public.mtu_khs_usage_links enable row level security;
alter table public.mtu_khs_change_requests enable row level security;
alter table public.mtu_khs_import_batches enable row level security;
alter table public.mtu_khs_import_rows enable row level security;

drop policy if exists "MTU KHS GI scoped" on public.mtu_khs_gardu_induk;
create policy "MTU KHS GI scoped" on public.mtu_khs_gardu_induk for select using (public.mtu_khs_can_access_upt(upt_id));
drop policy if exists "MTU KHS Bay scoped" on public.mtu_khs_gardu_induk_bay;
create policy "MTU KHS Bay scoped" on public.mtu_khs_gardu_induk_bay for select using (exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = gardu_induk_id and public.mtu_khs_can_access_upt(gi.upt_id)));
drop policy if exists "MTU KHS specs read" on public.mtu_khs_specs;
create policy "MTU KHS specs read" on public.mtu_khs_specs for select using (auth.uid() is not null);
drop policy if exists "MTU KHS records scoped" on public.mtu_khs_records;
create policy "MTU KHS records scoped" on public.mtu_khs_records for select using (public.mtu_khs_can_access_upt(upt_id));
drop policy if exists "MTU KHS records controlled write" on public.mtu_khs_records;
create policy "MTU KHS records controlled write" on public.mtu_khs_records for insert with check (false);
create policy "MTU KHS records no direct update" on public.mtu_khs_records for update using (false) with check (false);
create policy "MTU KHS records no direct delete" on public.mtu_khs_records for delete using (false);
drop policy if exists "MTU KHS units scoped" on public.mtu_khs_units;
create policy "MTU KHS units scoped" on public.mtu_khs_units for select using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS documents read" on public.mtu_khs_documents;
create policy "MTU KHS documents read" on public.mtu_khs_documents for select using (auth.uid() is not null);
drop policy if exists "MTU KHS record documents scoped" on public.mtu_khs_record_documents;
create policy "MTU KHS record documents scoped" on public.mtu_khs_record_documents for select using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS usage scoped" on public.mtu_khs_usage_links;
create policy "MTU KHS usage scoped" on public.mtu_khs_usage_links for select using (exists (select 1 from public.mtu_khs_records r where r.id = mtu_record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS changes scoped" on public.mtu_khs_change_requests;
create policy "MTU KHS changes scoped" on public.mtu_khs_change_requests for select using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS import batches" on public.mtu_khs_import_batches;
create policy "MTU KHS import batches" on public.mtu_khs_import_batches for select using (auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role in ('SUPERADMIN', 'PENGADAAN', 'ADMIN_LOG_PUSAT') or (p.role = 'ASMAN_LOG_UIT' and p.uit_id = mtu_khs_import_batches.uit_id))));
drop policy if exists "MTU KHS import rows" on public.mtu_khs_import_rows;
create policy "MTU KHS import rows" on public.mtu_khs_import_rows for select using (exists (select 1 from public.mtu_khs_import_batches b where b.id = batch_id and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role in ('SUPERADMIN', 'PENGADAAN', 'ADMIN_LOG_PUSAT') or (p.role = 'ASMAN_LOG_UIT' and p.uit_id = b.uit_id)))));

grant select on public.mtu_khs_gardu_induk, public.mtu_khs_gardu_induk_bay, public.mtu_khs_specs, public.mtu_khs_records, public.mtu_khs_units, public.mtu_khs_documents, public.mtu_khs_record_documents, public.mtu_khs_usage_links, public.mtu_khs_change_requests, public.mtu_khs_import_batches, public.mtu_khs_import_rows to authenticated;
revoke insert, update, delete on public.mtu_khs_gardu_induk, public.mtu_khs_gardu_induk_bay, public.mtu_khs_specs, public.mtu_khs_records, public.mtu_khs_units, public.mtu_khs_documents, public.mtu_khs_record_documents, public.mtu_khs_usage_links, public.mtu_khs_change_requests, public.mtu_khs_import_batches, public.mtu_khs_import_rows from authenticated;

create or replace function public.mtu_khs_submit_change(p_record_id text, p_expected_version integer, p_patch jsonb, p_idempotency_key text)
returns public.mtu_khs_change_requests
language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; requester public.profiles; result public.mtu_khs_change_requests; target_role text; target_upt text; target_uit text; effective_gi text; effective_bay text;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if p_expected_version is null or p_expected_version <> r.version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  effective_gi := case when p_patch ? 'garduIndukId' then nullif(p_patch->>'garduIndukId','') else r.gardu_induk_id end;
  effective_bay := case when p_patch ? 'bayId' then nullif(p_patch->>'bayId','') else r.bay_id end;
  if effective_gi is not null and not exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = effective_gi and gi.upt_id = r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_bay is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = effective_bay and gi.upt_id = r.upt_id and gi.id = effective_gi) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_patch ? 'gudangId' and not exists (select 1 from public.gudang g where g.id = p_patch->>'gudangId' and g.upt_id = r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if exists (select 1 from public.mtu_khs_change_requests where record_id = r.id and patch->>'_idempotency_key' = p_idempotency_key) then select * into result from public.mtu_khs_change_requests where record_id = r.id and patch->>'_idempotency_key' = p_idempotency_key limit 1; return result; end if;
  select * into requester from public.profiles where id = auth.uid();
  if requester.role not in ('TL', 'PENGADAAN', 'SUPERADMIN') then raise exception 'Role tidak boleh mengajukan perubahan MTU'; end if;
  if requester.role = 'TL' and exists (select 1 from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) key where key not in ('location','onsiteDate','garduIndukId','bayId','gudangId','serialNumber','installationStatus','installationPlanDate','installationDate','reason')) then raise exception 'MTU_FIELD_FORBIDDEN'; end if;
  if requester.role = 'PENGADAAN' and exists (select 1 from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) key where key not in ('vendor','noKontrak','tanggalKontrak','noSpmk','tanggalSerahTerima','price','documentId','mtuCode','reason')) then raise exception 'MTU_FIELD_FORBIDDEN'; end if;
  select u.uit_id into target_uit from public.upt u where u.id = r.upt_id;
  if requester.role = 'PENGADAAN' then target_role := 'ASMAN_LOG_UIT'; target_upt := null; else target_role := 'ASMAN'; target_upt := r.upt_id; end if;
  insert into public.mtu_khs_change_requests(id, record_id, requested_by, requester_role, approver_role, approver_upt_id, approver_uit_id, patch)
  values ('MTU-CHG-' || gen_random_uuid()::text, r.id, auth.uid(), requester.role, target_role, target_upt, target_uit, coalesce(p_patch, '{}'::jsonb) || jsonb_build_object('_idempotency_key', p_idempotency_key))
  returning * into result;
  return result;
end;
$$;

create or replace function public.mtu_khs_decide_change(p_change_id text, p_decision text, p_note text default '')
returns public.mtu_khs_change_requests
language plpgsql security definer set search_path = public
as $$
declare c public.mtu_khs_change_requests; r public.mtu_khs_records; p public.profiles; result public.mtu_khs_change_requests;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then raise exception 'Keputusan approval tidak valid'; end if;
  select * into c from public.mtu_khs_change_requests where id = p_change_id and status = 'PENDING' for update;
  if not found then raise exception 'Perubahan MTU tidak ditemukan atau sudah diputus'; end if;
  select * into r from public.mtu_khs_records where id = c.record_id;
  select * into p from public.profiles where id = auth.uid();
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN' and not (p.role = 'ASMAN' and p.upt_id = c.approver_upt_id) then raise exception 'Bukan ASMAN UPT tujuan'; end if;
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN_LOG_UIT' and not (p.role = 'ASMAN_LOG_UIT' and p.uit_id = c.approver_uit_id) then raise exception 'Bukan ASMAN_LOG_UIT tujuan'; end if;
  update public.mtu_khs_change_requests set status = p_decision, decision_note = p_note, decided_by = auth.uid(), decided_at = now() where id = c.id returning * into result;
  if p_decision = 'APPROVED' then
    update public.mtu_khs_records set data = data || (c.patch - '_idempotency_key'), updated_at = now(), version = version + 1, lifecycle_status = case when c.patch ? 'lifecycleStatus' then nullif(c.patch->>'lifecycleStatus','') else lifecycle_status end, gardu_induk_id = case when c.patch ? 'garduIndukId' then nullif(c.patch->>'garduIndukId','') else gardu_induk_id end, bay_id = case when c.patch ? 'bayId' then nullif(c.patch->>'bayId','') else bay_id end, gudang_id = case when c.patch ? 'gudangId' then nullif(c.patch->>'gudangId','') else gudang_id end where id = r.id and version = r.version;
    if not found then raise exception 'MTU_VERSION_CONFLICT'; end if;
  end if;
  return result;
end;
$$;

revoke all on function public.mtu_khs_submit_change(text, integer, jsonb, text) from public;
revoke all on function public.mtu_khs_decide_change(text, text, text) from public;
grant execute on function public.mtu_khs_submit_change(text, integer, jsonb, text) to authenticated;
grant execute on function public.mtu_khs_decide_change(text, text, text) to authenticated;

create or replace function public.mtu_khs_commit_import(p_batch_id text, p_idempotency_key text)
returns integer language plpgsql security definer set search_path = public
as $$
declare b public.mtu_khs_import_batches; row_item record; inserted_count integer := 0;
begin
  select * into b from public.mtu_khs_import_batches where id = p_batch_id for update;
  if not found then raise exception 'MTU_IMPORT_NOT_FOUND'; end if;
  if b.committed_at is not null then
    if b.commit_idempotency_key = p_idempotency_key then return coalesce((b.summary->>'committedCount')::integer, 0); end if;
    raise exception 'MTU_IMPORT_ALREADY_COMMITTED';
  end if;
  if b.status <> 'APPROVED' then raise exception 'MTU_APPROVER_INVALID'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT')) then raise exception 'MTU_APPROVER_INVALID'; end if;
  if exists (select 1 from public.mtu_khs_import_rows where batch_id = b.id and jsonb_array_length(validation_errors) > 0) then raise exception 'MTU_MAPPING_REQUIRED'; end if;
  for row_item in select * from public.mtu_khs_import_rows where batch_id = b.id order by source_row loop
    if nullif(row_item.normalized_data->>'uptId', '') is null or not exists (select 1 from public.upt where id = row_item.normalized_data->>'uptId' and (b.uit_id is null or uit_id = b.uit_id)) then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    if coalesce((row_item.normalized_data->>'qty')::numeric,0) < 0 then raise exception 'MTU_QTY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'ultgId','') is not null and not exists (select 1 from public.ultg where id = row_item.normalized_data->>'ultgId' and upt_id = row_item.normalized_data->>'uptId') then raise exception 'MTU_HIERARCHY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'garduIndukId','') is not null and not exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = row_item.normalized_data->>'garduIndukId' and gi.upt_id = row_item.normalized_data->>'uptId') then raise exception 'MTU_HIERARCHY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'bayId','') is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = row_item.normalized_data->>'bayId' and gi.upt_id = row_item.normalized_data->>'uptId' and (row_item.normalized_data->>'garduIndukId') = gi.id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'gudangId','') is not null and not exists (select 1 from public.gudang where id = row_item.normalized_data->>'gudangId' and upt_id = row_item.normalized_data->>'uptId') then raise exception 'MTU_HIERARCHY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'mtuSpecId','') is not null and not exists (select 1 from public.mtu_khs_specs where id = row_item.normalized_data->>'mtuSpecId') then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    if nullif(row_item.normalized_data->>'katalogId','') is not null and not exists (select 1 from public.katalog where id = row_item.normalized_data->>'katalogId') then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    if nullif(row_item.normalized_data->>'supplierId','') is not null and not exists (select 1 from public.supplier where id = row_item.normalized_data->>'supplierId') then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    insert into public.mtu_khs_records(id, upt_id, ultg_id, gardu_induk_id, bay_id, gudang_id, mtu_spec_id, katalog_id, supplier_id, procurement_year, sifat_pekerjaan, qty, data, created_by)
    values ('MTU-' || gen_random_uuid()::text, row_item.normalized_data->>'uptId', nullif(row_item.normalized_data->>'ultgId',''), nullif(row_item.normalized_data->>'garduIndukId',''), nullif(row_item.normalized_data->>'bayId',''), nullif(row_item.normalized_data->>'gudangId',''), nullif(row_item.normalized_data->>'mtuSpecId',''), nullif(row_item.normalized_data->>'katalogId',''), nullif(row_item.normalized_data->>'supplierId',''), b.procurement_year, coalesce(row_item.normalized_data->>'sifatPekerjaan','MATERIAL'), case when coalesce(row_item.normalized_data->>'sifatPekerjaan','MATERIAL') = 'SUPERVISI' then 0 else coalesce((row_item.normalized_data->>'qty')::numeric,0) end, row_item.normalized_data, auth.uid());
    inserted_count := inserted_count + 1;
  end loop;
  update public.mtu_khs_import_batches set status = 'APPROVED', committed_at = now(), commit_idempotency_key = p_idempotency_key, summary = summary || jsonb_build_object('committedCount', inserted_count) where id = b.id;
  return inserted_count;
end;
$$;
revoke all on function public.mtu_khs_commit_import(text, text) from public;
grant execute on function public.mtu_khs_commit_import(text, text) to authenticated;

create or replace function public.mtu_khs_decide_import(p_batch_id text, p_decision text, p_note text default '')
returns public.mtu_khs_import_batches language plpgsql security definer set search_path = public
as $$
declare b public.mtu_khs_import_batches; p public.profiles; result public.mtu_khs_import_batches;
begin
  select * into b from public.mtu_khs_import_batches where id = p_batch_id for update;
  if not found then raise exception 'MTU_IMPORT_NOT_FOUND'; end if;
  select * into p from public.profiles where id = auth.uid();
  if not found or p_decision not in ('APPROVED','REJECTED') then raise exception 'MTU_APPROVER_INVALID'; end if;
  -- SUPERADMIN is the project-wide emergency approver; normal approvals stay UIT-scoped.
  if p.role <> 'SUPERADMIN' and (p.role <> 'ASMAN_LOG_UIT' or p.uit_id is distinct from b.uit_id) then raise exception 'MTU_APPROVER_INVALID'; end if;
  update public.mtu_khs_import_batches set status = p_decision, summary = summary || jsonb_build_object('approvalNote', p_note), committed_at = case when p_decision = 'REJECTED' then null else committed_at end where id = b.id returning * into result;
  return result;
end;
$$;
revoke all on function public.mtu_khs_decide_import(text,text,text) from public;
grant execute on function public.mtu_khs_decide_import(text,text,text) to authenticated;

create or replace function public.mtu_khs_attach_document(p_record_id text, p_document_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; d public.mtu_khs_documents;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into d from public.mtu_khs_documents where id = p_document_id;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if d.procurement_year <> r.procurement_year or upper(d.vendor) <> upper(coalesce(r.data->>'vendor','')) or d.mtu_code <> coalesce(r.data->>'mtuCode','') then raise exception 'MTU_DRAWING_YEAR_MISMATCH'; end if;
  insert into public.mtu_khs_record_documents(record_id, document_id, created_by) values (r.id, d.id, auth.uid()) on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.mtu_khs_attach_document(text,text) from public;
grant execute on function public.mtu_khs_attach_document(text,text) to authenticated;

create or replace function public.mtu_khs_register_document(p_id text, p_record_id text, p_document_type text, p_title text, p_url text, p_revision text default '')
returns public.mtu_khs_documents language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; result public.mtu_khs_documents; vendor_name text; code text;
begin
  select * into r from public.mtu_khs_records where id = p_record_id;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) or p_url !~* '^https://' or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  vendor_name := coalesce(r.data->>'vendor',''); code := coalesce(r.data->>'mtuCode','');
  insert into public.mtu_khs_documents(id, vendor, procurement_year, mtu_code, document_type, revision, title, url, data) values (p_id, vendor_name, r.procurement_year, code, p_document_type, coalesce(p_revision,''), p_title, p_url, jsonb_build_object('recordId', r.id)) on conflict (id) do update set title = excluded.title, url = excluded.url, revision = excluded.revision returning * into result;
  insert into public.mtu_khs_record_documents(record_id, document_id, created_by) values (r.id, result.id, auth.uid()) on conflict do nothing;
  return result;
end;
$$;
revoke all on function public.mtu_khs_register_document(text,text,text,text,text,text) from public;
grant execute on function public.mtu_khs_register_document(text,text,text,text,text,text) to authenticated;

create or replace function public.mtu_khs_link_approved_tug(p_record_id text, p_tug_item_id uuid, p_qty numeric)
returns public.mtu_khs_usage_links language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; i public.tug_items; t public.tug_transactions; result public.mtu_khs_usage_links;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into i from public.tug_items where id = p_tug_item_id;
  select * into t from public.tug_transactions where id = i.transaction_id;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) or t.upt_id <> r.upt_id or t.status <> 'FINAL_APPROVED' or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN','TL')) then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > i.qty then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  if exists (select 1 from public.mtu_khs_usage_links where mtu_record_id = r.id and tug_item_id = p_tug_item_id::text) then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  if coalesce((select sum(qty) from public.mtu_khs_usage_links where mtu_record_id = r.id and status = 'APPROVED'),0) + p_qty > r.qty then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  insert into public.mtu_khs_usage_links(id, mtu_record_id, tug_item_id, qty, status, created_by) values ('MTU-USE-' || gen_random_uuid()::text, r.id, p_tug_item_id::text, p_qty, 'APPROVED', auth.uid()) returning * into result;
  return result;
end;
$$;
revoke all on function public.mtu_khs_link_approved_tug(text,uuid,numeric) from public;
grant execute on function public.mtu_khs_link_approved_tug(text,uuid,numeric) to authenticated;

create or replace function public.mtu_khs_upsert_gardu_induk(p_id text, p_ultg_id text, p_data jsonb)
returns public.mtu_khs_gardu_induk language plpgsql security definer set search_path = public
as $$
declare result public.mtu_khs_gardu_induk; target_upt text; target_name text;
begin
  select u.upt_id into target_upt from public.ultg u where u.id = p_ultg_id;
  target_name := upper(regexp_replace(btrim(coalesce(p_data->>'normalizedName', p_data->>'nama', p_data->>'name', p_id)), '\s+', ' ', 'g'));
  if target_upt is null or target_name = '' then raise exception 'MTU_MASTER_INVALID'; end if;
  if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','TL')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  insert into public.mtu_khs_gardu_induk(id, upt_id, ultg_id, normalized_name, data, created_by) values (p_id, target_upt, p_ultg_id, target_name, coalesce(p_data,'{}'::jsonb) || jsonb_build_object('normalizedName', target_name), auth.uid()) on conflict (id) do update set upt_id = excluded.upt_id, ultg_id = excluded.ultg_id, normalized_name = excluded.normalized_name, data = excluded.data, updated_at = now() returning * into result;
  return result;
end;
$$;

create or replace function public.mtu_khs_upsert_bay(p_id text, p_gardu_induk_id text, p_data jsonb)
returns public.mtu_khs_gardu_induk_bay language plpgsql security definer set search_path = public
as $$
declare result public.mtu_khs_gardu_induk_bay; target_upt text; target_name text;
begin
  select gi.upt_id into target_upt from public.mtu_khs_gardu_induk gi where gi.id = p_gardu_induk_id;
  target_name := upper(regexp_replace(btrim(coalesce(p_data->>'normalizedName', p_data->>'nama', p_data->>'name', p_id)), '\s+', ' ', 'g'));
  if target_upt is null or target_name = '' then raise exception 'MTU_MASTER_INVALID'; end if;
  if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','TL')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  insert into public.mtu_khs_gardu_induk_bay(id, gardu_induk_id, normalized_name, data, created_by) values (p_id, p_gardu_induk_id, target_name, coalesce(p_data,'{}'::jsonb) || jsonb_build_object('normalizedName', target_name), auth.uid()) on conflict (id) do update set gardu_induk_id = excluded.gardu_induk_id, normalized_name = excluded.normalized_name, data = excluded.data, updated_at = now() returning * into result;
  return result;
end;
$$;

revoke all on function public.mtu_khs_upsert_gardu_induk(text,text,jsonb), public.mtu_khs_upsert_bay(text,text,jsonb) from public;
grant execute on function public.mtu_khs_upsert_gardu_induk(text,text,jsonb), public.mtu_khs_upsert_bay(text,text,jsonb) to authenticated;

create or replace function public.mtu_khs_deactivate_site_master(p_table_name text, p_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare target_upt text; in_use boolean := false;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','TL')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if p_table_name = 'mtu_khs_gardu_induk' then
    select gi.upt_id into target_upt from public.mtu_khs_gardu_induk gi where gi.id = p_id;
    if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
    select exists (select 1 from public.mtu_khs_records where gardu_induk_id = p_id) into in_use;
    if in_use then raise exception 'MTU_MASTER_IN_USE'; end if;
    update public.mtu_khs_gardu_induk set active = false, updated_at = now() where id = p_id;
  elsif p_table_name = 'mtu_khs_gardu_induk_bay' then
    select gi.upt_id into target_upt from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = p_id;
    if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
    select exists (select 1 from public.mtu_khs_records where bay_id = p_id) into in_use;
    if in_use then raise exception 'MTU_MASTER_IN_USE'; end if;
    update public.mtu_khs_gardu_induk_bay set active = false, updated_at = now() where id = p_id;
  else raise exception 'MTU_MASTER_INVALID'; end if;
  return true;
end;
$$;
revoke all on function public.mtu_khs_deactivate_site_master(text,text) from public;
grant execute on function public.mtu_khs_deactivate_site_master(text,text) to authenticated;

create or replace function public.mtu_khs_stage_import(p_batch_id text, p_procurement_year integer, p_uit_id text, p_source_file text, p_file_sha256 text, p_sheet_name text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public
as $$
declare actor public.profiles; row_item jsonb; n integer := 0;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.role not in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT') then raise exception 'MTU_SCOPE_DENIED'; end if;
  if exists (select 1 from public.mtu_khs_import_batches where file_sha256 = coalesce(p_file_sha256,'') and sheet_name = coalesce(p_sheet_name,'')) then raise exception 'MTU_IMPORT_ALREADY_STAGED'; end if;
  insert into public.mtu_khs_import_batches(id, procurement_year, uit_id, source_file, file_sha256, sheet_name, status, created_by) values (p_batch_id, p_procurement_year, p_uit_id, p_source_file, coalesce(p_file_sha256,''), coalesce(p_sheet_name,''), 'REVIEW', auth.uid());
  for row_item in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    insert into public.mtu_khs_import_rows(id, batch_id, source_row, raw_data, normalized_data, validation_errors, duplicate_candidate, raw_row_sha256) values (p_batch_id || '-' || n::text, p_batch_id, coalesce((row_item->>'rowNumber')::integer,n), coalesce(row_item->'rawData','{}'::jsonb), coalesce(row_item->'source','{}'::jsonb), coalesce(row_item->'validation'->'errors','[]'::jsonb), coalesce((row_item->>'duplicateCandidate')::boolean,false), coalesce(row_item->>'rawRowSha256',''));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.mtu_khs_stage_import(text,integer,text,text,text,text,jsonb) from public;
grant execute on function public.mtu_khs_stage_import(text,integer,text,text,text,text,jsonb) to authenticated;

create or replace function public.mtu_khs_update_import_row_mapping(p_row_id text, p_mapping jsonb)
returns public.mtu_khs_import_rows language plpgsql security definer set search_path = public
as $$
declare row_item public.mtu_khs_import_rows; batch_item public.mtu_khs_import_batches; actor public.profiles; merged jsonb; errors text[] := ARRAY[]::text[]; target_upt text; target_ultg text; target_gi text; target_bay text; target_gudang text;
begin
  select * into row_item from public.mtu_khs_import_rows where id = p_row_id for update;
  if not found then raise exception 'MTU_IMPORT_ROW_NOT_FOUND'; end if;
  select * into batch_item from public.mtu_khs_import_batches where id = row_item.batch_id;
  select * into actor from public.profiles where id = auth.uid();
  if actor.role not in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT','ASMAN_LOG_UIT') then raise exception 'MTU_SCOPE_DENIED'; end if;
  if actor.role = 'ASMAN_LOG_UIT' and actor.uit_id is distinct from batch_item.uit_id then raise exception 'MTU_SCOPE_DENIED'; end if;
  if batch_item.status not in ('STAGED','REVIEW') then raise exception 'MTU_IMPORT_ALREADY_COMMITTED'; end if;
  merged := row_item.normalized_data || coalesce(p_mapping, '{}'::jsonb);
  target_upt := nullif(merged->>'uptId',''); target_ultg := nullif(merged->>'ultgId',''); target_gi := nullif(merged->>'garduIndukId',''); target_bay := nullif(merged->>'bayId',''); target_gudang := nullif(merged->>'gudangId','');
  if target_upt is null or not exists (select 1 from public.upt where id = target_upt) then errors := errors || 'MTU_MAPPING_REQUIRED:UPT'; end if;
  if batch_item.uit_id is not null and target_upt is not null and not exists (select 1 from public.upt where id = target_upt and uit_id = batch_item.uit_id) then errors := errors || 'MTU_HIERARCHY_INVALID:UPT_UIT'; end if;
  if target_ultg is not null and not exists (select 1 from public.ultg where id = target_ultg and upt_id = target_upt) then errors := errors || 'MTU_HIERARCHY_INVALID:ULTG'; end if;
  if nullif(merged->>'giName','') is not null and target_gi is null and target_bay is null and target_gudang is null then errors := errors || 'MTU_MAPPING_REQUIRED:SITE'; end if;
  if target_gi is not null and not exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = target_gi and gi.upt_id = target_upt) then errors := errors || 'MTU_HIERARCHY_INVALID:GI'; end if;
  if target_bay is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = target_bay and gi.upt_id = target_upt and (target_gi is null or gi.id = target_gi)) then errors := errors || 'MTU_HIERARCHY_INVALID:BAY'; end if;
  if target_gudang is not null and not exists (select 1 from public.gudang where id = target_gudang and upt_id = target_upt) then errors := errors || 'MTU_HIERARCHY_INVALID:GUDANG'; end if;
  if nullif(merged->>'provider','') is not null and nullif(merged->>'supplierId','') is null then errors := errors || 'MTU_MAPPING_REQUIRED:SUPPLIER'; end if;
  if nullif(merged->>'supplierId','') is not null and not exists (select 1 from public.supplier where id = merged->>'supplierId') then errors := errors || 'MTU_MAPPING_INVALID:SUPPLIER'; end if;
  if nullif(merged->>'mtuCode','') is not null and nullif(merged->>'mtuSpecId','') is null and nullif(merged->>'katalogId','') is null then errors := errors || 'MTU_MAPPING_REQUIRED:SPEC'; end if;
  if nullif(merged->>'mtuSpecId','') is not null and not exists (select 1 from public.mtu_khs_specs where id = merged->>'mtuSpecId') then errors := errors || 'MTU_MAPPING_INVALID:SPEC'; end if;
  if nullif(merged->>'katalogId','') is not null and not exists (select 1 from public.katalog where id = merged->>'katalogId') then errors := errors || 'MTU_MAPPING_INVALID:KATALOG'; end if;
  update public.mtu_khs_import_rows set normalized_data = merged, validation_errors = to_jsonb(errors) where id = row_item.id returning * into row_item;
  return row_item;
end;
$$;
revoke all on function public.mtu_khs_update_import_row_mapping(text,jsonb) from public;
grant execute on function public.mtu_khs_update_import_row_mapping(text,jsonb) to authenticated;
