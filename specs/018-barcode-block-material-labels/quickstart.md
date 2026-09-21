# Quickstart: Label Material Barcode Blok

## Automated verification

```powershell
node --test tests/unit/qrBlok.test.mjs
npm run build
git diff --check
```

Expected: semua test lulus, build selesai, dan tidak ada whitespace error.

## Database verification

Setelah pengguna menyetujui apply migration:

1. Terapkan `supabase/migrations/20260921_public_block_material_labels.sql` secara transactional dengan `ON_ERROR_STOP=1`.
2. Jalankan `supabase/verify_lokasi_public_qr.sql`.
3. Pastikan token valid menghasilkan material dengan `sapLabel` dan `jenisBarang` non-empty.
4. Pastikan token salah tetap menghasilkan `null`.
5. Pastikan jumlah stok, katalog, gudang, lokasi, dan token tidak berubah.

## Browser smoke test

1. Buka Master Data > Master Gudang > Barcode Blok Gudang.
2. Pindai satu barcode blok yang memiliki material SAP dan Non-SAP.
3. Pastikan setiap kartu menampilkan Status dan Jenis.
4. Pastikan nama, nomor katalog, jumlah, dan satuan tetap sama.
5. Buka URL QR pada sesi tanpa login; daftar tetap baca-saja.
