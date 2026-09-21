# Requirements Checklist

- [x] Penghapusan freeze mencakup UI, RPC, trigger, guard, helper, dan test terkait.
- [x] Simpan/edit Stock Opname tidak lagi diblokir oleh status freeze.
- [x] Realtime `stock_opname` dan `updated_at` dipertahankan.
- [x] Kolom/data legacy `freeze` tidak dimutasi massal dan tidak dipakai sebagai guard.
- [x] GI dan Barcode diverifikasi tetap berfungsi.
- [x] Tidak ada dependency atau perubahan skema baru.
