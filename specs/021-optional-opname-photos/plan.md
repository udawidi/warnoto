# Implementation Plan: Optional Stock Opname Photos

**Branch**: `021-optional-opname-photos`  **Date**: 2026-09-22  **Spec**: [spec.md](spec.md)

## Summary

Remove the required-photo gates from Stock Opname UI and submit/approval callers. Keep `normalizeOpnamePhotos` on every persistence boundary so supplied photos are uploaded and fail closed. Clarify in the Stock Opname UI that Non-SAP child input is optional and does not block SAP submit or output. Add a forward-only migration that drops only the retired required-photo trigger, then verify the anti-dataURL constraint, storage policies, and approval RPC remain present.

## Technical Context

- **Language/Version**: JavaScript/JSX, Node.js test runner, SQL migrations.
- **Primary Dependencies**: Existing React, Vite, Supabase client, and project test dependencies.
- **Storage**: Existing Supabase self-host PostgreSQL and `stock-photos` bucket.
- **Testing**: Node unit/contract tests, Playwright Mode Lapangan E2E, Vite build, SQL verifier and rollback smoke.
- **Target Platform**: WARNOTO web app and self-host Supabase production.
- **Project Type**: React web application with Supabase persistence.
- **Performance Goals**: No additional network round-trip when no photo is supplied; existing upload path unchanged when a photo is supplied.
- **Constraints**: No dependency changes, no schema redesign, no edits to historical migrations, no commit or push by the implementer. Existing security/constraint migrations are production prerequisites when preflight reports them missing; applying them requires explicit user approval because it expands the requested schema/security rollout.

## Constitution Check

- Caveman/Ponytail/RTK: pass; minimum diff, existing helpers reused, shell commands prefixed with `rtk`.
- Review-first: pass; no automatic business action beyond the approved migration and existing approval flow.
- Security: pass; empty optional values are allowed, unsafe `data:` values remain rejected, storage/RLS/approval contracts stay intact.
- HANDOFF: pass; not edited by this implementation agent.

## Project Structure

```text
src/components/OpnameLapanganView.jsx
src/components/StockOpnameTab.jsx
src/hooks/useStockOpname.js
src/lib/stockOpnamePhotoSecurity.js
tests/unit/stockOpnameRequiredPhoto.test.mjs
tests/unit/stockOpnamePhotoSecurity.contract.test.mjs
tests/e2e/opname-lapangan.spec.js
supabase/migrations/20260922_stock_opname_optional_photo.sql
supabase/verify_stock_opname_optional_photo.sql
specs/021-optional-opname-photos/
```

## Implementation Sequence

1. Create and validate Spec Kit artifacts.
2. Remove UI required styling/errors and submit/approval required-photo callers.
3. Clarify Non-SAP as optional after SAP completion; keep child creation and review behavior unchanged.
4. Delete obsolete client required-photo helper exports and replace the required-photo test with optional-photo/security contracts.
5. Add migration and verifier; inspect SQL before production use.
6. Run focused tests, Mode Lapangan E2E, SAP-submit-without-child contract/E2E, and build; update all task checkboxes.
7. After explicit approval for the missing prerequisites, back up `vps-dr-stack/supabase-db`, apply `20260919_stock_opname_photo_security.sql`, run its verifier, apply `20260919_stock_opname_photo_data_constraint.sql`, then apply `20260922_stock_opname_optional_photo.sql`, all atomically with `ON_ERROR_STOP`.
8. Run the optional-photo verifier and a rollback-only DB smoke transaction.

## Risks and Mitigations

- **Risk**: A hidden required-photo caller remains. **Mitigation**: repository search plus focused contract test.
- **Risk**: Supplied photos regress. **Mitigation**: retain normalization in save/submit/approve and test upload failure.
- **Risk**: Migration removes more than the trigger. **Mitigation**: exact `drop trigger if exists ... on public.stock_opname` only; verifier checks retained contracts.
- **Risk**: Production data mutation during smoke. **Mitigation**: use a transaction that explicitly rolls back and does not insert/update business rows.
- **Risk**: Production is missing the security/constraint prerequisites. **Mitigation**: stop before schema apply and request explicit approval for the prerequisite sequence.
