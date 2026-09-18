# Data Model

- `lokasi.public_token uuid`: tidak null, unik, default acak, diisi untuk blok lama melalui migrasi. Token tetap saat data lokasi diedit atau label dicetak ulang.
- `stocks`: sumber stok hidup; jumlah valid dikelompokkan per `lokasi_id` dan `katalog_id`. Hanya hasil agregat positif yang keluar ke publik.
- `katalog`: sumber nama material, nomor katalog, dan satuan. Data transaksi, lot, pengguna, dan metadata internal tidak ikut respons publik.
- Sesi Opname dan Stock Count tidak berubah bentuk; hanya tempat daftar riwayat ditampilkan yang berubah.
