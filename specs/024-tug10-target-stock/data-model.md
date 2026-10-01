# Data Model: TUG-10 Target Stok

## Item TUG-10

- `stockHandling: "MERGE" | "SEPARATE" | ""`: pilihan penanganan stok; kosong hanya untuk item baru yang belum memilih mode.
- `targetStockId: text | null`: stok tujuan untuk `MERGE` dan `katalogMode=existing`.
- `MERGE` wajib memiliki target yang cocok dengan `katalogId`, `lokasiTujuanId`, dan UPT transaksi.
- `SEPARATE` mengosongkan/mengabaikan target. Kandidat nol default ke `SEPARATE`; satu kandidat hanya diprefill setelah mode dipilih; lebih dari satu harus dipilih eksplisit.
- Perubahan katalog, lokasi, gudang, atau sub gudang mereset `stockHandling` dan `targetStockId`.
- Backcompat: tanpa handling + target berarti `MERGE`; tanpa target + satu kandidat berarti `MERGE`; nol berarti `SEPARATE`; lebih dari satu berarti ambiguous.

## Stok

- `data.qty`: ditambah qty retur.
- `data.sourceLot`: tidak berubah untuk target existing.
- `data.jenisBarang` dan `data.status`: dipertahankan saat `MERGE`.
- `data.tug10ReturnEffects`: object keyed `<txnId>:<itemIndex>` dengan `qty`, `at`, dan dokumen sumber.
- Lot `SEPARATE`: ID deterministik, `sourceLot=TUG10_RETURN`, `returnStatus=statusMaterial`, mapping `jenisBarang`, serta kolom fisik `upt_id`.

## State transition

`PENDING_ASMAN` menjadi `APPROVED` hanya dalam transaksi database yang sama dengan perubahan qty dan audit efek retur.
