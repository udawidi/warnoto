# Data Model: Pool Kuantitas Alat Bantu

## heavy_equipment

- `tracking_mode`: `UNIT` atau `QUANTITY`, default `UNIT`.
- `quantity_total`: integer positif, default `1`.
- Mode dan total immutable setelah menjadi `QUANTITY`.
- Spesifikasi, satuan, gudang, dan lokasi tetap pada `data` JSON existing.

## heavy_equipment_loans

- `quantity_borrowed`: integer positif, default `1`.
- `quantity_returned_good`: integer non-negatif.
- `quantity_returned_damaged`: integer non-negatif.
- `quantity_returned_lost`: integer non-negatif.
- `remaining = borrowed - good - damaged - lost`.
- `data.returnEvents[]`: `id`, `good`, `damaged`, `lost`, `remainingAfter`, `evidencePath`, `conditionNote`, `actorId`, `occurredAt`.

## Invariant Pool

`total = available + reserved_or_outstanding + damaged + lost`.

- Pending lintas-UPT ikut mereservasi saldo.
- Rejected tidak mereservasi saldo.
- Return baik menambah available.
- Return rusak/hilang tidak menambah available.

## State

- Pending lintas-UPT: `PENDING_OWNER_ASMAN`.
- Aktif: `DIPINJAM`, runtime dapat menjadi `OVERDUE`.
- Parsial: status tetap aktif, UI menampilkan sisa.
- Sisa nol: `SELESAI`.

