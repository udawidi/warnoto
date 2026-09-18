# Research

- **Riwayat:** App memakai dua subtab `opname` dan `stockCount`. Riwayat Opname saat ini berada di bawah panel hitung; daftar sesi Stock Count berada di bawah unggah/review. Tambah subtab ketiga dan pertahankan semua aksi lama.
- **QR:** `buildLabelBlokHTML` dan `lokasiScanUrlFor` sudah ada, tetapi tidak dipanggil dari Master Gudang. `?loc=` belum memiliki halaman publik. Mode Lapangan sudah membaca ID lokasi dari URL QR.
- **Sumber stok:** `stock_current` menggabungkan seluruh lokasi per katalog sehingga tidak sesuai untuk blok. `stocks.lokasi_id` dan `stocks.data.qty` adalah data blok yang dipakai aplikasi.
- **Akses:** `lokasi` dan `stocks` tidak dibaca oleh anonim. Gunakan token acak per blok dan satu RPC baca saja. Query token hanya saat mencetak label agar full-sync tidak menimpa atau menyalinnya ke JSON aplikasi.
- **URL:** `?loc=<id>#t=<token>` mempertahankan pemilihan blok di Mode Lapangan dan mencegah token masuk ke log permintaan URL.
