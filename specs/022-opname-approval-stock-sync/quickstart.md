# Quickstart

1. Run focused tests:

   `node --test tests/unit/stockOpnameReconciliation.test.mjs tests/unit/stockOpnameApprovalReview.contract.test.mjs tests/unit/stockOpnamePhysicalQtyRole.contract.test.mjs tests/unit/stockOpnameManualQtySecurity.contract.test.mjs tests/unit/stockOpnameFlow.test.mjs`

2. Run all unit tests:

   `npm test`

3. Build:

   `npm run build`

4. Check whitespace:

   `git diff --check`

5. Review the migration and apply it only after explicit production approval, backup, and database verifier/smoke rollback. This task deliberately does not apply it.

6. Before the one-time UPT-SBY backfill, run `supabase/preview_stock_opname_sap_20260922_upt_sby.sql`, save its document hashes, notes, and rollback SQL outside Git, then take a fresh production pg_dump.
