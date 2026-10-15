# Quickstart Validation: BA Non Stock / Pinjam

## Prasyarat

- Migration diuji pada PostgreSQL scratch; jangan apply production tanpa persetujuan.
- Dev app berjalan pada port 3001.
- Akun ADMIN dan TL pada UPT yang sama tersedia.
- Master gudang memiliki Satpam.

## Skenario Utama

1. Login ADMIN, buka `TUG → Barang Keluar → BA Non Stock / Pinjam`.
2. Simpan draft parsial, refresh, pastikan draft tetap ada.
3. Lengkapi header, satu material manual, dan dua foto; ajukan.
4. Pastikan status `PENDING_TL`, belum ada nomor, dan Data Stock tidak berubah.
5. Login TL UPT yang sama; buka Approval Hub dan pratinjau BA.
6. Approve; pastikan nomor mengikuti `001.BA/<UPT>/<MM>/<YYYY>`.
7. Cetak; pastikan tabel material, dua foto, serta Penerima-Satpam-TL tampil.

## Skenario Negatif

- Submit tanpa foto, satpam, penerima, atau item lengkap ditolak.
- TL UPT lain dan role non-TL ditolak saat approve/reject.
- URL foto palsu ditolak saat final.
- Dua approval paralel tidak menghasilkan nomor sama.
- Reject dengan alasan, perbaiki, dan resubmit berhasil.
- Cari BA berdasarkan nomor, sumber, penerima, referensi, dan material.

## Perintah

```powershell
rtk node --test tests/unit/baNonStock.contract.test.mjs tests/unit/baNonStockDocument.test.mjs
rtk node scripts/rehearse_ba_non_stock.mjs
rtk npx playwright test tests/e2e/ba-non-stock.spec.js --project=desktop-smoke --workers=1
rtk npm test
rtk npm run build
rtk git diff --check
```
