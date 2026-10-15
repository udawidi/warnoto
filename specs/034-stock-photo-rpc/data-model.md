# Data Model: Penyimpanan Foto Data Stok Aman

Tidak ada tabel atau kolom baru.

## Stock JSON

- `fotoNameplate`: URL public object `stock-photos`.
- `fotoKeseluruhan`: URL public object `stock-photos`.
- `fotoNameplateOcr`: teks OCR, `null` setelah nameplate berubah.
- `photoHistory`: array append-only untuk foto lama.
- Field terlindungi: `qty`, `sourceLot`, `_tug3Applied`.

## Photo history entry

- `id`: identitas unik berbasis UPT, stock, field, dan waktu.
- `source`: `MANUAL`.
- `sourceId`: stock ID.
- `uptId`: UPT pemilik stok.
- `at`: epoch millisecond.
- `before`: object berisi URL foto sebelumnya pada field yang diganti.
