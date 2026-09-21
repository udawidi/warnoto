# Data Model: Label Material Barcode Blok

Tidak ada tabel atau kolom baru.

## Material Blok

Satu item dalam daftar `materials` untuk blok dengan token valid.

| Field | Isi | Aturan |
|---|---|---|
| `katalog` | Nomor katalog tampil | Existing, fallback id katalog |
| `nama` | Nama material | Existing, fallback `-` |
| `satuan` | Satuan material | Existing, fallback string kosong |
| `qty` | Total stok positif | Dijumlahkan pada grain katalog + label SAP + jenis |
| `sapLabel` | Label status final | Salah satu label SAP existing atau `Non-SAP` |
| `jenisBarang` | Jenis material | Override stok, fallback katalog, lalu `-` |

## Resolution Rules

1. `sapStatus` eksplisit `Non-SAP` selalu menang.
2. Jenis `Pre Memory` menghasilkan `SAP — Pre Memory` kecuali status eksplisit Non-SAP.
3. Label SAP spesifik dipertahankan.
4. Status generik `SAP` dan status kosong mengikuti aturan nomor katalog existing.
5. Status yang tidak dapat dikenali menjadi `Non-SAP`.
6. Jenis material kosong menjadi `-`; tidak ditebak.

## Relationships

- Baris stok menunjuk satu katalog dan satu lokasi blok.
- Lokasi menunjuk gudang dan UPT.
- Hanya stok pada lokasi yang cocok dan kuantitas agregat positif yang dikembalikan.

## State Transitions

Tidak ada. Fitur baca-saja.
