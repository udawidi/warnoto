# Contract: Final Approval TUG-10

Input RPC tetap `approve_tug10_final(p_tug10_id text, p_idempotency_key uuid)`.

RPC membaca `stockItems[].targetStockId` dari transaksi tersimpan. Respons tetap berisi `transaction`, `stocks`, `katalogs`, `attbDrafts`, dan `idempotent`.

RPC juga membaca `stockItems[].stockHandling`:

- `MERGE`: `targetStockId` wajib, dikunci, divalidasi katalog/lokasi/UPT, lalu qty ditambah.
- `SEPARATE`: target diabaikan, lot TUG-10 deterministik dibuat atau dilanjutkan secara idempoten.
- Legacy tanpa handling mengikuti fallback kontrak data-model.

Error tambahan:

- `TUG10_TARGET_STOCK_NOT_FOUND`
- `TUG10_TARGET_STOCK_MISMATCH`
- `TUG10_TARGET_STOCK_AMBIGUOUS`
- `TUG10_STOCK_HANDLING_INVALID`
- `TUG10_TARGET_STOCK_REQUIRED`
- `TUG10_TARGET_SOURCE_ALLOCATION_REQUIRED`

Semua error validasi harus atomic: tidak ada perubahan qty, lot, atau status transaksi.
