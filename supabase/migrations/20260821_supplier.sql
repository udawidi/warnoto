-- Master Supplier (vendor pengirim barang masuk TUG-3/4).
-- Pola generik master WARNOTO: {id, data jsonb, created_at} — field asli (nama, pic,
-- telp, alamat) disimpan di `data`, dibaca/ditulis via syncMasterTable("supplier", ...).
-- Scope NASIONAL (semua authenticated baca/tulis): supplier = vendor bersama antar-UPT,
-- bukan data rahasia per-UPT (beda dari satpam yang per-gudang).
create table if not exists supplier (
  id text primary key,
  data jsonb not null,       -- { nama, pic, telp, alamat }
  created_at bigint
);

alter table supplier enable row level security;

drop policy if exists "Authenticated read supplier"  on supplier;
drop policy if exists "Authenticated write supplier" on supplier;
create policy "Authenticated read supplier"  on supplier
  for select using (auth.role() = 'authenticated');
create policy "Authenticated write supplier" on supplier
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Grant wajib: tanpa ini Edge Function (service_role) baca tabel baru = kosong senyap.
grant select, insert, update, delete on supplier to authenticated;
grant select, insert, update, delete on supplier to service_role;
