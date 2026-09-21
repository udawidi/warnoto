# Quickstart Validation

## Prasyarat

- Dependencies project sudah terpasang.
- Migration fitur sudah diterapkan pada environment uji.
- Akun HAR UIT memiliki `uit_id` dan ada alat lintas-UPT yang tersedia.

## Verifikasi otomatis

```powershell
node --test tests/unit/heavyEquipmentSupportTools.test.mjs
npm run build
```

Jalankan contract SQL pada database uji dan pastikan rollback selesai tanpa error.

## Skenario manual

1. Masuk sebagai HAR UIT, pilih UPT pemilik dan alat, isi data wajib, biarkan Surat Peminjaman kosong, lalu ajukan. Pengajuan harus tersimpan.
2. Ulangi dengan PDF atau gambar. Riwayat harus menampilkan `Lihat surat peminjaman` dan dokumen dapat dibuka.
3. Pastikan pengajuan lama yang mempunyai `pickupEvidencePath` tetap dapat membuka dokumennya.
4. Pastikan bukti pengembalian masih wajib.
