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
- [ ] T016 Apply and verify migration on self-host with backup and rollback-safe preflight
- [ ] T017 Perform localhost self-host smoke and mark all tasks complete

## Dependencies

T003 before T004. T004-T005 before client integration. T006-T008 before batch UI. T009-T011 before T012. T013-T014 before T015. T016 only after all local checks pass.

## Independent Test Criteria

- US1: TL owner persists registry across devices; cross-UPT writes fail.
- US2: multi-asset checkout is atomic with correct direct or approval status.
- US3: subset return releases only selected assets with private evidence.
- US4: owner/requester visibility and 360/768/desktop interaction pass.
