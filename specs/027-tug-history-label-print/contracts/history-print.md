# Contract: History TUG → NIIMBOT

## Eligibility

`documentType ∈ {TUG-3, TUG-4, TUG-10}` dan status efektif transaksi `APPROVED`.

## Catalog Resolution

1. Cocokkan `stockItem.katalogId` ke `katalogList[].id`.
2. Jika tidak ditemukan, kanoniskan `stockItem.katalogBaru` lalu cocokkan dengan `katalogList[].katalog` kanonis.
3. Jika gagal, jangan panggil printer dan tampilkan `Katalog belum sinkron`.

## Print

Panggil `printCompactLabelM2h(resolvedKatalog, { onStatus })`. Semua kegagalan dipetakan memakai `friendlyNiimbotError`.
