# Implementation Plan: Lot Sumber Material TUG-8/9

**Branch**: `main` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

## Summary

Pertahankan canonical TUG-8/TUG-9 yang mengurangi exact `stockId`, lalu ubah setiap baris stok menjadi satu lot sumber. TUG-3/TUG-10 menulis lot terpisah, picker memilih lot eksplisit, histori menyimpan snapshot server-side, stok lama dibagi lewat RPC atomik, dan tampilan agregat tetap menjumlahkan lot per katalog.

## Technical Context

**Language/Version**: JavaScript/JSX, PostgreSQL PL/pgSQL, React + Vite 4  
**Dependencies**: Supabase JS existing; tanpa dependency baru  
**Storage**: `stocks.data.sourceLot`, `tug_items.source_snapshot`; tanpa tabel baru  
**Testing**: Node test runner, contract tests, Vite build  
**Constraints**: Review-first, RLS/UPT tetap berlaku, migration proposal saja, canonical hash/signature tidak berubah

## Constitution Check

Constitution masih template. Kontrak project mengikat: solusi minimal, server-authoritative, validasi tanpa kehilangan data, perubahan Supabase tidak diterapkan tanpa konfirmasi.

## Architecture Decisions

1. Satu baris `stocks` aktif mewakili satu lot sumber; `stockId` tetap kunci canonical pengurangan saldo.
2. `stocks.data.sourceLot.key` dibuat sekali. TUG-3: `TUG3|upt|lokasi|katalog|supplier|contractIdentity`, fallback transaksi+item. TUG-10: `TUG10|transaction|item`.
3. Finalisasi TUG-3 mencari lot berdasarkan katalog, lokasi, dan `sourceLot.key`, bukan katalog+lokasi saja. Finalisasi TUG-10 memakai key item transaksi.
4. Picker menyaring qty > 0 dan lot aktif. Legacy multi-sumber berstatus perlu alokasi dan tidak selectable.
5. Satu `stockId` hanya boleh satu kali pada draft. Scan ambigu membuka picker yang sama.
6. Helper `tug_source_snapshot_for_stock` memprioritaskan `sourceLot`, menyertakan `lotKey`, dan tetap server-derived.
7. RPC split menggunakan `FOR UPDATE`, scope TL/SUPERADMIN, expected qty, exact allocation sum, unique keys, dan marker idempotency pada baris asal. Baris asal qty 0 berstatus archived; lot baru menyalin field stok dan satu sumber.
8. Data Stok/Stock Opname mempertahankan baris lot. Perhitungan Stock Count/forecast/dashboard mengelompokkan katalog secara eksplisit.

## Source Layout

```text
src/lib/sap.js                                  source-lot helpers/formatters
src/hooks/useTugApprovals.js                    TUG-3 lot writes
App.jsx                                         TUG-10 lot writes and split orchestration
src/components/TugFormModals.jsx                explicit lot picker/validation
src/components/ScanPickerModal.jsx              ambiguous scan handling
src/components/DataStokTab.jsx                  lot source display/allocation entry
src/components/StockOpnameTab.jsx               per-lot display and catalog aggregation
src/lib/tugCanonical.js                         immutable snapshot mapping
supabase/migrations/20260915_tug_source_lots.sql proposal RPC/helper
tests/unit/tugSourceLots.test.mjs                pure behavior tests
tests/unit/tugCanonical.contract.test.mjs        SQL contract tests
```

## Implementation Order

1. Pure source-lot key/classification/aggregation helpers and tests.
2. TUG-3/TUG-10 incoming lot writes with existing retry markers.
3. Picker, duplicate/qty validation, and scan ambiguity.
4. Server migration proposal for source snapshot and legacy split.
5. Data Stok/Opname source display and authorized allocation UI.
6. Regression tests and build.

## Risk Controls

- No client-side split writes: RPC transaction prevents partial totals.
- Existing legacy single-source rows remain usable through derived single-source metadata; multi-source rows are blocked.
- Canonical decision RPC is unchanged and remains final balance guard.
- No production migration, commit, or push in this implementation step.

## Acceptance Gate

- PT A/PT B balances stay independent.
- Qty cannot cross the selected lot balance.
- Ambiguous scans require source selection.
- Legacy split is authorized, atomic, exact, and idempotent.
- Detail and aggregate stock totals reconcile.
- Unit/contract tests and build pass.

## Post-Design Constitution Check

Lulus terhadap kontrak project: existing patterns reused, no new dependency/table, database authority retained, and production remains manually gated.
