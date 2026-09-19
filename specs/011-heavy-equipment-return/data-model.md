# Data Model: Pengembalian Alat Berat

## Peminjaman Alat

- Identitas: `id`, `equipment_id`.
- Scope: `owner_upt`, `requester_upt`.
- Status aktif persisted: `DIPINJAM` atau legacy `APPROVED`; `OVERDUE` tetap status runtime dari tanggal.
- Transisi: aktif menjadi `SELESAI`.
- Metadata JSONB: `returnedBy`, `returnedAt`.

## Alat Berat

- Identitas: `id` sama dengan `equipment_id` loan.
- Scope: `upt` harus sama dengan pemilik loan.
- Transisi availability: `DIPINJAM` menjadi `TERSEDIA`.
- Metadata aktif yang dikosongkan: `activeLoanId`, `borrowedToUpt`, `borrowedJobName`, `borrowedUntil`.

## Invariant

- Kedua record berubah dalam satu transaksi atau tidak berubah.
- Pelaku harus role ADMIN/TL dan UPT profil cocok dengan pemilik.
- Loan terminal tidak dapat diselesaikan ulang.
- Legacy `activeLoanId` kosong hanya diterima bila tidak ada loan aktif lain untuk alat tersebut.
