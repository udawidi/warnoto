# Tasks

## Phase 1: Photo persistence (US1)

Dependencies: none.

- [X] T001 [US1] Upload selected existing-item photos with the opname session UPT and save through the server merge path — `src/components/StockOpnameTab.jsx`, `App.jsx` (Depends: none)
- [X] T002 [US1] Normalize legacy `data:` photos before draft save, submit, and Asman approval — `src/hooks/useStockOpname.js` (Depends: T001)
- [X] T003 [US1] Resolve Non-SAP photo and stock `uptId` from the opname session — `src/hooks/useStockOpname.js` (Depends: T001)

## Phase 2: Durable transitions (US2)

Dependencies: Phase 1.

- [X] T004 [US2] Roll back local draft, submit, and approval state when cloud persistence returns false — `src/hooks/useStockOpname.js` (Depends: T002)
- [X] T005 [US2] Preserve the merged server snapshot when the photo save returns newer per-block data — `src/components/StockOpnameTab.jsx`, `src/hooks/useStockOpname.js` (Depends: T001, T004)

## Phase 3: Tenant security (US3)

Dependencies: Phase 1.

- [X] T006 [US3] Add proposal-only UPT-scoped Storage INSERT/UPDATE policies with exact writer roles and non-destructive rollback — `supabase/migrations/20260919_stock_opname_photo_security.sql`, `supabase/migrations/20260919_stock_opname_photo_security.rollback.sql` (Depends: T003)
- [X] T007 [US3] Add dry-run legacy photo backfill and read-only policy/data verifier — `scripts/stock_opname_photo_backfill.mjs`, `supabase/verify_stock_opname_photo_security.sql` (Depends: T002, T006)
- [X] T008 [US3] Add a post-backfill constraint targeting only item photo fields plus rollback — `supabase/migrations/20260919_stock_opname_photo_data_constraint.sql`, `supabase/migrations/20260919_stock_opname_photo_data_constraint.rollback.sql` (Depends: T007)

## Phase 4: Verification (US1, US2, US3)

Dependencies: Phases 1–3.

- [X] T009 [US1] Add behavior and contract tests for session UPT, URL replacement, upload failure, policy scope, and constraint scope — `tests/unit/stockOpnamePhotoSecurity.contract.test.mjs` (Depends: T001–T008)
- [X] T010 [US1] Run targeted tests, existing Stock Opname tests, build, diff check, graph refresh, and spec audit — repository verification commands (Depends: T009)

## Phase 5: Atomic approval (US2)

Dependencies: Phases 1–4.

- [X] T011 [US2] Add proposal-only transactional Asman approval RPC with role, scope, status, payload, location, and photo guards — `supabase/migrations/20260919_stock_opname_asman_approval_rpc.sql` (Depends: T008)
- [X] T012 [US2] Add non-destructive RPC rollback and read-only verifier — `supabase/migrations/20260919_stock_opname_asman_approval_rpc.rollback.sql`, `supabase/verify_stock_opname_asman_approval_rpc.sql` (Depends: T011)
- [X] T013 [US2] Route final approval through the RPC with changed absolute catalog/stock rows and no unsafe fallback — `src/lib/stockOpnameApproval.js`, `src/hooks/useStockOpname.js`, `App.jsx` (Depends: T011)
- [X] T014 [US2] Add transactional RPC contract checks and verify rollout documentation — `tests/unit/stockOpnamePhotoSecurity.contract.test.mjs`, `specs/009-stock-opname-photo-security/quickstart.md` (Depends: T012, T013)
