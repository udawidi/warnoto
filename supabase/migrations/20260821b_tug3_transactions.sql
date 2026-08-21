-- TUG-3/4 (barang masuk) pindah dari blob localStorage `pln_txns_v3` ke tabel DB
-- terisolasi per-UPT. Tabel dedicated (bukan kanonik tug_transactions yang OUT-only &
-- hard-block non-TUG8/9). Pola generik master {id, data jsonb} — SELURUH field txn
-- (supplier, stockItems, foto URL, field TUG-4, meta approval) disimpan di `data`.
-- Gate role per-stage (TL/Asman/pembuat) di klien (hasRole), konsisten master lain.
create table if not exists tug3_transactions (
  id text primary key,                  -- id app (format legacy txn id, cth TXN-...)
  upt_id text not null,
  created_by uuid,                      -- auth.uid() pembuat (untuk gate edit)
  doc_number text,                      -- diisi saat "Ajukan" (draft belum ada nomor)
  stage text not null default 'DRAFT',  -- DRAFT|PENDING_TL|MENUNGGU_TUG4|PENDING_ASMAN|APPROVED|REJECTED
  status text not null default 'DRAFT',
  data jsonb not null default '{}',
  created_at bigint,
  updated_at bigint
);

alter table tug3_transactions enable row level security;

-- Baca: se-UPT (approver wajib lihat transaksi UPT-nya) + nasional (SUPERADMIN/Pusat)
-- lewat helper `can_access_upt` yang sudah dipakai master lain (satpam scope).
drop policy if exists "read tug3 scoped"  on tug3_transactions;
drop policy if exists "write tug3 scoped" on tug3_transactions;
create policy "read tug3 scoped"  on tug3_transactions
  for select using (auth.uid() is not null and can_access_upt(upt_id));
create policy "write tug3 scoped" on tug3_transactions
  for all using (can_access_upt(upt_id)) with check (can_access_upt(upt_id));

-- Grant wajib: tanpa ini Edge Function (service_role) baca tabel baru = kosong senyap.
grant select, insert, update, delete on tug3_transactions to authenticated;
grant select, insert, update, delete on tug3_transactions to service_role;

create index if not exists idx_tug3_transactions_upt on tug3_transactions (upt_id);
