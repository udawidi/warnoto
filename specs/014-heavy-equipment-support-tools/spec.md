# Feature Specification: Alat Bantu Kerja dan Peminjaman HAR UIT

**Feature Branch**: `main`

**Created**: 2026-09-20

**Status**: Approved for implementation

**Input**: Semua UPT harus dapat mencatat alat bantu kerja, meminjamkannya kepada UPT/ULTG/GI/vendor/unit lain, menyimpan bukti foto di self-host, dan menjaga seluruh data terisolasi. Akun HAR_UIT harus dapat melihat serta meminjam alat lintas-UPT yang masih berada dalam UIT-nya.

## User Scenarios & Testing

### User Story 1 - TL Mengelola Registry Alat UPT (Priority: P1)

TL menambah alat berat atau alat bantu milik UPT sendiri, memilih gudang aktual, dan menentukan apakah alat boleh terlihat untuk peminjaman lintas-UPT.

**Independent Test**: TL UPT A menambah aset, refresh atau pindah perangkat, lalu aset tetap ada; TL UPT B tidak dapat mengubahnya.

**Acceptance Scenarios**:

1. **Given** TL UPT Surabaya, **When** menambah `PB-SBY-01`, **Then** aset tersimpan dengan UPT dan gudang Surabaya.
2. **Given** ADMIN atau TL UPT lain, **When** mencoba menulis aset tersebut, **Then** aksi ditolak tanpa perubahan.
3. **Given** aset privat, **When** pengguna UPT lain membaca registry, **Then** aset tidak terlihat.

### User Story 2 - TL Mencatat Peminjaman Batch (Priority: P1)

TL memilih satu atau beberapa aset dari UPT yang sama, mengisi peminjam, tanggal, pekerjaan, PIC, kontak, serta foto keluar, kemudian menyimpan satu transaksi batch.

**Independent Test**: Pilih dua aset, simpan satu transaksi, refresh, lalu keduanya tetap terkunci dan tampil dalam satu batch.

**Acceptance Scenarios**:

1. **Given** dua aset tersedia, **When** TL meminjamkan keduanya ke vendor dengan bukti foto, **Then** dua loan dibuat atomik dengan satu batch.
2. **Given** salah satu aset sudah dipinjam atau berbeda UPT, **When** batch dikirim, **Then** seluruh transaksi ditolak.
3. **Given** peminjam UPT lain, **When** transaksi dibuat, **Then** status menunggu Asman pemilik; peminjam eksternal langsung dipinjam.

### User Story 3 - TL Mengembalikan Sebagian Batch (Priority: P1)

TL memilih unit yang benar-benar kembali, mengunggah foto kembali, dan membebaskan hanya aset tersebut.

**Independent Test**: Dari batch dua aset, kembalikan satu; satu tersedia dan satu tetap dipinjam setelah refresh.

### User Story 4 - Pengguna Memantau Histori dan Overdue (Priority: P2)

Pengguna berwenang melihat batch, peminjam, PIC, kontak, bukti, status, overdue, dan dokumen cetak tanpa kebocoran ke UPT ketiga.

**Independent Test**: Owner dan requester dapat melihat loan terkait; UPT ketiga tidak dapat membaca loan atau bukti fotonya.

### User Story 5 - HAR UIT Meminjam Alat dari UPT dalam UIT-nya (Priority: P1)

HAR_UIT memilih UPT pemilik di dalam UIT-nya, memilih alat yang tersedia dan diizinkan untuk lintas-UPT, mengunggah bukti serah-terima, lalu mengajukan peminjaman atas nama organisasi HAR UIT.

**Independent Test**: HAR_UIT tanpa `upt_id` tetapi memiliki `uit_id` dapat melihat foto registry, membuat permintaan ke UPT dalam UIT yang sama, dan melihat seluruh histori peminjaman dalam UIT setelah reload.

**Acceptance Scenarios**:

1. **Given** HAR_UIT memiliki `uit_id`, **When** membuka menu Alat Berat, **Then** alat dan foto registry milik UPT dalam UIT yang sama terlihat.
2. **Given** alat tersedia dan lintas-UPT diaktifkan, **When** HAR_UIT mengisi pekerjaan, PIC, kontak, tanggal, dan foto serah-terima, **Then** permintaan tersimpan atas nama HAR UIT dan menunggu persetujuan Asman UPT pemilik.
3. **Given** UPT atau alat berada di UIT lain, **When** HAR_UIT mencoba membaca atau mengajukan peminjaman, **Then** akses ditolak tanpa perubahan data.
4. **Given** profil HAR_UIT tidak memiliki `uit_id`, **When** membuka form, **Then** form terkunci dengan pesan konfigurasi akun.
5. **Given** HAR_UIT melihat transaksi dalam UIT, **When** membuka histori, **Then** semua transaksi yang owner atau requester-nya berada dalam UIT tersebut terlihat, tanpa tombol tambah alat, edit, approve, atau return.

## Edge Cases

