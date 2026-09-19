# Stock Opname Photo Security

## Summary

Stock Opname photos must be uploaded to Supabase Storage before any Stock Opname draft or approval transition is persisted. Stock Opname rows and photo writes are isolated by UPT. QR/public photo read remains supported.

## Requirements

### R1 — Immediate photo persistence

When an existing Stock Opname item receives a photo, the client uploads it immediately using the session UPT and stores only the resulting URL in `stock_opname.data`.

### R2 — Legacy normalization

Save, submit, and Asman approval normalize any legacy `data:` photo values to Storage URLs. An upload failure blocks the transition and shows an error.

### R3 — Durable status

Draft, submit, and approval operations check `saveToCloud`. A false result restores the prior in-memory status/data and does not show success.

### R4 — Multi-device merge

Photo saves use the existing server merge path so hitungan per blok from another device is not overwritten.

### R5 — UPT isolation

The Storage write policy accepts only paths whose first segment resolves to an accessible UPT and whose writer role is exactly `ADMIN`, `TL`, `ASMAN`, or `SUPERADMIN`. Existing `stock_opname` RLS remains authoritative.

### R6 — Compatibility

Existing URL/path values remain valid. `stock-photos` public read remains enabled for QR. Legacy base64 data is backfilled before the optional database constraint is applied.

### R7 — Atomic Asman approval

Asman final approval uses one transactional SECURITY DEFINER RPC. It validates role, UPT scope, current status, photo normalization, catalog/stock references, and location scope; it upserts only changed absolute-state rows before marking the opname `SELESAI`. The client has no unsafe fallback.

## Acceptance criteria

- Reload after photo input shows the Storage URL and the photo remains visible.
- No new `data:` photo value is sent to `stock_opname`.
- Upload, Storage policy, or database failure prevents status advance.
- Cross-UPT Storage writes are rejected by RLS.
- Anonymous QR photo read still works.
- A failed approval leaves `stock_opname`, `stocks`, and `katalog` unchanged.
- Retrying the same successful approval is idempotent.
