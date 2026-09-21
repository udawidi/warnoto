# Feature Specification: Sinkronisasi Langsung Stock Opname

**Feature Branch**: `main`
**Created**: 2026-09-21
**Status**: Approved
**Input**: Perbaiki kewenangan freeze dan gap progres Stock Opname antarakun tanpa merusak hitungan Fajar.

## User Scenarios & Testing

### User Story 1 - Progres yang sama lintas akun (Priority: P1)

Admin Gudang mengisi hasil hitung dan TL yang sedang membuka sesi yang sama melihat progres server terbaru tanpa memuat ulang.

**Why this priority**: Perbedaan 26% dan 20% menghilangkan kepercayaan terhadap hasil audit.

**Independent Test**: Isi satu qty sebagai Admin dan pastikan progres TL berubah setelah penyimpanan berhasil.

**Acceptance Scenarios**:

1. **Given** dua akun membuka sesi yang sama, **When** Admin menyimpan input, **Then** TL melihat progres yang sama tanpa reload.
2. **Given** koneksi terputus, **When** autosave gagal, **Then** input lokal dipertahankan dan tidak diklaim sudah tersinkron.

### User Story 2 - Freeze hanya oleh TL (Priority: P1)

TL mengaktifkan atau menonaktifkan freeze secara manual. Role lain tidak memiliki kontrol dan tidak dapat mengubahnya lewat jalur tulis langsung.

**Independent Test**: TL berhasil mengubah freeze; Admin dan Asman ditolak tanpa mengubah sesi.

**Acceptance Scenarios**:

1. **Given** sesi aktif, **When** TL menekan tombol freeze, **Then** status tersimpan dan diterima akun lain.
2. **Given** Admin atau Asman, **When** mencoba mengubah freeze, **Then** perubahan ditolak.
3. **Given** approval atau penolakan sesi, **When** status sesi berubah, **Then** freeze tidak berubah otomatis.

### Edge Cases

- Event server datang saat input lokal belum selesai disimpan.
- Dua perangkat mengisi blok berbeda hampir bersamaan.
- Realtime terputus lalu tersambung kembali.
- Sesi selesai atau ditolak masih memiliki freeze lama.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST menyimpan input Stock Opname otomatis dan menampilkan status penyimpanan.
- **FR-002**: Sistem MUST mempertahankan input lokal ketika penyimpanan gagal.
- **FR-003**: Sistem MUST menyinkronkan progres sesi kepada akun lain yang berhak tanpa reload.
- **FR-004**: Sistem MUST menggabungkan perubahan blok berbeda tanpa menghilangkan hitungan yang sudah tersimpan.
- **FR-005**: Hanya role TL MUST dapat mengaktifkan atau menonaktifkan freeze.
- **FR-006**: Approval, penolakan, dan input qty MUST NOT mengubah freeze otomatis.
- **FR-007**: Perubahan freeze MUST hanya menyentuh metadata freeze satu sesi.
- **FR-008**: Data produksi Fajar yang sudah tersimpan MUST tetap utuh selama rilis.

### Key Entities

- **Sesi Stock Opname**: Satu audit per UPT/gudang yang memuat item, progres, status, versi server, dan freeze.
- **Hitungan per Blok**: Qty fisik beserta waktu dan pelaku untuk satu material pada satu blok.
- **Freeze**: Status manual TL, daftar gudang, waktu, dan identitas pelaku.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Progres dua akun pada sesi yang sama menjadi identik paling lambat 2 detik setelah autosave berhasil.
- **SC-002**: 100% percobaan perubahan freeze oleh Admin/Asman ditolak.
- **SC-003**: Hitungan pada dua blok berbeda tetap lengkap setelah penyimpanan bersamaan.
- **SC-004**: Sesi Fajar tetap memiliki sedikitnya 68 dari 258 item terhitung setelah pemasangan.

## Assumptions

- Scope hanya `stock_opname`; Stock Count tidak diubah.
- Freeze lama Fajar dibiarkan apa adanya sampai TL mengambil keputusan manual.
- Sistem autentikasi, RLS UPT, dan penyimpanan foto yang ada dipakai ulang.
