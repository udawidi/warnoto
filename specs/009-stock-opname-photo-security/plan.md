# Implementation plan

1. Normalize photo data URLs in `useStockOpname` using the opname session UPT.
2. Upload selected existing-item photos in `StockOpnameTab`, then save through server merge.
3. Check cloud write results and rollback local transitions on failure.
4. Use session lookup for Non-SAP photo upload; never use reviewer/actor UPT.
5. Add proposal-only Storage policies, rollback, read-only verifier, staged backfill, and post-backfill constraint.
6. Add proposal-only transactional Asman approval RPC, rollback, verifier, and a client helper that sends changed absolute rows only.
7. Run contract tests, build, diff checks, graph refresh, and spec audit.

## Rollout order

1. Apply and verify the Storage policy and approval RPC in scratch/staging.
2. Run the backfill dry-run, then write backfill and verify zero targeted data URLs.
3. Apply the no-data-URL constraint only after the verifier passes.
4. Deploy frontend code only after the RPC and Storage policies are confirmed available.
