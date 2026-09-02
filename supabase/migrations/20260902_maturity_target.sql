-- Target nilai maturity per UPT/tahun/semester (History Audit Kondisi). Nullable —
-- belum semua UPT/periode punya target. Kolom typed di tabel yang sudah ada
-- (unique upt/tahun/semester), bukan tabel baru.

alter table public.maturity_audit_history
  add column if not exists target numeric(4,2) check (target is null or (target between 0 and 5));

grant select, insert, update, delete on public.maturity_audit_history to authenticated;
grant all on public.maturity_audit_history to service_role;

-- Write policy: tabel ini historisnya seed-only (cuma read policy yang ke-migrasi
-- dari cloud), jadi write pertama dari app (set target) kena 403 walau GRANT ada.
-- Tambah policy write (idempotent) selaras schema.sql. UX dibatasi UIT/Pusat di UI;
-- RLS mengikuti pola tabel ini (authenticated), tidak diperketat di luar scope.
drop policy if exists "Authenticated write maturity_audit_history" on maturity_audit_history;
create policy "Authenticated write maturity_audit_history" on maturity_audit_history
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
