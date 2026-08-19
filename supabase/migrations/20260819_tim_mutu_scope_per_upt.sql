-- Scope tim_mutu per-UPT (2026-08-19).
-- Sama seperti satpam (lihat 20260819_satpam_scope_per_upt.sql): policy lama
-- `tim_mutu` = semua authenticated baca/tulis SEMUA UPT → TL UPT-SBY bocor melihat
-- tim mutu 6 UPT lain. Beda dari satpam, tim_mutu SUDAH punya `uptId` langsung di
-- kolom `data` (tiap baris terisi), jadi tak perlu helper join gudang — cukup
-- can_access_upt(data->>'uptId') langsung.
-- Definisi: user melihat tim mutu HANYA untuk UPT yang boleh ia akses
-- (Pusat/SUPERADMIN semua; UIT semua UPT di UIT-nya; UPT hanya UPT sendiri).

drop policy if exists "Authenticated write tim_mutu" on public.tim_mutu;

create policy "Scoped all tim_mutu"
  on public.tim_mutu
  for all
  using (can_access_upt(data->>'uptId'))
  with check (can_access_upt(data->>'uptId'));
