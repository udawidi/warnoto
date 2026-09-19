# Photo security contract

## Client

`uploadStockFoto(katalogId, field, dataUrl, sessionUptId) -> Promise<publicUrl>`

- `dataUrl` is uploaded before persistence.
- `sessionUptId` comes from `opname.uptId`/`opname.upt_id`.
- rejection means no status transition.

## Storage policy proposal

- INSERT/UPDATE: authenticated only.
- Path first segment must resolve to `upt.id` and pass `can_access_upt`.
- Writer role: `ADMIN`, `TL`, `ASMAN`, `SUPERADMIN`.
- SELECT/public read: unchanged.

## Backfill

`node scripts/stock_opname_photo_backfill.mjs` is dry-run. `--write` uploads legacy values and updates `stock_opname.data`; it requires an operator-provided service-role key.

## Asman approval RPC

`approve_stock_opname_asman(p_opname_id, p_opname_data, p_katalog_rows, p_stock_rows)` is proposal-only and transactional.

- SECURITY DEFINER with `search_path = public, pg_temp`.
- Only `ASMAN` or `SUPERADMIN` with `can_access_upt(stock_opname.upt_id)` may call it.
- Current status must be `PENDING_ASMAN`; identical final payload retry is idempotent.
- Catalog rows upsert first; changed absolute stock rows upsert second; opname final status updates last.
- Payload UPT, catalog references, stock identity, location UPT, photo URL format, and existing-stock scope are validated.
- RPC error returns false to the client. There is no fallback to `saveToCloud` for final approval.
