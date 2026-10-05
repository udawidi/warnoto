# Data Model

Tidak ada perubahan penyimpanan.

## Input transaksi

- `status` atau `stage`: harus `APPROVED`.
- `stockItems[].katalogId`: referensi utama master katalog.
- `stockItems[].katalogBaru`: fallback nomor katalog untuk material baru.

## State UI sementara

- `busy`: satu proses cetak aktif.
- `activeItemKey`: identitas item yang menampilkan status.
- `printState` dan `message`: status aksesibel dari service NIIMBOT.
