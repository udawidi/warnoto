-- Security fix P1-katalog (opsi B, disetujui user 2026-08-18).
-- Sebelumnya "Authenticated write katalog" mengizinkan SEMUA authenticated (using(true)
-- with check(true)) menulis katalog, termasuk VIEWER (role read-only) — REST-write bisa
-- dipicu langsung oleh sesi VIEWER/anon-yang-login-viewer, bukan cuma lewat UI aplikasi.
--
-- Opsi B: tulis katalog tetap boleh untuk SEMUA role operasional (ADMIN, TL, ASMAN,
-- MANAGER, ADMIN_UIT, ASMAN_LOG_UIT, MGR_LOGISTIK_UIT, ADMIN_LOG_PUSAT, PENGADAAN,
-- ADMIN_ULTG, MGR_ULTG, SUPERADMIN, dll) — HANYA VIEWER yang ditolak, karena VIEWER
-- satu-satunya role read-only (src/lib/roles.js) dan katalog ditulis dari banyak alur
-- operasional sah (Tambah/Edit Katalog, TUG buat/approve, Opname tambah-material,
-- Material Cadang, Migrasi, seed, auto-sync TUG-15).
--
-- Baca publik (anon SELECT + policy "Public read katalog") TIDAK diubah.
drop policy if exists "Authenticated write katalog" on public.katalog;
create policy "Operational write katalog" on public.katalog
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role <> 'VIEWER'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role <> 'VIEWER'));
