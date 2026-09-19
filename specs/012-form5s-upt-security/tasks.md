# Tasks

## Phase 1 - User Story 1: top-level Form 5S navigation and UPT entry

- [X] T001 [US1] Add scoped wrapper and summary in `src/components/Form5SPage.jsx`; reuse `Form5STab` from `src/components/MaturityAuditSystem.jsx`.
- [X] T002 [US1] Add sidebar alias and top-level render in `App.jsx`; remove the Form 5S subtab branch from `src/components/MaturityDashboardTab.jsx`.
- [X] T003 [US1] Scope cache fallback and canonical UPT/gudang mapping in `App.jsx`, `src/lib/maturitySync.js`, and `src/components/MaturityAuditSystem.jsx`.

## Phase 2 - User Story 2: scoped evidence and history

- [X] T004 [US2] Add scoped client/Edge photo download in `src/lib/maturityDrive.js` and `supabase/functions/maturity-drive/index.ts`.
- [X] T005 [US2] Add lazy history photos and persisted-record print flow in `src/components/MaturityAuditSystem.jsx`.
- [X] T006 [US2] Make PDF UPT/ASMAN resolution canonical in `src/lib/docBuilders.js` and add identity to title/filename.

## Phase 3 - User Story 3: database enforcement and verification

- [X] T007 [US3] Add insert trigger migration in `supabase/migrations/20260919_form5s_photo_storage_guard.sql` and schema mirror in `supabase/schema.sql`.
- [X] T008 [US3] Add verifier `supabase/verify_form5s_upt_security.sql` and contract tests in `tests/unit/form5sSecurity.contract.test.mjs`.
- [X] T009 [US3] Add desktop/mobile scenarios in `tests/e2e/desktop.spec.js` and `tests/e2e/mobile-minimal.spec.js`.

## Validation

- [X] T010 Run full tests, build, graphify update, and diff-check.
- [X] T011 Apply and verify the reviewed database and Edge Function rollout on self-host.
