# Feature Specification: Optional Heavy Equipment Loan Letter

**Feature Branch**: `[019-optional-loan-letter]`

**Created**: 2026-09-21

**Status**: Ready

**Input**: User description: "Pada peminjaman alat berat oleh HAR UIT, Foto Serah-Terima tidak diperlukan dan diganti Surat Peminjaman yang opsional."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ajukan Peminjaman Tanpa Surat (Priority: P1)

Petugas HAR UIT dapat mengajukan peminjaman alat berat tanpa mengunggah dokumen serah-terima atau surat peminjaman.

**Why this priority**: Dokumen bukan syarat peminjaman dan tidak boleh menghalangi proses operasional.

**Independent Test**: Pilih alat yang tersedia, isi data wajib, biarkan Surat Peminjaman kosong, lalu ajukan dan pastikan pengajuan tercatat.

**Acceptance Scenarios**:

1. **Given** petugas HAR UIT telah mengisi data wajib, **When** pengajuan dikirim tanpa surat, **Then** pengajuan tersimpan dan menunggu persetujuan pemilik alat.
2. **Given** petugas HAR UIT meminjam beberapa alat dalam satu pengajuan, **When** pengajuan dikirim tanpa surat, **Then** semua alat tercatat dalam satu batch.

---

### User Story 2 - Lampirkan Surat Secara Opsional (Priority: P2)

Petugas HAR UIT dapat melampirkan surat peminjaman bila dokumen tersedia.

**Why this priority**: Surat tetap berguna sebagai bukti administratif tanpa menjadi penghalang transaksi.

**Independent Test**: Lampirkan satu PDF atau gambar yang valid, ajukan peminjaman, lalu buka dokumen dari riwayat.

**Acceptance Scenarios**:

1. **Given** surat peminjaman tersedia, **When** petugas mengunggah PDF atau gambar yang valid, **Then** surat tersimpan dan dapat dibuka dari riwayat.
2. **Given** data lama memiliki bukti keluar, **When** riwayat dibuka, **Then** dokumen lama tetap dapat diakses.

### Edge Cases

- File surat kosong atau jenis file tidak didukung ditolak dengan pesan yang jelas tanpa menyimpan pengajuan parsial.
- Surat milik satu unit tidak boleh dapat ditautkan ke pengajuan unit pemilik lain.
- Kegagalan unggah surat tidak boleh meninggalkan file yatim atau transaksi setengah tersimpan.
- Bukti pengembalian tetap wajib dan tidak berubah oleh fitur ini.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Form peminjaman HAR UIT MUST menampilkan field `Surat Peminjaman (opsional)` tanpa penanda wajib.
- **FR-002**: Petugas HAR UIT MUST dapat mengajukan peminjaman alat individual maupun alat berbasis jumlah tanpa surat.
- **FR-003**: Sistem MUST menerima surat opsional berformat PDF, JPG, PNG, atau WebP.
- **FR-004**: Sistem MUST menyimpan keterkaitan surat dengan unit pemilik dan batch peminjaman yang benar.
- **FR-005**: Sistem MUST menolak keterkaitan surat lintas unit pemilik.
- **FR-006**: Riwayat MUST menyediakan aksi `Lihat surat peminjaman` bila surat tersedia.
- **FR-007**: Data peminjaman dan bukti lama MUST tetap terbaca tanpa migrasi data.
- **FR-008**: Kewajiban bukti pengembalian MUST tetap berlaku.

### Key Entities

- **Peminjaman alat berat**: Pengajuan satu atau beberapa alat, peminjam, pekerjaan, jadwal, status, dan referensi surat opsional.
- **Surat peminjaman**: Dokumen administratif opsional yang terkait dengan unit pemilik dan batch peminjaman.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% pengajuan HAR UIT dengan data wajib yang valid dapat disimpan tanpa surat peminjaman.
- **SC-002**: 100% surat valid yang berhasil diunggah dapat dibuka dari riwayat pengajuan terkait.
- **SC-003**: 0 pengajuan dapat mengaitkan surat dari unit pemilik lain.
- **SC-004**: 100% catatan peminjaman lama tetap dapat dibaca setelah perubahan diterapkan.

## Assumptions

- Perubahan hanya melonggarkan dokumen awal untuk peminjam HAR UIT; alur peminjaman selain HAR UIT tetap mengikuti aturan yang ada.
- Persetujuan Asman pemilik alat dan bukti pengembalian tidak berubah.
- Dokumen lama memakai lokasi penyimpanan dan referensi yang tetap kompatibel.
