# Feature Specification: Cetak Label dari History TUG

## Tujuan

Pengguna dapat mencetak label NIIMBOT 70×50 mm langsung dari item transaksi TUG-3/4 dan TUG-10 yang sudah disetujui tanpa mencari ulang material di Data Stok. Teks deskripsi material harus tetap berada di panel teks dan tidak menimpa barcode.

## User Stories

### US1 — Cetak label per item dari History TUG (P1)

Pada transaksi berstatus `APPROVED`, pengguna membuka daftar item lalu menekan tombol cetak pada material yang dipilih. Aplikasi mencetak format compact melalui NIIMBOT M2-H.

**Acceptance:**

- TUG-3/4 menampilkan tombol pada setiap baris di dalam `Lihat item`.
- TUG-10 menampilkan tombol pada setiap baris material.
- Transaksi yang belum `APPROVED` tidak menawarkan aksi cetak.
- Hanya satu pekerjaan cetak aktif pada satu waktu dan semua tombol lain terkunci.
- Status proses tampil pada item aktif melalui area `aria-live`.

### US2 — Resolusi katalog aman (P1)

Item katalog lama diselesaikan melalui `katalogId`. Item katalog baru diselesaikan melalui nomor katalog kanonis. Jika master katalog belum ditemukan, cetak dinonaktifkan dengan teks `Katalog belum sinkron`.

### US3 — Deskripsi panjang tidak masuk barcode (P1)

Deskripsi, termasuk token ATTB panjang tanpa spasi, dibungkus berdasarkan lebar piksel, diperkecil sampai maksimal lima baris, dipotong dengan elipsis bila perlu, dan di-clip di panel kanan.

## Batasan

- Tidak ada cetak A4 atau preview dari History TUG.
- Tidak ada perubahan skema, API, dependency, protokol BLE, atau konfigurasi transport printer.
- Posisi barcode, satuan, nomor katalog, dan garis pembatas format compact tetap.

## Success Criteria

- Seluruh skenario resolusi katalog memiliki pengujian otomatis.
- Deskripsi ekstrem tidak menghasilkan teks di luar lebar panel kanan.
- Build dan unit test lulus.
