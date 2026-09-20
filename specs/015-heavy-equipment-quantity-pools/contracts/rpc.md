# RPC Contract: Quantity Pools

## checkout_heavy_equipment_batch_v2

Input:

- `p_items jsonb`: array `{equipmentId, quantity}`.
- `p_borrower jsonb`, `p_job jsonb`, `p_pickup_evidence_path text`: kontrak existing.

Rules:

- Satu owner UPT per batch.
- `UNIT` wajib quantity `1`.
- `QUANTITY` wajib integer positif dan tidak melebihi saldo setelah row lock.
- Pending lintas-UPT langsung mereservasi saldo.
- Semua item berhasil atau rollback.

Output tetap `{batchId, loans, equipment}`.

## approve_heavy_equipment_batch

Signature existing dipertahankan. Implementasi tidak boleh memakai status biner aset sebagai sumber saldo pool. Rejection melepaskan reservasi.

## complete_heavy_equipment_quantity_loan

Input: `p_loan_id`, `p_good`, `p_damaged`, `p_lost`, `p_return_evidence_path`, `p_condition_note`.

Rules:

- Actor TL owner.
- Jumlah total 1..remaining.
- Catatan wajib bila damaged/lost > 0.
- Append satu return event dan update accumulator dalam row lock yang sama.
- Status menjadi `SELESAI` hanya bila remaining baru nol.

Output `{loan, equipment, balance}`.

