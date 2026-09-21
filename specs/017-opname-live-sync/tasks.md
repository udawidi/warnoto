# Tasks: Sinkronisasi Langsung Stock Opname

## Phase 1: Foundational

- [ ] T001 [P] Tambah contract tests migration/RPC/realtime di `tests/unit/stockOpnameLiveSync.contract.test.mjs`
- [ ] T002 Tambah migration dan verifier di `supabase/migrations/20260921_stock_opname_live_sync.sql` dan `supabase/verify_stock_opname_live_sync.sql`

## Phase 2: User Story 1 - Progres sama lintas akun

- [ ] T003 [US1] Implement reducer dan mapping event di `src/lib/stockOpnameRealtime.js`
- [ ] T004 [US1] Implement subscription, reconnect resync, dan single-row state update di `src/hooks/useStockOpname.js`
- [ ] T005 [US1] Implement autosave serta active-session reconciliation di `src/components/StockOpnameTab.jsx`
- [ ] T006 [US1] Tambah unit/E2E untuk merge dirty state dan dua konteks di `tests/unit/stockOpnameFlow.test.mjs` dan `tests/e2e/stock-opname-sap-first.spec.js`

## Phase 3: User Story 2 - Freeze TL-only

- [ ] T007 [US2] Integrasikan RPC fail-closed dan hapus auto-freeze di `src/hooks/useStockOpname.js`
- [ ] T008 [US2] Batasi UI ke TL dan pertahankan kontrol unfreeze terminal di `src/components/StockOpnameTab.jsx`
- [ ] T009 [US2] Hapus auto-unfreeze approval/reject dan tambah regression tests di `src/hooks/useStockOpname.js` serta `tests/unit/stockOpnameLiveSync.contract.test.mjs`

## Phase 4: Verification

- [ ] T010 Jalankan unit tests, build, SQL verifier, dan verifikasi read-only progres Fajar sesuai `quickstart.md`
- [ ] T011 Perbarui checkbox tugas ini dan laporkan hasil; jangan ubah `HANDOFF.md` tanpa persetujuan

## Dependencies & Execution Order

T001 sebelum T002-T009. T002 dan T003 dapat paralel. T004 sebelum T005/T007. T005-T009 sebelum T010.
