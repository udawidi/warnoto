# Tasks: BA Pengeluaran Material Non Stock dan Pinjam

**Input**: Design documents from `/specs/033-ba-nonstock-loan/`

**Tests**: Contract, unit, rehearsal, E2E, full test, build, and diff-check are required.

## Phase 1: Setup

- [x] T001 Confirm dirty-worktree boundaries and preserve existing notification edits in `App.jsx`, `src/hooks/useTugApprovals.js`, `supabase/functions/notify-dispatch/index.ts`, and existing tests

## Phase 2: Foundational

- [x] T002 [P] Add failing SQL/RPC contract coverage in `tests/unit/baNonStock.contract.test.mjs`
- [x] T003 [P] Add failing document-builder coverage in `tests/unit/baNonStockDocument.test.mjs`
- [x] T004 Implement tables, RLS, annual counter, and RPC state machine in `supabase/migrations/20261015_ba_non_stock.sql`
- [x] T005 Mirror the final migration definitions in `supabase/schema.sql` and add scratch verification in `scripts/rehearse_ba_non_stock.mjs`
- [x] T006 Implement typed client loading, mutation RPCs, photo upload, and row mapping in `src/lib/baNonStockSync.js`

## Phase 3: User Story 1 - Admin membuat dan mengajukan BA (P1)

**Independent Test**: ADMIN dapat menyimpan draft, refresh, melengkapi material manual dan dua foto, lalu submit tanpa perubahan stok.

- [x] T007 [US1] Implement the responsive manual form and validation in `src/components/BaNonStockFormModal.jsx`
- [x] T008 [US1] Implement BA list, draft edit, rejected repair, and history search in `src/components/BaNonStockTab.jsx`
- [x] T009 [US1] Add the `BA_NON_STOCK` route/card and wire state/bootstrap/actions additively in `src/lib/tugRoute.js`, `src/components/TransactionHubTab.jsx`, and `App.jsx`

## Phase 4: User Story 2 - TL review dan finalisasi (P1)

**Independent Test**: TL UPT yang sama dapat approve/reject; role dan UPT lain ditolak; approval menerbitkan nomor unik.

- [x] T010 [US2] Add pending BA review, preview, approve, and reject controls in `src/components/ApprovalHubTab.jsx` and `App.jsx`
- [x] T011 [US2] Complete authorization, concurrency, rejection, storage-object, and no-stock-mutation test scenarios in `tests/unit/baNonStock.contract.test.mjs` and `scripts/rehearse_ba_non_stock.mjs`

## Phase 5: User Story 3 - Riwayat dan cetakan resmi (P2)

**Independent Test**: BA final dapat dicari, dipratinjau, dan dicetak dengan tabel material, dua foto, dan tiga snapshot penandatangan.

- [x] T012 [US3] Add the A4 BA and photo appendix builder plus download helper in `src/lib/docBuilders.js`
- [x] T013 [US3] Route BA preview/print and approved-only official printing in `src/components/StockModals.jsx`
- [x] T014 [US3] Add desktop and 360px end-to-end coverage in `tests/e2e/ba-non-stock.spec.js`

## Phase 6: Polish and Validation

- [ ] T015 Run targeted tests, PostgreSQL rehearsal, full `npm test`, production build, E2E, and `git diff --check`; fix all regressions. Unit, E2E, build, and diff-check pass; PostgreSQL rehearsal awaits a running Docker daemon or PostgreSQL binary.
- [x] T016 Reconcile implementation against `spec.md`, `plan.md`, and this task list; only the environment-blocked PostgreSQL rehearsal remains.

## Dependencies

- T002 and T003 can run in parallel after T001.
- T004 depends on T002; T005 depends on T004.
- T006 depends on the RPC contract in T004.
- T007 and T008 depend on T006; T009 integrates them afterward.
- T010 and T011 depend on T004-T009.
- T012 can run after T003; T013 depends on T012; T014 depends on T009-T013.
- T015-T016 run after all implementation tasks.

## Implementation Strategy

1. Finish database and client persistence first.
2. Deliver Admin draft/submit flow.
3. Add TL decision flow and numbering.
4. Add final document and E2E coverage.
5. Do not apply migration to production or update `HANDOFF.md` without explicit user approval.
