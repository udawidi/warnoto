# Research

## Findings

- `useStockOpname.approveOpname_Asman` previously distributed the physical total into active stock, which conflicts with the revised rule that reconciliation stays manual through TUG.
- SAP quantity is catalog-level while physical and WARNOTO quantities can span multiple lots, so comparison must aggregate by catalog.
- The existing approval RPC is the atomic boundary for metadata updates and final status.
- `supabase/schema.sql` does not embed `approve_stock_opname_asman`; the migration is the canonical change artifact.

## Decision

Keep active `stocks.data.qty` immutable during approval. Validate discrepancy notes from the locked pending snapshot, stamp the latest SAP baseline per catalog/UPT, then finalize. Store an optional TUG reference through a separate role-gated RPC after completion.
