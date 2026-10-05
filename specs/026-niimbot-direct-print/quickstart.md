# Quickstart: Cetak Langsung NIIMBOT M2-H

## Automated verification

```powershell
node --test tests/unit/niimbotPrint.test.mjs tests/unit/kartuGantungCompact.test.mjs
npm test
npm run build
git diff --check
```

Expected: seluruh test lulus, build selesai, dan tidak ada whitespace error.

## Android Chrome smoke test

1. Pasang roll 50×70 mm pada NIIMBOT M2-H dan nyalakan printer.
2. Aktifkan Bluetooth dan Lokasi Android.
3. Buka WARNOTO melalui HTTPS di Chrome langsung, bukan browser dalam aplikasi.
4. Buka Data Stock > Kartu Gantung > Kartu Depan.
5. Tekan cetak NIIMBOT compact, pilih M2-H, lalu izinkan koneksi.
6. Pastikan satu label tercetak landscape: QR di kiri; SATUAN, deskripsi, dan nomor katalog tersusun di kanan.
7. Cetak material kedua. Pastikan tidak muncul dialog perangkat bila koneksi masih aktif.
8. Tekan A4 Existing. Pastikan tab A4 terbuka tanpa dialog Bluetooth.
9. Matikan printer dan coba ulang. Pastikan pesan gagal tampil dan tombol aktif kembali.

## Calibration note

Jika hasil fisik bergeser karena roll, catat arah dan jarak offset dalam milimeter. Jangan mengubah ukuran nominal label atau jalur A4.

