# Research: TUG-10 Target Stok

## Decision

`targetStockId` adalah identitas lot tujuan. RPC mempertahankan `sourceLot` target dan menyimpan audit baru `tug10ReturnEffects` keyed `txnId:itemIndex`.

## Rationale

Pemilihan eksplisit menghilangkan ambiguitas beberapa lot. Marker `_tug10Applied` tidak dipakai pada target karena dapat mengklasifikasikan stok SAP/TUG-3 sebagai campuran sumber dan mengganggu TUG-8/TUG-9.

## Alternatives considered

- Memilih baris pertama: ditolak karena nondeterministik.
- Selalu membuat lot baru: tidak memenuhi proyeksi UI 3 + 3 = 6.
- Mengagregasi tampilan saja: tidak menambah baris stok yang dipilih pengguna.
