# Contract: `complete_heavy_equipment_loan`

## Input

`p_loan_id text` wajib dan menunjuk loan aktif.

## Authorization

- Sesi authenticated.
- Profil role `ADMIN` atau `TL`.
- UPT profil sama dengan `owner_upt` setelah normalisasi nama UPT.

## Atomic behavior

- Lock loan dan alat.
- Validasi status aktif serta hubungan loan dan alat.
- Update loan menjadi `SELESAI` dan stamp pelaku/waktu server.
- Update alat menjadi `TERSEDIA` dan bersihkan metadata peminjaman aktif.

## Output

`{"loan": {...}, "equipment": {...}}` dalam bentuk canonical frontend.

## Errors

- Tidak terautentikasi.
- Role atau UPT tidak berwenang.
- Loan/alat tidak ditemukan atau tidak cocok.
- Loan tidak lagi aktif.
- Konflik loan aktif/legacy.

Semua error membatalkan transaksi.
