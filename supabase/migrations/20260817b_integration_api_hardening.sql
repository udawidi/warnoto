-- PROPOSAL — belum di-apply. Apply manual via ssh minipc-gudang + docker exec
-- supabase-db psql setelah konfirmasi user.
--
-- Fase 1.5 "Integrasi API" — hardening keamanan API-key: expiry opsional,
-- IP allowlist opsional, dan jejak IP terakhir dipakai. Lanjutan
-- 20260817_integration_api.sql (tabel integration_api_keys / integration_request_log).

alter table integration_api_keys add column if not exists expires_at timestamptz; -- null = tak kedaluwarsa
alter table integration_api_keys add column if not exists allowed_ips text[];     -- null/empty = semua IP boleh
alter table integration_api_keys add column if not exists last_used_ip text;

-- integration_request_log.key_id sudah nullable (`references integration_api_keys(id)`
-- tanpa `not null` di migration awal) — dipakai untuk mencatat percobaan gagal-auth
-- dengan key yang tidak dikenal (key_id anonim). Baris ini idempotent kalau ternyata
-- instalasi lama memaksanya not null.
alter table integration_request_log alter column key_id drop not null;
