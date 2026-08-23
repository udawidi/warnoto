-- TUG-10 (barang kembali/retur) pindah dari blob localStorage `pln_txns_v3` ke
-- tabel DB terisolasi per-UPT — parity persis TUG-3 (20260821b_tug3_transactions.sql),
-- alasan sama: risiko data-loss di blob. Pola generik master {id, data jsonb}
-- SELURUH field txn (header pekerjaan, stockItems, foto URL, meta approval) di `data`.
create table if not exists tug10_transactions (
  id text primary key,                  -- id app (format legacy txn id, cth TXN-...)
  upt_id text not null,
  created_by uuid,                      -- auth.uid() pembuat (untuk gate edit)
  doc_number text,                      -- diisi saat "Ajukan" (draft belum ada nomor)
  stage text not null default 'DRAFT',
  status text not null default 'DRAFT',
  data jsonb not null default '{}',
  created_at bigint,
  updated_at bigint
);

alter table tug10_transactions enable row level security;

-- Baca: se-UPT (approver wajib lihat transaksi UPT-nya) + nasional (SUPERADMIN/Pusat)
-- lewat helper `can_access_upt` yang sudah dipakai master lain (satpam scope).
drop policy if exists "read tug10 scoped"  on tug10_transactions;
drop policy if exists "write tug10 scoped" on tug10_transactions;
create policy "read tug10 scoped"  on tug10_transactions
  for select using (auth.uid() is not null and can_access_upt(upt_id));
create policy "write tug10 scoped" on tug10_transactions
  for all using (can_access_upt(upt_id)) with check (can_access_upt(upt_id));

-- Grant wajib: tanpa ini Edge Function (service_role) baca tabel baru = kosong senyap.
grant select, insert, update, delete on tug10_transactions to authenticated;
grant select, insert, update, delete on tug10_transactions to service_role;

create index if not exists idx_tug10_transactions_upt on tug10_transactions (upt_id);
