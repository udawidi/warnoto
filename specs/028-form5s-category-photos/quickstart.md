# Quickstart Validation

1. Jalankan `npm test` dan `npm run build`.
2. Buka Form 5S pada desktop dan viewport HP.
3. Isi draft dengan foto parsial pada dua kategori, refresh, lalu pastikan seluruh metadata pulih pada kategori yang benar.
4. Pastikan finalisasi ditolak sebelum lima kategori masing-masing memiliki tiga foto.
5. Upload 15 foto sumber besar; pastikan metadata ukuran hasil tidak melebihi 2 MiB dan final berhasil disimpan pada environment uji.
6. Buka history baru dan cetak PDF; pastikan lima lampiran kategori masing-masing berisi tiga foto.
7. Simulasikan request/image macet; tombol cetak harus aktif maksimal 16 detik dan slot gagal menjadi placeholder.
8. Buka record legacy satu sampai tiga foto; history dan PDF tetap berfungsi.

Migration production dan redeploy Edge Function tidak dijalankan tanpa persetujuan eksplisit pengguna.
