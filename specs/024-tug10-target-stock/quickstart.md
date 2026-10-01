# Quickstart: Verifikasi TUG-10 Target Stok

1. Jalankan unit test kontrak TUG-10 dan build.
2. Jalankan Playwright approval dengan stok awal qty 3 dan retur qty 3.
3. Rehearse migration/RPC dalam transaksi PostgreSQL yang diakhiri `ROLLBACK`.
4. Pastikan target yang sama menjadi qty 6, source lot tidak berubah, dan tidak ada `STK-TUG10-*` baru.
5. Setelah persetujuan production: backup, apply migration via `ssh minipc-gudang`, jalankan verifier, refresh browser, lalu retry dokumen 276.
