# Tasks: Operasional MTU KHS

## Phase 1: Foundational Backend

- [X] T001 Add contract tests for schema, RPC, RLS, storage, search, and UI wiring in `tests/unit/mtuKhsOperations.contract.test.mjs`
- [X] T002 Implement schema, RLS, storage policies, events, evidence, transfer, search, and RPCs in `supabase/migrations/20261009_mtu_khs_operations.sql`

## Phase 2: User Story 1 - Direct TL Edit

- [X] T003 [US1] Add operational update API and normalization in `src/features/mtu-khs/mtuKhsApi.js` and `src/features/mtu-khs/mtuKhsModel.js`
- [X] T004 [US1] Add TL catalog/status/location editor in `src/features/mtu-khs/MtuKhsDetail.jsx` and `src/features/mtu-khs/MtuKhsTab.jsx`

## Phase 3: User Story 2 - Smart Search

- [X] T005 [US2] Add RFQ/KR query parameters, facets, debounce, and filters in `src/features/mtu-khs/mtuKhsApi.js` and `src/features/mtu-khs/MtuKhsTab.jsx`

## Phase 4: User Story 3 - Evidence

- [X] T006 [US3] Add compressed self-host photo upload, signed reads, active/history API in `src/features/mtu-khs/mtuKhsApi.js`
- [X] T007 [US3] Add Barang and Nameplate slots with history in `src/features/mtu-khs/MtuKhsDetail.jsx`

## Phase 5: User Story 4 - Transfer

- [X] T008 [US4] Add transfer request/decision APIs in `src/features/mtu-khs/mtuKhsApi.js`
- [X] T009 [US4] Add TL transfer dialog and ASMAN approval list in `src/features/mtu-khs/MtuKhsTab.jsx` and `src/features/mtu-khs/MtuKhsDetail.jsx`

## Phase 6: Polish and Verification

- [X] T010 Add compact responsive styles and visible states in `src/features/mtu-khs/mtuKhs.css`
- [X] T011 Run MTU tests, full build, diff check, and verify no Sheet-sync mutation
- [X] T012 Perform convergence review against `spec.md`, `plan.md`, and `tasks.md`
