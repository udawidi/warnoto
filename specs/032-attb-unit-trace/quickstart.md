# Quickstart Validation

1. Jalankan contract test ATTB trace dan migration rehearsal.
2. Jalankan migration pada PostgreSQL scratch, lalu ulangi verifikasi idempotency.
3. Finalkan TUG-10 berisi dua unit katalog sama; pastikan dua ATTB/token/event berbeda.
4. Scan kedua QR; pastikan payload/timeline tidak bercampur dan field sensitif tidak ada.
5. Rotasi token satu unit; QR lama invalid, QR baru valid.
6. Jalankan `npm test`, `npm run build`, dan `git diff --check`.

Production migration, commit, dan push dilakukan hanya setelah persetujuan pengguna.

