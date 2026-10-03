# Quickstart

1. `npm test`
2. `node --test tests/unit/stockOpnamePhotoHistory.test.mjs tests/unit/stockOpnamePhotoScoped.contract.test.mjs`
3. `npm run build`
4. Dry-run backfill: `node scripts/stock_opname_photo_history_backfill.mjs`
5. Dry-run embedding: `node scripts/embed_stock_photos.mjs --all`

Migration `supabase/migrations/20261003_stock_opname_photo_scoped.sql` dan staged cleanup `20261003b_stock_opname_photo_scoped_cleanup.sql` hanya proposal. Jangan jalankan `--write` atau menerapkan migration tanpa persetujuan production; cleanup dijalankan setelah frontend memakai RPC scoped.
