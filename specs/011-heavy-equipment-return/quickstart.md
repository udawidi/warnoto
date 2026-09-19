# Quickstart Validation

1. Jalankan unit/contract test Alat Berat.
2. Jalankan build production.
3. Jalankan E2E fixture: ADMIN/TL pemilik melihat CTA; peminjam tidak.
4. Sebelum migration production, catat jumlah/status alat dan loan serta pastikan backup tersedia.
5. Uji migration dan RPC dalam transaksi `ROLLBACK`, termasuk actor lintas-UPT.
6. Setelah persetujuan user, apply migration self-host dan reload schema PostgREST.
7. Buka `http://localhost:3001`, login ADMIN/TL Surabaya, dan pastikan kartu overdue memiliki CTA tanpa menyelesaikan loan production.

Expected: tidak ada perubahan production sampai pengguna menekan konfirmasi pada data nyata.
