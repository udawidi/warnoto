# Data Model

## Client objects

- `StockOpnameItem`: `katalogId`, optional `stockId`, `qtySistem`, `qtsFisik`, optional `qtySAP`, required `keterangan` when discrepant, and optional `tugReference` after completion.
- `StockRow`: `id`, `katalogId`, `lokasiId`, `uptId`, `qty`, plus existing metadata.
- `KatalogRow`: existing catalog ID and display data.

## Invariants

- Physical and WARNOTO quantities are summed per catalog; SAP remains one catalog-level value.
- A SAP material is discrepant when any of SAP, physical, or WARNOTO differs or SAP is missing.
- A Non-SAP material is discrepant when physical and WARNOTO differ.
- Every discrepant catalog has a nonblank note on its representative item.
- Approval never changes `StockRow.qty`.
- `sapBaselineQty` is stamped on same-UPT stock rows without being summed across lots.
- `SELESAI` is written only after all guards and metadata writes pass.
- `qtsFisik` is manually entered only while the session is `DRAFT` by ADMIN/TL/SUPERADMIN.
- Backfill target is fixed to UPT-SBY approvals in the WIB interval `[2026-09-22, 2026-09-23)` and never writes `stock_opname`.
