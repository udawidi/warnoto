# Tasks: Alat Bantu Kerja Terisolasi per UPT

## Phase 1: Setup

- [X] T001 Validate clean baseline, existing contracts, and self-host architecture in repository root
- [X] T002 Generate approved feature artifacts in `specs/014-heavy-equipment-support-tools/`

## Phase 2: Foundational Security

- [X] T003 [P] Add migration/RPC/storage contract tests in `tests/unit/heavyEquipmentSupportTools.test.mjs`
- [X] T004 Add typed UPT columns, backfill, RLS, private bucket, and batch RPCs in `supabase/migrations/20260920_heavy_equipment_upt_id_loans.sql`
- [X] T005 Mirror canonical schema additions in `supabase/schema.sql`

## Phase 3: User Story 1 - Registry UPT

- [X] T006 [US1] Add ID-first normalization, borrower labels, and scope helpers in `src/lib/heavyEquipment.js`
- [X] T007 [US1] Make registry persistence server-first and TL-only in `src/hooks/useHeavyEquipment.js` and `App.jsx`
- [X] T008 [US1] Add asset type, locked UPT, scoped warehouse, and cross-UPT toggle UI in `src/components/HeavyEquipmentTabV2.jsx`

## Phase 4: User Story 2 - Checkout Batch

- [X] T009 [US2] Add private evidence upload and batch checkout handler in `src/hooks/useHeavyEquipment.js`
- [X] T010 [US2] Add multi-select borrower/PIC/date/evidence UI in `src/components/HeavyEquipmentTabV2.jsx`
- [X] T011 [US2] Update approval and printable batch labels in `src/components/ApprovalHubTab.jsx` and `src/lib/docBuilders.js`

## Phase 5: User Story 3 - Partial Return

- [X] T012 [US3] Add batch partial-return server-first handler and UI in `src/hooks/useHeavyEquipment.js` and `src/components/HeavyEquipmentTabV2.jsx`

## Phase 6: User Story 4 - Monitoring and UX

- [X] T013 [US4] Update dashboard/history labels and responsive states in `src/components/HeavyEquipmentDashboardSummary.jsx` and `src/styles/operations.css`
- [X] T014 [US4] Update desktop/mobile/security E2E in `tests/e2e/heavy-equipment.spec.js`

## Phase 7: Validation and Self-Host

- [X] T015 Run targeted tests, full tests, E2E, build, and diff audit
- [X] T016 Apply and verify migration on self-host with backup and rollback-safe preflight
- [X] T017 Perform localhost self-host smoke and mark all tasks complete

## Dependencies

T003 before T004. T004-T005 before client integration. T006-T008 before batch UI. T009-T011 before T012. T013-T014 before T015. T016 only after all local checks pass.

## Independent Test Criteria

- US1: TL owner persists registry across devices; cross-UPT writes fail.
- US2: multi-asset checkout is atomic with correct direct or approval status.
- US3: subset return releases only selected assets with private evidence.
- US4: owner/requester visibility and 360/768/desktop interaction pass.

## Phase 8: User Story 5 - Peminjaman HAR UIT

- [X] T018 [P] [US5] Add HAR_UIT schema, RLS, RPC, and storage contract assertions in `tests/unit/heavyEquipmentSupportTools.test.mjs`
- [X] T019 [US5] Add nullable requester UIT, final policies, and HAR branches for both checkout RPCs in `supabase/migrations/20260921_har_uit_heavy_equipment_loans.sql`
- [X] T020 [US5] Mirror the final HAR_UIT database contract in `supabase/schema.sql`
- [X] T021 [P] [US5] Add rollback-safe HAR_UIT verification scenarios in `supabase/verify_har_uit_heavy_equipment.sql`
- [X] T022 [US5] Make HAR_UIT empty server results authoritative and normalize requester UIT fields in `App.jsx` and `src/lib/heavyEquipment.js`
- [X] T023 [US5] Support HAR_UIT evidence upload and checkout without changing TL behavior in `src/hooks/useHeavyEquipment.js`
- [X] T024 [US5] Add the scoped HAR_UIT request form and read-only controls in `src/components/HeavyEquipmentTabV2.jsx`
- [X] T025 [P] [US5] Cover HAR_UIT photos, scope, request, and forbidden actions in `tests/e2e/heavy-equipment.spec.js`

## Phase 9: Validation and Release Preparation

- [X] T026 Run targeted unit tests, full tests, E2E, build, SQL verification review, and diff audit
- [X] T027 Prepare the production migration command, rollback note, and frontend deployment gate without applying or pushing changes

## HAR UIT Dependencies

T018 before T019. T019-T021 before client integration. T022-T024 before T025. T025 before T026. Production migration apply requires a separate explicit user confirmation and must precede frontend deployment.

## HAR UIT Independent Test Criteria

- US5: HAR_UIT with `uit_id` and no `upt_id` sees canonical registry photos and all in-UIT history, submits a same-UIT cross-enabled equipment request with mandatory evidence, receives owner Asman pending status, and cannot access cross-UIT data or perform owner actions.
