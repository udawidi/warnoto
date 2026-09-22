# Tasks: Optional Stock Opname Photos

**Input**: Design documents from `/specs/021-optional-opname-photos/`

## Phase 1: Setup and specification

- [x] T001 Create the complete Spec Kit artifact set and set `.specify/feature.json` to `specs/021-optional-opname-photos`.
- [x] T002 Verify no extension hooks are registered and preserve the existing branch/worktree.

## Phase 2: Remove client required-photo gates (P1)

- [x] T003 [US1] Remove qty-plus-photo save gates and required styling/errors from `src/components/OpnameLapanganView.jsx`.
- [x] T004 [US1] Remove required-photo validation and change the Stock Opname photo label to optional in `src/components/StockOpnameTab.jsx`.
- [x] T005 [US1] Remove required-photo submit and approval checks while retaining `normalizeOpnamePhotos` in `src/hooks/useStockOpname.js`.
- [x] T006 [US1] Delete obsolete `isValidOpnamePhotoUrl` and `missingRequiredOpnamePhotos` exports after confirming no callers remain.

## Phase 3: Tests and security contract (P1/P2)

- [x] T007 [US3] Update `tests/unit/stockOpnameRequiredPhoto.test.mjs` to assert optional empty photos, retained normalization, fail-closed data URLs, and unchanged security contracts.
- [x] T008 [US2] Preserve and verify Data Stok/Kartu Gantung photo-update assertions in existing Stock Opname approval/security tests.
- [x] T009 [US1] Run focused unit/contract tests and Mode Lapangan E2E; fix only regressions caused by this change.

## Phase 3A: Optional Non-SAP child clarity (P1)

- [x] T009A [US4] Confirm existing SAP submit/approval path is independent of Non-SAP child state; do not change hook, RPC, schema, or output coupling.
- [x] T009B [US4] Update `src/components/StockOpnameTab.jsx` copy to `Non-SAP (opsional)`, `Input Non-SAP (opsional)`, and a note that Non-SAP may be opened after SAP completion.
- [x] T009C [US4] Add a direct contract for the `submitOpname`/Submit ke Asman path proving no Non-SAP child dependency, and retain document-package coverage that `DRAFT`/`PENDING` child data is excluded from SAP output.

## Phase 4: Database migration and verifier

- [x] T010 [US3] Add `supabase/migrations/20260922_stock_opname_optional_photo.sql` that drops only `stock_opname_required_photo_guard` from `public.stock_opname`.
- [x] T011 [US3] Add `supabase/verify_stock_opname_optional_photo.sql` checking trigger absence, anti-dataURL constraint, storage policies, approval RPC signature, and grants.
- [x] T012 [US3] Review migration/verifier SQL and confirm historical migration/helper functions are untouched.

## Phase 5: Production rollout and final validation

- [x] T013 Run `npm run build` and final focused tests.
- [x] T014 Back up production `vps-dr-stack/supabase-db`; apply existing `20260919_stock_opname_photo_security.sql` and run its verifier, then apply existing `20260919_stock_opname_photo_data_constraint.sql` after explicit user approval.
- [x] T015 Apply `20260922_stock_opname_optional_photo.sql` atomically with `ON_ERROR_STOP=1`.
- [x] T016 Run the production verifier and rollback-only DB smoke transaction.
- [x] T017 Report changed files, verification, and risks to the parent agent; do not commit, push, or edit `HANDOFF.md`.

## Dependencies and execution order

- T001-T002 precede all code work.
- T003-T006 precede T007-T009.
- T010-T012 may be prepared alongside client tests but production apply T015 requires T013 and T014.
- T016 requires successful T015.
