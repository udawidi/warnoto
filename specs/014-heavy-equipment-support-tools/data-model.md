# Data Model

## Heavy Equipment

- Typed: `id`, `upt_id`, `is_cross_upt_borrowable`, snapshot `upt`.
- JSONB: `assetType`, `gudangId`, identitas alat, status, foto aset, active loan metadata.
- Invariant: pemilik typed dan JSONB harus sama; writer TL harus memiliki `profiles.upt_id` yang sama.

## Heavy Equipment Loan

- Typed: `id`, `equipment_id`, `status`, `owner_upt_id`, nullable `requester_upt_id`, nullable `requester_uit_id`, snapshot nama.
- JSONB: `loanBatchId`, borrower type/name/ref/PIC/contact, `requesterUitId`, pekerjaan, tanggal, evidence paths, audit actor/time.
- Satu batch memiliki satu owner UPT dan satu metadata peminjam, tetapi satu row per aset.
- Loan HAR_UIT memiliki `requester_upt_id = null`, `requester_uit_id = profiles.uit_id`, `borrowerType = HAR_UIT`, dan snapshot requester `HAR UIT <nama/kode>`.
- Data legacy tidak di-backfill ke `requester_uit_id` tanpa bukti identitas yang dapat dipercaya.

## Scope UIT

- Relasi owner/requester UPT ke UIT diturunkan melalui `upt.uit_id`.
- HAR_UIT hanya dapat membaca aset milik UPT dalam `profiles.uit_id`.
- HAR_UIT dapat membaca loan bila owner UPT atau requester UPT berada dalam UIT akun, atau `requester_uit_id` sama dengan UIT akun.
- HAR_UIT hanya dapat checkout alat tersedia, lintas-UPT aktif, satu owner UPT, dan owner tersebut berada dalam UIT akun.

## State Transitions

- External checkout: `TERSEDIA -> DIPINJAM`.
- Inter-UPT checkout: `TERSEDIA -> PENDING_OWNER_ASMAN -> DIPINJAM`.
- HAR_UIT checkout: `TERSEDIA -> PENDING_OWNER_ASMAN -> DIPINJAM` setelah approval Asman owner.
- Rejected: pending menjadi `REJECTED`, aset tetap tersedia.
- Partial return: loan terpilih menjadi `SELESAI`; aset terkait menjadi tersedia.

## Evidence

- Bucket: `heavy-equipment-evidence`, private.
- Path: `<owner_upt_id>/<batch_id>/<equipment_id>-out.<ext>` dan `<equipment_id>-return-<timestamp>.<ext>`.
- Akses mengikuti scope owner; third-party UPT tidak dapat membaca objek.
- HAR_UIT membaca bukti loan dalam scope UIT, mengunggah ke prefix owner yang valid, dan hanya dapat menghapus objek orphan miliknya setelah transaksi gagal.
