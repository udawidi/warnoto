# Implementation plan

## Technical context

- Existing React/Vite form and Supabase self-host remain canonical.
- Reuse the existing `maturity_5s_assessments`, protected photo download, and Form 5S components.
- Add one owner-only draft table; no dependency or photo endpoint is added.

## Constitution check

Project constitution is an unfilled template. Governing project rules are `AGENTS.md` and `HANDOFF.md`: smallest safe change, explicit production migration approval, UPT isolation, no automatic handoff update.

## Design

1. Add `maturity_5s_drafts` with one row per `owner_id + upt_id`, RLS owner gate, and `can_write_maturity_upt` gate.
2. Add load/upsert/delete sync helpers and hook state. Final save deletes the matching draft after the final insert succeeds.
3. Hydrate only the active user's active-UPT draft into the form.
4. Replace separate Kamera/Galeri labels with one accessible trigger and a compact action sheet.
5. Render history rows only; expose PDF per row; mount detail and download photos only after `Detail Audit`.
6. Extend contract tests and SQL verifier; run unit tests, build, graph update, and diff check.

## Files

- `supabase/migrations/20260919_maturity_5s_drafts.sql`
- `supabase/schema.sql`
- `supabase/verify_form5s_upt_security.sql`
- `src/lib/maturitySync.js`
- `src/hooks/useMaturity.jsx`
- `App.jsx`
- `src/components/Form5SPage.jsx`
- `src/components/MaturityAuditSystem.jsx`
- `tests/unit/form5sSecurity.contract.test.mjs`

## Rollout gate

Migration production is proposal-only until the user explicitly approves its execution.
