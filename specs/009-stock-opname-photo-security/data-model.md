# Data model

## Existing rows

- `stock_opname.upt_id`: typed UPT tenant key, `NOT NULL`, FK to `upt(id)`, protected by `can_access_upt`.
- `stock_opname.data.items[*].fotoKeseluruhan`: public Storage URL or null.
- `stock_opname.data.items[*].fotoNameplate`: public Storage URL or null.
- `storage.objects` bucket `stock-photos`: public read; write path `<upt-id>/<catalog>/<utama|tambahan>-<uuid>.jpg`.

## Migration policy

No new business table. A proposal-only helper validates the first Storage path segment against an accessible UPT and exact writer roles. A later constraint rejects `data:` only in the two Stock Opname photo fields after the backfill verifier reports zero rows.

Final approval uses `approve_stock_opname_asman` with changed absolute rows only: `katalog_rows` first, `stock_rows` second, and the final `stock_opname` row last inside one transaction. No delete/reconciliation is performed by the RPC.
