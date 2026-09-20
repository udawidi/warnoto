# Data Model

## Heavy Equipment

- Typed: `id`, `upt_id`, `is_cross_upt_borrowable`, snapshot `upt`.
- JSONB: `assetType`, `gudangId`, identitas alat, status, foto aset, active loan metadata.
- Invariant: pemilik typed dan JSONB harus sama; writer TL harus memiliki `profiles.upt_id` yang sama.

## Heavy Equipment Loan

- Typed: `id`, `equipment_id`, `status`, `owner_upt_id`, nullable `requester_upt_id`, snapshot nama.
- JSONB: `loanBatchId`, borrower type/name/ref/PIC/contact, pekerjaan, tanggal, evidence paths, audit actor/time.
- Satu batch memiliki satu owner UPT dan satu metadata peminjam, tetapi satu row per aset.

## State Transitions

- External checkout: `TERSEDIA -> DIPINJAM`.
- Inter-UPT checkout: `TERSEDIA -> PENDING_OWNER_ASMAN -> DIPINJAM`.
- Rejected: pending menjadi `REJECTED`, aset tetap tersedia.
- Partial return: loan terpilih menjadi `SELESAI`; aset terkait menjadi tersedia.

## Evidence

- Bucket: `heavy-equipment-evidence`, private.
- Path: `<owner_upt_id>/<batch_id>/<equipment_id>-out.<ext>` dan `<equipment_id>-return-<timestamp>.<ext>`.
- Akses mengikuti scope owner; third-party UPT tidak dapat membaca objek.
