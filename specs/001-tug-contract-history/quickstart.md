# Quickstart Validation

1. Jalankan `node --test tests/unit/tugSourceLots.test.mjs tests/unit/tugSourceHistory.test.mjs tests/unit/tugCanonical.contract.test.mjs`.
2. Jalankan `npm run build`.
3. Buat dua penerimaan TUG-3 katalog/lokasi sama: PT A qty 3 dan PT B qty 4. Pastikan dua lot tampil.
4. Buat TUG-8/9 qty 2 dari PT A. Setelah final, pastikan PT A=1 dan PT B=4.
5. Scan katalog yang mempunyai dua lot. Pastikan picker sumber terbuka dan tidak memilih otomatis.
6. Verifikasi Data Stok dan Stock Opname menampilkan dua baris; Stock Count/forecast tetap total 5.
7. Pada database uji, split stok legacy qty 7 menjadi 3+4. Ulangi idempotency key yang sama dan pastikan tidak ada lot tambahan.
8. Jangan apply `20260915_tug_source_lots.sql` ke Supabase production sebelum persetujuan user.