- Nama UPT legacy tidak cocok tepat satu master UPT.
- Klik ganda atau dua TL mencoba meminjam aset sama bersamaan.
- Upload berhasil tetapi transaksi gagal.
- Pengembalian sebagian dilakukan beberapa kali.
- Self-host tidak dapat dijangkau.
- Cache browser dikosongkan atau pengguna berganti perangkat.
- HAR_UIT tidak memiliki `upt_id`, tidak memiliki `uit_id`, atau mencoba memalsukan identitas UIT pada payload.
- Alat berada di UPT dalam UIT yang sama tetapi flag lintas-UPT nonaktif.
- Unggah bukti berhasil tetapi checkout HAR_UIT gagal dan objek belum direferensikan transaksi.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST memakai `upt_id` sebagai sumber otorisasi dan scope.
- **FR-002**: Sistem MUST menyimpan registry, loan, dan bukti foto pada self-host.
- **FR-003**: Hanya TL dengan UPT yang sama dapat menambah atau mengubah registry.
- **FR-004**: Aset privat MUST hanya terlihat dalam scope pemilik; aset lintas-UPT hanya terbaca bila flag aktif.
- **FR-005**: Checkout beberapa aset MUST atomik dan hanya menerima aset dari satu UPT pemilik.
- **FR-006**: Peminjam eksternal MUST memiliki nama organisasi, PIC, dan kontak.
- **FR-007**: Foto keluar dan foto kembali MUST wajib dan tersimpan private.
- **FR-008**: Peminjaman eksternal MUST langsung aktif; antar-UPT MUST tetap melalui approval Asman pemilik.
- **FR-009**: Pengembalian sebagian MUST hanya membebaskan aset terpilih.
- **FR-010**: Client MUST memperbarui state hanya setelah server berhasil.
- **FR-011**: Kegagalan server MUST mempertahankan form dan tidak menampilkan sukses palsu.
- **FR-012**: Tampilan MUST usable pada 360 px, 768 px, desktop, keyboard, light mode, dan dark mode.
- **FR-013**: HAR_UIT MUST memakai `uit_id` profil sebagai sumber otorisasi dan tidak bergantung pada `upt_id`.
- **FR-014**: HAR_UIT MUST hanya dapat membaca registry, foto registry, dan histori loan untuk UPT yang berada dalam UIT yang sama.
- **FR-015**: HAR_UIT MUST hanya dapat memilih alat yang tersedia dan memiliki izin lintas-UPT aktif.
- **FR-016**: Permintaan HAR_UIT MUST tercatat atas nama organisasi HAR UIT, tanpa pilihan UPT requester, serta menyimpan identitas UIT requester secara terstruktur.
- **FR-017**: Permintaan HAR_UIT MUST membutuhkan bukti foto serah-terima dan persetujuan Asman UPT pemilik.
- **FR-018**: Server MUST menurunkan identitas aktor, UIT requester, UPT pemilik, dan status dari data terotorisasi; nilai client tidak boleh memperluas akses.
- **FR-019**: HAR_UIT MUST tidak dapat menambah atau mengubah registry, menyetujui permintaan, atau menyelesaikan pengembalian.
- **FR-020**: Hasil server kosong untuk HAR_UIT MUST dianggap sebagai hasil otoritatif dan tidak boleh diganti cache lintas-scope.

### Key Entities

- **Aset**: alat berat atau alat bantu dengan pemilik UPT, gudang, kondisi, availability, dan flag lintas-UPT.
- **Batch Peminjaman**: metadata bersama satu serah-terima.
- **Loan Aset**: satu baris per aset dalam batch.
- **Bukti Peminjaman**: foto private keluar atau kembali pada folder UPT pemilik.
- **Requester UIT**: identitas UIT terstruktur untuk permintaan yang dibuat organisasi HAR UIT.

## Success Criteria

- **SC-001**: TL dapat mencatat delapan plat individual dan menemukan status tiap unit dalam kurang dari dua menit.
- **SC-002**: Semua percobaan tulis lintas-UPT dan pembacaan private oleh UPT ketiga ditolak.
- **SC-003**: Checkout atau return batch selalu berubah seluruhnya atau tidak sama sekali.
- **SC-004**: Data tetap tersedia setelah reload, cache dibersihkan, dan login dari perangkat lain.
- **SC-005**: Seluruh aksi utama dapat diselesaikan tanpa horizontal overflow pada 360 px.
- **SC-006**: HAR_UIT yang terkonfigurasi dapat melihat foto alat, memilih alat lintas-UPT, dan mengirim permintaan lengkap dalam kurang dari tiga menit.
- **SC-007**: Seluruh percobaan HAR_UIT membaca atau meminjam dari UIT lain ditolak.
- **SC-008**: Setelah reload atau pindah perangkat, permintaan dan histori HAR_UIT dalam UIT yang sama tetap terlihat tanpa data cache dari scope lain.

## Assumptions

- Label awal plat Surabaya adalah `PB-SBY-01` sampai `PB-SBY-08`; lokasi aktual dipilih TL saat input.
- Notifikasi Telegram/WA di luar scope; overdue tetap tampil di aplikasi.
- Data legacy tetap kompatibel melalui snapshot nama UPT.
- Permintaan HAR_UIT tidak mengubah alur TL, Asman, atau pengembalian yang sudah berjalan.
- Foto registry tetap memakai lokasi penyimpanan publik yang sudah ada; bukti serah-terima tetap private.
