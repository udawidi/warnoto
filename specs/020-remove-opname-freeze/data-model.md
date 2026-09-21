# Data Model and Migration

## Preserved

- `stock_opname`: tabel tetap ada; Realtime publication/subscription dan `updated_at` tetap.
- Legacy `freeze`: nilai lama dipertahankan dan dibuat inert; tidak ada mass-update.

## Removed

- RPC, trigger, policy/guard, helper database, atau object lain yang khusus menerapkan freeze.
- Penghapusan dilakukan dengan migration; migration tidak boleh menjatuhkan tabel `stock_opname`.

## Verification entities

- Heavy-equipment seed: non-TL/ADMIN tidak menulis seed; fallback write hanya role TL.
- GI dan QR/Barcode: existing entities, verification only.
