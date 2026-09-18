# Feature Specification: Riwayat Opname dan QR Blok

**Created**: 2026-09-18
**Status**: Approved in conversation, implementation in progress

## User Scenarios & Testing

### User Story 1 — Ruang hitung fokus (P1)

Petugas mengisi Stock Opname tanpa daftar riwayat memenuhi bagian bawah halaman. Seluruh sesi Opname dan Stock Count tersedia dalam satu submenu Riwayat, termasuk draft, menunggu persetujuan, dan selesai. Aksi lama tetap tersedia.

**Acceptance Scenarios**

1. Saat mengerjakan Opname, riwayat tidak tampil di bawah tabel. Pindah ke Riwayat dan kembali tidak menghapus hitungan yang belum disimpan.
2. Dari Riwayat, petugas dapat melanjutkan draft Opname; Asman tetap dapat memeriksa sesi Stock Count yang menunggu persetujuan.
3. Panel Opname aktif menampilkan satu tombol Batal di bawah tabel.

### User Story 2 — Daftar blok dan material mudah dibaca (P1)

Petugas memilih gudang dan blok dari daftar yang terurut, lalu membaca nama material dan label SAP tanpa tulisan bertumpuk pada desktop maupun ponsel.

**Acceptance Scenarios**

1. Blok A-2 muncul sebelum A-10, baik di filter Opname maupun Mode Lapangan. Tanpa Lokasi tampil terakhir.
2. Nama material panjang tetap terbaca dan label SAP berada di baris tersendiri tanpa menimpa deskripsi.

### User Story 3 — Satu QR untuk blok dan Opname (P1)

Petugas mencetak QR tiap blok dari Master Gudang. Siapa pun yang memindainya lewat kamera HP melihat identitas blok dan material dengan stok positif di sana. QR yang sama dapat dipindai dalam Mode Lapangan untuk memilih blok pada sesi Opname.

**Acceptance Scenarios**

1. Blok lama maupun baru dapat dicetak sendiri atau bersama seluruh blok dalam satu gudang.
2. Pemindaian biasa membuka halaman blok tanpa login; daftar hanya berisi material pada blok itu beserta satuan dan jumlahnya.
3. Pemindaian di Mode Lapangan memilih blok yang cocok; QR blok di luar sesi ditolak dengan pesan jelas.
4. QR dengan token salah atau hilang tidak mengungkap identitas maupun stok blok pada halaman publik.

## Requirements

- **FR-001**: Submenu Riwayat memuat seluruh sesi Opname dan Stock Count dengan aksi yang sudah ada.
- **FR-002**: Perpindahan menu tidak boleh membuang draft Opname yang belum disimpan.
- **FR-003**: Urutan gudang dan blok memakai perbandingan nama/kode alami; Tanpa Lokasi terakhir.
- **FR-004**: Tampilan material tidak boleh menumpuk nama dan label SAP pada lebar ponsel 320 px maupun desktop.
- **FR-005**: Master Gudang menyediakan cetak satu dan semua label QR blok; kode stabil saat dicetak ulang.
- **FR-006**: Halaman blok publik hanya mengembalikan satu blok dengan token benar dan stok positif yang dikelompokkan per katalog.
- **FR-007**: QR yang sama tetap memilih blok dalam Mode Lapangan.

## Success Criteria

- Semua skenario di atas lolos pada desktop dan layar 320/360 px.
- Satu QR dapat dipakai pada kedua alur tanpa mencetak label lain.
- Permintaan publik dengan token tidak valid tidak memperoleh data blok.

## Assumptions

- Jumlah stok publik adalah total stok positif per katalog pada blok yang dipindai; detail transaksi, lot, dan pengguna tidak ditampilkan.
- Daftar Riwayat mencakup draft dan sesi menunggu persetujuan, bukan hanya sesi final.
- Penerapan migrasi database self-host menunggu persetujuan pengguna sesuai kontrak proyek.
