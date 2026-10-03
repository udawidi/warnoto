# Implementation Plan: Foto Stock Opname pada Data Stok

**Branch**: `main` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary

1. Tambahkan helper pure untuk resolusi target per UPT, promosi, history, dan listing sesi.
2. Ubah upload/manual edit dan approval Asman agar fail-closed dan idempoten.
3. Tambahkan tab `Opname` conditional dengan lazy thumbnail dan history scoped.
4. Tambahkan scoped visual-search contract dan migration proposal RLS/RPC.
5. Perluas job embedding untuk stok current dan opname `SELESAI`, termasuk OCR optional.
6. Sediakan backfill dry-run/explicit write dan test contract.
7. Jalankan test/build/diff check; jangan apply migration/backfill write.

## Technical Context

**Language/Version**: React 18, JavaScript, PostgreSQL/Supabase
**Primary Dependencies**: Vite, Supabase JS, Node test runner
**Storage**: `stocks.data`, `stock_opname.data.items`, Supabase Storage `stock-photos`, `stock_photo_embeddings`
**Testing**: focused unit/contract tests, `npm test`, Vite build, diff check
**Target Platform**: browser desktop/mobile dan self-host WARNOTO
**Constraints**: exact UPT isolation, fail-closed trust boundaries, no new dependency, staged migration, no production write

## Constitution Check

- PASS: memakai helper/pola upload, lightbox, tab, RPC, dan RLS existing.
- PASS: tidak menambah dependency atau menghapus `wa_sync_status`.
- PASS: validasi UPT dilakukan pada app dan database; service role saja yang menulis embedding.
- PASS: migration dan backfill disediakan sebagai proposal; production tetap review-first.
- PASS: bootstrap tidak memuat gambar history dan OCR historis hanya on-demand.

## Project Structure

```text
App.jsx
src/components/{DataStokTab,StockOpnameTab}.jsx
src/hooks/useStockOpname.js
src/lib/stockOpnamePhotoHistory.js
scripts/{embed_stock_photos,stock_opname_photo_history_backfill}.mjs
supabase/{schema.sql,migrations/}
tests/unit/
```

**Structure Decision**: perubahan minimum pada alur approval/edit, helper pure bersama, tab conditional, job embedding existing, dan migration proposal terpisah.
