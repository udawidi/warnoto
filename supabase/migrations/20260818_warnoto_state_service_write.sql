-- SECURITY FIX P1 (opsi A) — cabut hak tulis langsung ke `warnoto_state`.
-- RLS lama cuma cek `authenticated`, jadi role read-only (VIEWER) atau siapa
-- pun yang login via REST langsung bisa nulis/poison state nasional (dibaca
-- bot Telegram). Sekarang tulis lewat Edge Function `sync-warnoto-state`
-- (service_role, gate role VIEWER ditolak di kode) — lihat App.jsx
-- syncWarnotoState() yang sekarang invoke EF alih-alih insert langsung.
--
-- Baca TIDAK diubah — policy SELECT `authenticated` dipertahankan, bot
-- Telegram & App.jsx masih baca langsung dari tabel.
--
-- JANGAN APPLY OTOMATIS — file draft, tunggu konfirmasi user (lihat CLAUDE.md
-- project: perubahan skema = proposal dulu).

revoke insert, update, delete on public.warnoto_state from authenticated;
revoke insert, update, delete on public.warnoto_state from anon; -- defensif, kemungkinan sudah tidak ada

-- service_role butuh grant eksplisit (gotcha: tabel baru tidak otomatis dapat
-- privilege service_role di setup self-host ini, lihat 20260817c_integration_api_grants.sql).
grant insert on public.warnoto_state to service_role;
