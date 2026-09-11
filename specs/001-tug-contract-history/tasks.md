# Tasks: Riwayat Sumber Kontrak TUG-8/9

## Phase 1: Setup

- [X] T001 Add contract expectations for source snapshots in tests/unit/tugCanonical.contract.test.mjs
- [X] T002 Add formatter behavior tests in tests/unit/tugSourceHistory.test.mjs

## Phase 2: Foundational

- [X] T003 [US1] Create idempotent source snapshot and backfill migration in supabase/migrations/20260911_tug_item_source_history.sql
- [X] T004 [US1] Map source_snapshot into canonical stock items in src/lib/tugCanonical.js
- [X] T005 [US1] Add pure source normalization/formatting helpers in src/lib/sap.js

## Phase 3: User Story 1 - Sumber setiap material keluar

- [X] T006 [US1] Render immutable source history in src/components/ApprovalTab.jsx
- [X] T007 [US1] Render immutable source history in src/components/TransactionHubTab.jsx
- [X] T008 [US1] Show all live source contracts in the picker in src/components/TugFormModals.jsx

## Phase 4: User Story 2 - Histori lama lengkap

- [X] T009 [US2] Add production-safe dry-run and post-check SQL in supabase/verify_tug_item_source_history.sql
- [X] T010 [US2] Verify migration retry, temporal filtering, fallback classes, and unchanged canonical evidence

## Phase 5: Polish & Validation

- [X] T011 Run canonical and source unit tests
- [X] T012 Run npm build and graphify update
- [X] T013 Review production backup/dry-run, apply migration only after explicit gate, then verify TUG-9 250

## Dependencies

T001-T002 precede implementation. T003 precedes T004 and UI work. T004-T005 precede T006-T008. T009-T010 precede production gate T013.

## Independent Test Criteria

- **US1**: A new or amended TUG-8/TUG-9 item shows server-derived contracts or explicit origin without trusting client metadata.
- **US2**: Every historical canonical item receives temporal source history without changing signed snapshot, hash, approval, qty, or movements.

## Implementation Strategy

Implement migration contract first, then mapping/helper, then three existing UI surfaces. Run dry-run before any production write.
