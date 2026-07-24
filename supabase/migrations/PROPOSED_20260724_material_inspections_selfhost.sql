-- PROPOSED ONLY — do not apply automatically. Review and execute manually on
-- the self-host WARNOTO Supabase database after approval.
--
-- Canonical inspection rows keep filterable fields typed while checklist,
-- notes, and Storage URLs stay in data jsonb. Images are uploaded to the
-- public bucket below; base64/blob data is never persisted in this table.
create table if not exists material_inspections (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  stock_id text,
  katalog_id text,
  no_katalog text not null default '-',
  nama_barang text not null,
  lokasi_nama text not null,
  kondisi text not null check (kondisi in ('BAIK', 'RUSAK_RINGAN', 'RUSAK_BERAT', 'PERLU_KALIBRASI')),
  status_kelayakan text not null check (status_kelayakan in ('READY', 'MAINTENANCE', 'RETEST', 'ATTB_RECOMMENDED')),
  jenis_mtu text not null,
  inspector_id uuid references profiles(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists idx_material_inspections_created_at on material_inspections(created_at desc);
create index if not exists idx_material_inspections_no_katalog on material_inspections(no_katalog);
create index if not exists idx_material_inspections_status on material_inspections(status_kelayakan, kondisi);
create index if not exists idx_material_inspections_location on material_inspections(lokasi_nama);

alter table material_inspections enable row level security;
drop policy if exists "Authenticated read material_inspections" on material_inspections;
drop policy if exists "Authenticated write material_inspections" on material_inspections;
create policy "Authenticated read material_inspections" on material_inspections
  for select using (auth.role() = 'authenticated');
create policy "Authenticated write material_inspections" on material_inspections
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on material_inspections to authenticated;
grant all on material_inspections to service_role;

-- Images are documentation for printable inspection reports, so they need
-- stable public URLs. Restrict writes to authenticated sessions.
insert into storage.buckets (id, name, public)
values ('material-inspection-photos', 'material-inspection-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read material-inspection-photos" on storage.objects;
drop policy if exists "Authenticated upload material-inspection-photos" on storage.objects;
drop policy if exists "Authenticated update material-inspection-photos" on storage.objects;
create policy "Public read material-inspection-photos" on storage.objects
  for select using (bucket_id = 'material-inspection-photos');
create policy "Authenticated upload material-inspection-photos" on storage.objects
  for insert with check (bucket_id = 'material-inspection-photos' and auth.role() = 'authenticated');
create policy "Authenticated update material-inspection-photos" on storage.objects
  for update using (bucket_id = 'material-inspection-photos' and auth.role() = 'authenticated');
