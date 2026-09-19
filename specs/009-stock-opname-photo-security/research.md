# Research

- `useStockOpname` previously uploaded existing-item photos only during final Asman approval and ignored upload errors.
- `StockOpnameTab` previously kept selected photos as base64 in component state until save/approval.
- `stock_opname` already has typed `upt_id`, foreign-key protection, and `can_access_upt` RLS.
- `stock-photos` previously allowed any authenticated writer and remains public-read for QR.
- Existing `saveOpname` already has a server merge mechanism keyed by touched block IDs.

Decision: extend those paths only; no new table or dependency.
