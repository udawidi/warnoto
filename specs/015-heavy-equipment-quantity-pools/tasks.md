# Tasks: Pool Kuantitas Alat Bantu

## Phase 1: Foundation

- [X] T001 Tambah contract test migration/RPC kuantitas di `tests/unit/heavyEquipmentQuantity.test.mjs`
- [X] T002 Tambah migration additive dan mirror canonical di `supabase/migrations/20260920b_heavy_equipment_quantity_pools.sql` dan `supabase/schema.sql`
- [X] T003 Tambah normalisasi dan helper saldo kuantitas di `src/lib/heavyEquipment.js`
- [X] T004 Integrasikan checkout v2 dan return quantity server-first di `src/hooks/useHeavyEquipment.js`

## Phase 2: User Stories

- [X] T005 [US1] Tambah mode pool, jumlah awal, spesifikasi, dan conversion guard di `src/components/HeavyEquipmentTabV2.jsx`
- [X] T006 [US2] Tambah picker jumlah, saldo, dan loan paralel di `src/components/HeavyEquipmentTabV2.jsx`
- [X] T007 [US3] Tambah modal return baik/rusak/hilang dan timeline event di `src/components/HeavyEquipmentTabV2.jsx`
- [X] T008 [US4] Tambah history cetak kuantitas di `src/lib/docBuilders.js`
- [X] T009 [P] [US1] Perbarui KPI unit fisik di `src/components/HeavyEquipmentDashboardSummary.jsx`
- [X] T010 [P] [US1] Tambah CSS responsive 360 px di `src/styles/operations.css`

## Phase 3: Verification

- [X] T011 Tambah E2E pool/partial return/mobile di `tests/e2e/heavy-equipment.spec.js`
- [X] T012 Jalankan full unit test, E2E fokus, build, dan diff-check
- [X] T013 Review convergence terhadap spec dan plan

## Dependencies

T001 sebelum T002-T004. T002-T004 sebelum T005-T008. T009-T010 dapat paralel setelah kontrak client stabil. T011-T013 terakhir.
