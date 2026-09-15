# Tasks: Lot Sumber Material TUG-8/9

## Phase 1: Setup

- [X] T001 [P] Add source-lot behavior tests in tests/unit/tugSourceLots.test.mjs
- [X] T002 [P] Extend server snapshot/RPC contract tests in tests/unit/tugCanonical.contract.test.mjs

## Phase 2: Foundational

- [X] T003 Implement stable source-lot helpers, legacy classification, and catalog aggregation in src/lib/sap.js
- [X] T004 Create proposed server snapshot and atomic legacy split migration in supabase/migrations/20260915_tug_source_lots.sql
- [X] T005 Map `lotKey` from immutable canonical snapshot in src/lib/tugCanonical.js

## Phase 3: User Story 1 - Memilih sumber material keluar

- [X] T006 [US1] Show active lot source/balance and block legacy multi-source rows in src/components/TugFormModals.jsx
- [X] T007 [US1] Reject duplicate stock IDs and quantity above selected lot in src/components/TugFormModals.jsx
- [X] T008 [US1] Route ambiguous catalog scans to explicit lot selection in src/components/ScanPickerModal.jsx

## Phase 4: User Story 2 - Menjaga sumber penerimaan baru

- [X] T009 [US2] Write or increment TUG-3 stock by source-lot key in src/hooks/useTugApprovals.js
- [X] T010 [US2] Write TUG-10 return stock by transaction-item lot key in App.jsx

## Phase 5: User Story 3 - Mengalokasikan stok gabungan lama

- [X] T011 [US3] Display legacy allocation status and authorized split form in src/components/DataStokTab.jsx
- [X] T012 [US3] Call split RPC, refresh stock, and surface validation errors in App.jsx

## Phase 6: User Story 4 - Stok dan opname per sumber

- [X] T013 [P] [US4] Display source identity per row in src/components/DataStokTab.jsx
- [X] T014 [P] [US4] Display source identity per row and preserve catalog totals in src/components/StockOpnameTab.jsx
- [X] T015 [US4] Verify Stock Count, forecast, and dashboard aggregations across stock-lot callers in App.jsx

## Phase 7: Polish & Validation

- [X] T016 Update source labels in src/components/ApprovalTab.jsx and src/components/TransactionHubTab.jsx
- [X] T017 Run source-lot and canonical unit/contract tests
- [X] T018 Run `npm run build`
- [X] T019 Review migration proposal without applying it to Supabase production

## Dependencies

T001-T005 precede all stories. US1 and US2 may proceed after foundational work. US3 requires T004. US4 requires T003 and incoming lot behavior. Validation follows all stories.

## Independent Test Criteria

- **US1**: Two sources appear separately and only the selected `stockId` can be submitted within its balance.
- **US2**: PT A/PT B and TUG-10 items create independent, retry-safe balances.
- **US3**: TL/SUPERADMIN split preserves exact total; invalid or duplicate requests make no change.
- **US4**: Per-source detail totals equal catalog-level aggregate totals.

## Implementation Strategy

Reuse exact-stock canonical deduction. Add the minimum metadata and guards around incoming writes, selection, legacy split, and aggregation; add no table or dependency.

## Phase 8: Convergence

- [X] T020 Render and count Stock Opname as one item row per source lot while preserving catalog aggregate reconciliation per FR-011 and US4/AC1
