-- 20260814_cabut_baca_anon_vestigial.sql
-- Pengetatan GRANT anon — lanjutan gelombang 4c.
--
-- KONTEKS: tulis anon (INSERT/UPDATE/DELETE) sudah tertutup TOTAL di seluruh
-- public (4a/4c). Yang tersisa hanya GRANT SELECT vestigial pada 3 tabel yang
-- RLS-nya SUDAH memblokir anon (0 policy anon, atau qual = authenticated).
-- Mencabut GRANT ini TIDAK mengubah perilaku (RLS tetap gate utama) — ini
-- defense-in-depth: kalau RLS suatu saat tak sengaja dimatikan, anon tetap
-- tak bisa baca. `warnoto_state` (blob seluruh state app) dulu paling rawan.
--
-- SENGAJA TIDAK DISENTUH: `katalog`, `stock_current`, `tug15_history` — anon
-- SELECT-nya dipakai halaman scan QR publik (ScanPublicView.jsx). Jangan cabut.
--
-- Penulis sah tabel-tabel ini: bot Telegram/Edge Function via service_role
-- (bypass GRANT), app via authenticated. anon tidak pernah jadi jalur sah.

REVOKE SELECT ON public.warnoto_state  FROM anon;
REVOKE SELECT ON public.wa_sync_status FROM anon;
REVOKE SELECT ON public.tg_agent_logs  FROM anon;

-- Verifikasi (harus 0 baris = anon tak lagi punya SELECT di ketiganya):
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
--   WHERE grantee='anon' AND table_schema='public'
--   AND table_name IN ('warnoto_state','wa_sync_status','tg_agent_logs')
--   AND privilege_type='SELECT';
