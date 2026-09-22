# Data Model: Optional Stock Opname Photos

## Existing entities

### `stock_opname`

- Existing row identity, UPT scope, status, and `data` JSON remain unchanged.
- `data.items[].fotoKeseluruhan` and `data.items[].fotoNameplate` may be empty or storage-backed references.
- `data` retains the anti-dataURL check constraint.

### `storage.objects`

- Existing `stock-photos` bucket and UPT-scoped policies remain unchanged.
- Supplied client data URLs are converted to stored objects before persistence.

### Data Stok / Kartu Gantung

- ASMAN approval keeps the existing behavior: a normalized supplied photo updates the corresponding stock row; approval adds the opname history date used by Kartu Gantung.

## Invariants

- `data:` URLs never persist to `stock_opname.data`.
- Approval RPC signature and grants remain unchanged.
- The retired required-photo trigger is absent after migration.
- No table, column, or legacy helper function is dropped by this feature.
