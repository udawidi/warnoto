-- Live Location Alat Berat — BATCH 1 (fondasi): tabel posisi/riwayat/profil operator.
-- Role OPERATOR + UI/peta/realtime client BELUM ada (batch berikut) — RLS di sini
-- sengaja permisif-tapi-authenticated dulu, diperketat per-UPT saat role OPERATOR masuk.
-- PROPOSAL: file ini TIDAK dieksekusi otomatis, menunggu apply manual user.

create table if not exists equipment_location (
  equipment_id text primary key,
  lat float8,
  lng float8,
  accuracy float8,
  updated_at bigint,
  updated_by uuid references profiles(id) on delete set null,
  upt text,
  status text check (status in ('MOVING','STOPPED'))
);

create table if not exists equipment_trip (
  id text primary key,
  equipment_id text,
  operator_id uuid references profiles(id) on delete set null,
  upt text,
  started_at bigint,
  ended_at bigint,
  distance_m float8,
  point_count int,
  path jsonb
);

create table if not exists operator_profile (
  user_id uuid primary key references profiles(id) on delete cascade,
  phone text,
  sio_photo text,
  sia_photo text,
  updated_at bigint
);

alter table equipment_location enable row level security;
alter table equipment_trip enable row level security;
alter table operator_profile enable row level security;

-- TODO scope UPT batch role: sementara authenticated penuh, diperketat ke scope
-- UPT operator/admin/TL saat role OPERATOR dan perms-nya masuk (batch berikutnya).
drop policy if exists "Authenticated read equipment_location" on equipment_location;
drop policy if exists "Authenticated write equipment_location" on equipment_location;
create policy "Authenticated read equipment_location" on equipment_location for select using (auth.role() = 'authenticated');
create policy "Authenticated write equipment_location" on equipment_location for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read equipment_trip" on equipment_trip;
drop policy if exists "Authenticated write equipment_trip" on equipment_trip;
create policy "Authenticated read equipment_trip" on equipment_trip for select using (auth.role() = 'authenticated');
create policy "Authenticated write equipment_trip" on equipment_trip for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read operator_profile" on operator_profile;
drop policy if exists "Authenticated write operator_profile" on operator_profile;
create policy "Authenticated read operator_profile" on operator_profile for select using (auth.role() = 'authenticated');
create policy "Authenticated write operator_profile" on operator_profile for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Grant wajib: tanpa ini service_role (EF) baca/tulis tabel baru = kosong/gagal senyap
-- (pola sama notif_outbox.sql:45-48, [[selfhost-new-table-service-role-grant]]).
grant select, insert, update, delete on equipment_location to authenticated;
grant all on equipment_location to service_role;
grant select, insert, update, delete on equipment_trip to authenticated;
grant all on equipment_trip to service_role;
grant select, insert, update, delete on operator_profile to authenticated;
grant all on operator_profile to service_role;

-- Realtime hanya equipment_location (posisi live) — equipment_trip/operator_profile
-- tidak butuh streaming. Idempoten (pola sama komentar schema.sql:78-89).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'equipment_location'
     ) then
    alter publication supabase_realtime add table public.equipment_location;
  end if;
end $$;
