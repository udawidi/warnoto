# Tasks: TUG MARA Posting Guard

**Input**: Design documents from `/specs/030-tug-mara-post-guard/`

## Phase 1: Foundation

- [x] T001 Add failing contract tests for MARA resolution, rollback, and idempotency in `tests/unit/tugMaraPosting.contract.test.mjs`
- [x] T002 Add the MARA resolver, TUG-3 final RPC, TUG-3 guards, MTU guard, and TUG-10 enforcement in a new `supabase/migrations/` migration
- [x] T003 Mirror the production schema contract in `supabase/schema.sql`
- [x] T004 Add a read-only SQL verification script in `supabase/verify_tug_mara_post_guard.sql`

## Phase 2: User Story 1 - Atomic Posting (P1)

- [x] T005 [US1] Add `approveTug3Final` wrapper in `src/lib/tug3Sync.js`
- [x] T006 [US1] Replace client stock mutation with RPC result merging in `src/hooks/useTugApprovals.js`
- [x] T007 [US1] Map MARA validation failures to actionable approval messages in `src/lib/tug3Sync.js` and `src/lib/tug10Sync.js`

## Phase 3: User Story 2 - MARA-Only Input (P2)

- [x] T008 [US2] Require MARA selection and remove manual/unlock fallback in `src/components/TugFormModals.jsx`
- [x] T009 [US2] Tighten submit validation for new TUG-3/TUG-10 items in `src/hooks/useTugTransactions.js`

## Phase 4: Validation

- [x] T010 Run targeted TUG/MARA tests and update contract assertions where required
- [x] T011 Run `npm test` and `npm run build` (build passed; the full suite retains one unrelated existing Form 5S assertion failure)
- [x] T012 Confirm migration remains unapplied pending explicit production approval
