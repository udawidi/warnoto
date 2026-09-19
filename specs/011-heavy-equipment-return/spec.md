# Feature Specification: Pengembalian Alat Berat

**Feature Branch**: `main`

**Created**: 2026-09-19

**Status**: Approved for implementation

**Input**: ADMIN/TL UPT pemilik harus dapat menandai alat pinjaman yang sudah kembali langsung dari kartu alat, dengan penyimpanan status yang konsisten.

## User Scenarios & Testing

### User Story 1 - Selesaikan Pengembalian dari Daftar Alat (Priority: P1)

ADMIN/TL UPT pemilik melihat alat yang sedang dipinjam atau overdue dan menyelesaikan pengembalian tanpa mencari aksi tersembunyi di histori.

**Why this priority**: Alat tetap terkunci sebagai dipinjam bila aksi tidak ditemukan.

**Independent Test**: Login sebagai ADMIN/TL pemilik, buka Daftar Alat, konfirmasi dua checklist, lalu pastikan alat tersedia dan loan selesai setelah refresh.

**Acceptance Scenarios**:

1. **Given** loan aktif milik UPT pengguna, **When** pengguna membuka kartu alat, **Then** tombol `Tandai Alat Kembali` terlihat.
2. **Given** dua checklist belum lengkap, **When** modal terbuka, **Then** penyelesaian tidak dapat dikirim.
3. **Given** konfirmasi lengkap, **When** server menerima aksi, **Then** loan menjadi selesai dan alat menjadi tersedia bersama-sama.

### User Story 2 - Tolak Pengembalian Tidak Sah (Priority: P2)

Pengguna dari UPT peminjam atau role selain ADMIN/TL pemilik tidak dapat menyelesaikan pengembalian.

**Independent Test**: Gunakan identitas UPT peminjam dan pastikan tombol tidak ada serta panggilan server ditolak.

**Acceptance Scenarios**:

1. **Given** pengguna bukan ADMIN/TL UPT pemilik, **When** membuka transaksi aktif, **Then** tombol pengembalian tidak terlihat.
2. **Given** pengguna tidak berwenang memanggil aksi server langsung, **When** permintaan diproses, **Then** tidak ada record yang berubah.

### Edge Cases

- Loan sudah selesai/ditolak atau belum mulai tidak dapat diselesaikan lagi.
- Klik ganda tidak menghasilkan transisi ganda.
- Kegagalan server mempertahankan modal dan state lama tanpa toast sukses.
- Data legacy tanpa `activeLoanId` hanya diterima bila tepat satu loan aktif cocok dengan alat.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST menampilkan aksi pengembalian pada kartu Armada dan kartu transaksi aktif untuk ADMIN/TL UPT pemilik.
- **FR-002**: Sistem MUST mewajibkan konfirmasi fisik dan pemeriksaan kondisi sebelum pengembalian.
- **FR-003**: Sistem MUST menyimpan status loan selesai dan alat tersedia secara atomik.
- **FR-004**: Sistem MUST mencatat petugas dan waktu pengembalian dari identitas/waktu server.
- **FR-005**: Sistem MUST menolak role atau UPT yang tidak berwenang.
- **FR-006**: Sistem MUST memperbarui UI hanya dari respons sukses server.
- **FR-007**: Sistem MUST mempertahankan data dan modal ketika server gagal.

### Key Entities

- **Peminjaman Alat**: transaksi antar-UPT dengan pemilik, peminjam, status, dan metadata pengembalian.
- **Alat Berat**: aset pemilik dengan availability dan referensi loan aktif.
- **Pelaku Pengembalian**: profil ADMIN/TL pada UPT pemilik.

## Success Criteria

### Measurable Outcomes

- **SC-001**: ADMIN/TL pemilik menemukan aksi pengembalian dari kartu alat tanpa berpindah tab.
- **SC-002**: Setiap pengembalian mengubah dua record bersama-sama atau tidak sama sekali.
- **SC-003**: Semua percobaan lintas-UPT dan role tidak sah ditolak tanpa perubahan data.
- **SC-004**: Setelah refresh, loan tetap selesai dan alat tetap tersedia.

## Assumptions

- Alur ini untuk pengembalian normal; kerusakan/sengketa/foto pengembalian di luar scope.
- Pengembalian tetap manual dan tidak dipicu tanggal rencana.
- Tidak ada kolom, tabel, bucket, atau dependency baru.
