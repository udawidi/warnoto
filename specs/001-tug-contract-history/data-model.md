# Data Model

## TUG Item Source Snapshot

Kolom baru `tug_items.source_snapshot` adalah JSON object:

- `sourceKind`: `TUG3_CONTRACT`, `SAP_MIGRATION`, `TUG10_RETURN`, atau `INITIAL_STOCK`.
- `contracts`: array referensi kontrak, terbaru ke terlama, dedupe berdasarkan `docNo` dan `noKontrak`.
- `provenance`: `CREATE`, `AMEND`, atau `HISTORICAL_BACKFILL`.

Snapshot bersifat informatif, server-derived, dan tidak menjadi bagian hash dokumen canonical.

## Contract Reference

- `docNo`, `supplier`, `noKontrak`, `tglMasuk`
- `suratPesananNo`, `suratPesananTgl`, `amandemenNo`

## Source Classification

Prioritas: kontrak TUG-3 valid, marker retur TUG-10, baseline/import SAP, lalu stok awal.
