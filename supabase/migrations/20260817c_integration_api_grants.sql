-- Fase 1 fix — GRANT privilege ke service_role untuk tabel integrasi API.
-- WARNOTO mengelola grant secara eksplisit (lihat migration 20260814); tabel
-- baru TIDAK otomatis dapat privilege service_role, jadi Edge Function
-- integration-api (pakai service_role) kena "permission denied" saat query
-- integration_api_keys → semua request balas "API key tidak dikenal".
-- anon/authenticated SENGAJA tidak diberi grant (tetap terkunci RLS default-deny).
--
-- Sudah di-apply manual ke self-host 2026-08-17 (integration_api_keys lewat psql,
-- request_log lewat file ini). Idempoten: grant ulang aman.

grant select, insert, update on public.integration_api_keys to service_role;
grant select, insert on public.integration_request_log to service_role;
grant usage, select on sequence public.integration_request_log_id_seq to service_role;
