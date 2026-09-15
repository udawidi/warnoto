# Research: Lot Sumber Material TUG-8/9

## Decision: Gunakan baris `stocks` sebagai lot

Canonical TUG-8/TUG-9 sudah mengunci dan mengurangi satu `stock_id`. Memisahkan penerimaan menjadi beberapa baris stok membuat saldo per sumber akurat tanpa tabel atau signature RPC baru.

## Decision: Pemilihan sumber eksplisit

Tidak ada FIFO. Picker menampilkan semua lot aktif. Kebutuhan lintas sumber dipecah menjadi beberapa baris transaksi agar audit dan pengurangan saldo tidak ambigu.

## Decision: Identitas sumber stabil dalam `stocks.data.sourceLot`

TUG-3 memakai kombinasi UPT/lokasi, katalog, penyedia, dan identitas kontrak/dokumen. Jika referensi kontrak kosong, gunakan transaksi dan indeks item. TUG-10 memakai transaksi dan indeks item. Kunci disimpan saat lot dibuat dan tidak dihitung ulang dari label tampilan.

## Decision: Snapshot tetap server-authoritative

`tug_items.source_snapshot` tetap di luar `tug_items.snapshot` dan hash canonical. Helper database mengambil metadata dari baris lot yang dipilih dan menambahkan `lotKey`; payload client tidak dipercaya.

## Decision: Stok lama dibagi atomik

RPC `tug_split_stock_source_lots` mengunci baris lama, memeriksa peran/UPT, expected qty, total alokasi, keunikan kunci, dan idempotency key. Marker hasil dan ID lot tersimpan pada baris asli sehingga retry mengembalikan hasil yang sama tanpa tabel baru.

## Decision: Pisahkan tampilan detail dan agregasi

Data Stok dan Stock Opname memakai baris lot. Stock Count, forecast, dan ringkasan menjumlahkan qty semua lot per katalog sehingga angka bisnis tidak berubah.
