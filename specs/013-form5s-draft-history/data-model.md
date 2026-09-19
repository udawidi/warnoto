# Data model

## `maturity_5s_drafts`

- `id`: UUID primary key.
- `owner_id`: authenticated profile UUID; immutable owner.
- `upt_id`: canonical UPT identifier.
- `data`: JSON object containing period, warehouse, auditor, checklist, notes, and protected photo metadata.
- `created_at`, `updated_at`: timestamps.
- Unique constraint: `(owner_id, upt_id)`.

## Security invariants

- Read, insert, update, and delete require `owner_id = auth.uid()`.
- Insert/update also require `can_write_maturity_upt(upt_id)`.
- Draft rows are never joined into final assessment history or UIT summary.

## State transition

`editing -> draft saved -> draft restored -> final assessment inserted -> draft deleted`

If the last delete fails, the final assessment remains authoritative and the stale draft can be overwritten or removed later.
