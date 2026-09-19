# Tasks

## Phase 1 - Foundational draft security

- [X] T001 [US1] Add owner-and-UPT-scoped draft migration and schema mirror in `supabase/migrations/20260919_maturity_5s_drafts.sql` and `supabase/schema.sql`.
- [X] T002 [US1] Add draft load/upsert/delete helpers and tests in `src/lib/maturitySync.js` and `tests/unit/form5sSecurity.contract.test.mjs`.
- [X] T003 [US1] Wire draft state, restore, save, and post-final cleanup through `src/hooks/useMaturity.jsx`, `App.jsx`, and `src/components/Form5SPage.jsx`.

## Phase 2 - Form and history UX

- [X] T004 [US2] Replace dual photo controls with one accessible action sheet in `src/components/MaturityAuditSystem.jsx`.
- [X] T005 [US3] Make history rows compact with always-visible detail/PDF actions and lazy detail photos in `src/components/MaturityAuditSystem.jsx`.

## Phase 3 - Verification

- [X] T006 [US1] Extend the non-mutating verifier in `supabase/verify_form5s_upt_security.sql`.
- [X] T007 Run targeted/full tests, build, graph update, and diff check.

## Dependencies

- T001 before T002 and T003.
- T004 and T005 may run after the draft prop contract in T003 is fixed.
- T006 and T007 run last.

## Implementation strategy

Keep the existing final assessment and protected photo paths unchanged. Add the smallest separate draft lifecycle, then simplify only the two requested UI surfaces.
