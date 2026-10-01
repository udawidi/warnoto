# Implementation Plan: TUG-10 Target Stok

**Branch**: `main` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

## Summary

Tambahkan `stockHandling` dan `targetStockId` pada item TUG-10. `MERGE` mengunci serta menambah qty baris tujuan tanpa mengubah source lot; `SEPARATE` membuat lot retur TUG-10 deterministik. Legacy hanya auto-target jika kandidat tepat satu, default separate bila nol, dan menolak ambigu bila lebih dari satu.

## Technical Context

**Language/Version**: React 18, JavaScript, PostgreSQL 17 PL/pgSQL
**Primary Dependencies**: Vite, Supabase JS
**Storage**: Supabase self-host PostgreSQL, JSONB `tug10_transactions.data` dan `stocks.data`
**Testing**: Node test, Playwright, PostgreSQL transaction rehearsal
**Target Platform**: Browser desktop/mobile dan self-host `minipc-gudang`
**Project Type**: Web application
**Constraints**: Atomic, idempotent, RLS/scoped UPT, review-first, migration gated approval

## Constitution Check

- PASS: memakai pola RPC dan tabel existing.
- PASS: tidak menambah dependency atau tabel.
- PASS: validasi batas kepercayaan tetap server-side.
- PASS: production tidak diubah sebelum backup dan persetujuan.

## Project Structure

```text
App.jsx
src/components/TugFormModals.jsx
supabase/migrations/
supabase/schema.sql
tests/
```

**Structure Decision**: Perubahan minimum pada form existing, RPC existing melalui migration delta, schema mirror, dan test contracts/E2E.
