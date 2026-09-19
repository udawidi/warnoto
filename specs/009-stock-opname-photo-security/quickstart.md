# Quickstart

1. Run `node --test tests/unit/stockOpnamePhotoSecurity.contract.test.mjs`.
2. Run `npm run build`.
3. Run `node scripts/stock_opname_photo_backfill.mjs` without `--write` and review the count.
4. Apply the Storage proposal only after explicit production approval.
5. Apply the Asman approval RPC proposal in scratch/staging and run `supabase/verify_stock_opname_asman_approval_rpc.sql`.
6. Run `supabase/verify_stock_opname_photo_security.sql`.
7. After the backfill count is zero, apply the data constraint proposal.
8. Deploy frontend only after the RPC verifier passes.
9. Verify QR photo read anonymously, cross-UPT write rejection, and failed approval rollback.
