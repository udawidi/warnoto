# Data Model: Cetak Langsung NIIMBOT M2-H

Tidak ada tabel, kolom, atau data persisten baru.

## Compact Label Payload

| Field | Source | Rule |
|---|---|---|
| `scanUrl` | ID katalog existing | Isi QR |
| `unit` | Satuan katalog | Fallback `BH` |
| `description` | Nama material | Fallback `-`, ukuran font adaptif |
| `catalogCode` | Nomor katalog canonical | Fallback existing helper |

## Print Session

State hanya hidup di browser:

- `idle`: siap menerima aksi.
- `connecting`: meminta atau memulihkan koneksi.
- `preparing`: membuat raster label.
- `printing`: mengirim raster ke printer.
- `success`: satu pekerjaan selesai.
- `error`: gagal; pesan tampil dan pengguna dapat mencoba ulang.

Transisi proses tunggal mengunci tombol dari `connecting` sampai `success` atau `error`. Disconnect menghapus koneksi agar aksi berikutnya melakukan pairing kembali.

