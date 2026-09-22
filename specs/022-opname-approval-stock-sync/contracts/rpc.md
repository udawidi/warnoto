# RPC Contract: `approve_stock_opname_asman`

## Signature

```sql
public.approve_stock_opname_asman(
  p_opname_id text,
  p_opname_data jsonb,
  p_katalog_rows jsonb default '[]'::jsonb,
  p_stock_rows jsonb default '[]'::jsonb
) returns jsonb
```

## Preconditions

- Authenticated `ASMAN` or `SUPERADMIN`.
- Opname exists, is scoped to the caller, and is `PENDING_ASMAN`.
- Every discrepant catalog in the locked pending snapshot has a nonblank note.
- Any supplied stock row belongs to the opname catalog and UPT.
- Every supplied stock row retains its existing `qty` exactly.

## Success

```json
{"ok":true,"id":"OPN-1","status":"SELESAI","idempotent":false}
```

## Failure

Raise a stable `OPNAME_APPROVAL_*` exception. PostgreSQL transaction rollback keeps stock and opname status unchanged. Examples: `OPNAME_APPROVAL_NOTE_REQUIRED`, `OPNAME_APPROVAL_QTY_MUTATION`, `OPNAME_APPROVAL_STOCK_SCOPE_DENIED`.

## Ordering

Validation → catalog metadata → stock metadata/SAP baseline → opname finalization. Finalization is last.

# RPC Contract: `update_stock_opname_tug_reference`

Allows `ADMIN`, `TL`, or `SUPERADMIN` to add or clear one optional `tugReference` on a completed, same-UPT opname item. It does not change stock quantity or opname status.

# RPC Contract: `reject_stock_opname_asman`

Accepts `p_opname_id text` and nonblank `p_reason text`. Only `ASMAN` or `SUPERADMIN` in scope may change `PENDING_ASMAN` to `DITOLAK`. Stored items, Qty Fisik, and notes are preserved.

# Direct write policy

Direct insert/update/delete is restricted to `ADMIN`, `TL`, or `SUPERADMIN` for `DRAFT`. A draft update may submit to `PENDING_ASMAN`; later transitions use role-gated RPCs.
