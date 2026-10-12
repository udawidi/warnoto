# Data Model: TUG MARA Posting Guard

No new business table is required.

## Existing Entities

- `mara_catalog`: authoritative `kode_material`, `nama`, `satuan`, `material_group_desc`.
- `katalog`: active JSONB master; synchronized from the resolved MARA row during posting.
- `stocks`: active balance rows; receives MARA-derived identity fields.
- `tug3_transactions`: TUG 3&4 workflow row; final transition becomes RPC-only.
- `tug10_transactions`: TUG 10 workflow row; existing RPC gains MARA enforcement.
- `tug_idempotency_keys`: stores the TUG-3 final approval response under operation `TUG3_FINAL_APPROVE`.

## Validation

- Canonical match key: `ltrim(btrim(code), '0')`.
- Exactly one MARA row must match every item.
- Final approval transitions from `PENDING_ASMAN` to `APPROVED` only after all item validations pass.
- Any failure rolls back catalog, stock, transaction status, audit, and idempotency writes.
