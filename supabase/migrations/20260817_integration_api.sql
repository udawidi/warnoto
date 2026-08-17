-- PROPOSAL — belum di-apply. Apply manual via ssh minipc-gudang + docker exec
-- supabase-db psql setelah konfirmasi user.
--
-- Fase 1 "Integrasi API" — fondasi API-key ter-scope untuk aplikasi pihak
-- ketiga (khususnya SAP S/4HANA) membaca data WARNOTO lewat Edge Function
-- supabase/functions/integration-api. Key disimpan HASH saja (sha256 hex),
-- plaintext hanya ditunjukkan sekali saat dibuat (lihat endpoint POST /keys).
--
-- RLS enable TANPA policy anon/authenticated di kedua tabel (default deny) —
-- hanya service_role (dipakai Edge Function) yang bisa baca/tulis.

create table if not exists integration_api_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  key_prefix text not null,          -- cth "wrn_live_ab12", ditampilkan di UI list (bukan rahasia)
  key_hash text not null unique,     -- sha256 hex dari full key, TIDAK PERNAH simpan plaintext
  scopes text[] not null default '{}',
  created_by uuid,
  created_at timestamptz default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  rate_limit_per_min int default 120
);

create table if not exists integration_request_log (
  id bigserial primary key,
  key_id uuid references integration_api_keys(id),
  endpoint text,
  method text,
  status int,
  ip text,
  at timestamptz default now()
);
create index if not exists idx_integration_request_log_key_at on integration_request_log(key_id, at);

alter table integration_api_keys enable row level security;
alter table integration_request_log enable row level security;
-- Sengaja TANPA create policy — default deny untuk anon/authenticated,
-- akses hanya lewat service_role di dalam Edge Function.
