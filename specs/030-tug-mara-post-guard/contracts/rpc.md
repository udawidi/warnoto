# RPC Contract: MARA-Guarded TUG Posting

## `approve_tug3_final(p_tug3_id text, p_idempotency_key uuid) -> jsonb`

- Caller: authenticated `ASMAN` or `SUPERADMIN` with UPT access.
- Required state: TUG-3 `PENDING_ASMAN`.
- Validates every item against one MARA row.
- Atomically synchronizes catalog, applies stock, marks transaction approved, and writes audit/idempotency data.
- Returns `transaction`, `stocks`, `katalogs`, `idempotent`.

## `approve_tug10_final(p_tug10_id text, p_idempotency_key uuid) -> jsonb`

- Existing signature and response shape remain compatible.
- Existing and new catalog modes both require one MARA match.
- Newly created catalog data comes only from MARA.

## `mtu_khs_apply_tug3_receipt(...)`

- Existing signature remains unchanged.
- Existing catalog code must resolve to one MARA row before stock writes.

## Errors

- `*_MARA_CATALOG_REQUIRED`
- `*_MARA_CATALOG_NOT_FOUND`
- `*_MARA_CATALOG_AMBIGUOUS`
- `*_CATALOG_MARA_MISMATCH`
