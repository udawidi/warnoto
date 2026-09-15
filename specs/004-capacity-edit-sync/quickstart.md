# Quickstart Validation

1. Jalankan `node --test tests/unit/warehouseCapacity.test.mjs`.
2. Jalankan `node scripts/check-push-kapasitas-map.mjs`.
3. Jalankan `npm test` dan `npm run build`.
4. Apply migration dengan transaksi tunggal dan `ON_ERROR_STOP=1`; verifikasi seluruh 44 baris tetap ada dan constraint tervalidasi.
5. Di production, edit satu record dengan total komposisi <=100%, simpan, setujui preview Sheet, lalu refresh.
6. Cocokkan nilai detail aplikasi, baris DB, dan kolom H:P Sheet.
7. Uji total 100,01%; simpan harus ditolak sebelum request DB/Sheet.
8. Batalkan konfirmasi Sheet; DB harus tetap tersimpan dan tombol push manual tetap dapat menjadi retry.
