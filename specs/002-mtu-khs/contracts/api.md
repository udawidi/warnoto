# API Contract: MTU KHS

## Revised master-data contract

- `mtu_khs_gardu_induk` exposes `upt_id` and `normalized_name`; authenticated clients may SELECT only.
- GI uniqueness is `(upt_id, normalized_name)`. Bay uniqueness is `(gardu_induk_id, normalized_name)`.
- `mtu_khs_upsert_gardu_induk(p_id, p_ultg_id, p_data)` derives and persists `upt_id` from the selected ULTG, normalizes the name, and rejects inaccessible or invalid hierarchy.
- `mtu_khs_upsert_bay(p_id, p_gardu_induk_id, p_data)` derives the parent UPT through GI and applies the same scoped RPC gate.
- Master seed `20260912_mtu_gi_master_seed.sql` is insert-only and idempotent. Expected result: 6 UPT, 15 normalized ULTG, 82 GI, 195 Bay; `GI 150KV KASIHJATIM` → `KRIAN`.

## Queries

- Scoped, paginated MTU record list with year/vendor/UPT/status/drawing/search filters.
- `mtu_khs_list_records(year, upt_id, vendor, lifecycle_status, search, limit, offset)` returns scoped items, exact total, filtered metrics, and vendor options. `limit` accepts only 20 or 50.
- Record detail with units, documents, usage links, and change history.
- Scoped GI and Bay master lists.
- Import batch and row validation lists.

## Mutations

- `mtu_khs_submit_change(record_id, expected_version, patch, idempotency_key)`: validates actor field ownership and hierarchy, then creates a pending request.
- `mtu_khs_decide_change(request_id, decision, reason)`: validates approver role/scope and applies accepted patches atomically.
- `mtu_khs_commit_import(batch_id, idempotency_key)`: validates mappings, duplicates, approval, hierarchy and idempotency before promotion.
- GI/Bay row-level create/update/deactivate operations guarded by master permission and hierarchy scope.
- An approved MTU change creates one idempotent Sheet-sync job in the same database transaction. Google delivery is asynchronous and never rolls back an approved canonical record.
- `push-mtu-khs` accepts a stored job identifier, validates the caller, and writes only allowlisted source-sheet fields after verifying the target row identity.

## Errors

Stable codes include `MTU_SCOPE_DENIED`, `MTU_HIERARCHY_INVALID`, `MTU_MAPPING_REQUIRED`, `MTU_APPROVER_INVALID`, `MTU_TUG_NOT_APPROVED`, `MTU_DRAWING_YEAR_MISMATCH`, and `MTU_IMPORT_ALREADY_COMMITTED`.

## Security and ownership

- Authenticated clients have SELECT only on canonical records, units, documents, usage links, and decided history. Direct DML is denied.
- SECURITY DEFINER RPCs use an explicit search path, row locks, optimistic version checks, idempotency keys, and narrow execute grants.
- PENGADAAN may change procurement/vendor/contract/price/delivery/document/import/spec fields nationally. Its requests and per-UIT import batches require ASMAN_LOG_UIT for the record/batch UIT.
- TL may change onsite actuals, GI/Bay or warehouse placement, serials, usage references, installation planning/actuals and status only within its UPT. Its requests require ASMAN of that UPT.
- GI/Bay manual maintenance requires `aksi.kelolaMaster` and hierarchy scope. Imported master candidates become active only through the approved UIT batch.
