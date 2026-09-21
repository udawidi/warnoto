# Data Model: Optional Heavy Equipment Loan Letter

## Heavy Equipment Loan

Tidak ada tabel atau kolom baru.

Field kompatibilitas dalam metadata:

- `pickupEvidencePath`: string path storage atau `null` untuk HAR UIT tanpa surat.
- `borrowerType`: `HAR_UIT` menentukan bahwa surat boleh kosong.
- `loanBatchId`: mengikat satu surat opsional dengan satu batch peminjaman.
- `ownerUptId`: menjadi prefix wajib bila surat tersedia.

## Loan Letter Object

- Format: PDF, JPEG, PNG, atau WebP.
- Path: `<ownerUptId>/<loanBatchId>/loan-letter.<extension>`.
- Relasi: nol atau satu surat per batch.
- Validasi: bila path terisi, prefix harus sama dengan UPT pemilik.

## State Transitions

Tidak berubah: pengajuan HAR UIT tetap masuk `PENDING_OWNER_ASMAN`; approval, peminjaman aktif, penolakan, dan pengembalian mengikuti alur existing. Bukti pengembalian tetap wajib.
