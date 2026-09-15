# Feature Specification: Perbaikan Edit dan Sinkron Kapasitas Gudang

**Feature Branch**: `main`

**Created**: 2026-09-15

**Status**: Ready

**Input**: Perbaiki edit persentase Kapasitas Gudang agar hasil terlihat, rumus tidak melebihi 100%, dan perubahan tersimpan ke database self-host serta Google Sheet.

## User Scenarios & Testing

### User Story 1 - Edit kapasitas tersimpan dan terlihat (Priority: P1)

ADMIN, TL, atau SUPERADMIN mengedit luas lahan dan komposisi kapasitas satu sub-gudang. Luas terpakai dihitung otomatis agar pengguna tidak memasukkan data yang sama dua kali.

**Why this priority**: Nilai yang tampak tidak berubah membuat data operasional tidak dapat dipercaya.

**Independent Test**: Edit satu baris valid, simpan, buka detail, lalu muat ulang aplikasi; seluruh nilai harus tetap sama.

**Acceptance Scenarios**:

1. **Given** data kapasitas valid, **When** pengguna menyimpan perubahan, **Then** luas sisa, utilisasi, status, lima komposisi, dan total komposisi tampil sesuai nilai terbaru.
2. **Given** penyimpanan utama gagal, **When** pengguna menekan Simpan, **Then** modal tetap terbuka dan aplikasi tidak menampilkan sukses palsu.

### User Story 2 - Persentase selalu valid (Priority: P1)

Pengguna mendapat validasi jelas sebelum nilai yang tidak mungkin masuk ke data operasional.

**Why this priority**: Gabungan komposisi di atas 100% merusak laporan, sedangkan input luas terpakai terpisah dapat bertentangan dengan komposisi.

**Independent Test**: Nilai batas 100% diterima, sedangkan 100,01%, nilai negatif, atau luas lahan nol dengan komposisi positif ditolak.

**Acceptance Scenarios**:

1. **Given** total lima komposisi tepat 100%, **When** disimpan, **Then** data diterima.
2. **Given** total lima komposisi di atas 100%, **When** disimpan, **Then** data ditolak dengan pesan total aktual.
3. **Given** total komposisi kurang dari 100%, **When** disimpan, **Then** luas terpakai dan utilisasi mengikuti total komposisi tersebut.

### User Story 3 - Sinkron Google Sheet per edit (Priority: P2)

Setelah database tersimpan, pengguna melihat preview dan memilih apakah satu baris perubahan dikirim ke Google Sheet.

**Why this priority**: Sheet operasional harus mengikuti database tanpa menghapus prinsip review-first.

**Independent Test**: Simpan satu baris, setujui preview, lalu cocokkan nilai Sheet dengan detail aplikasi.

**Acceptance Scenarios**:

1. **Given** database berhasil menyimpan, **When** pengguna menyetujui preview Sheet, **Then** hanya baris terkait yang diperbarui.
2. **Given** pengguna membatalkan atau Sheet gagal, **When** alur selesai, **Then** database tetap tersimpan dan aplikasi memberi status parsial serta jalur retry.

### Edge Cases

- Luas lahan nol hanya menerima total komposisi nol.
- Input desimal dipertahankan tanpa pembulatan paksa.
- Total komposisi dengan selisih floating-point sangat kecil diperlakukan memakai toleransi enam desimal.
- Baris yang tidak ditemukan di Sheet ditampilkan sebagai calon insert dalam preview.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST menghitung utilisasi sebagai total lima komposisi, dengan hasil 0–100%.
- **FR-002**: Sistem MUST menghitung luas terpakai sebagai luas lahan dikali total komposisi, lalu menghitung luas sisa sebagai luas lahan dikurangi luas terpakai.
- **FR-003**: Sistem MUST membatasi setiap komposisi ke 0–100% dan gabungan lima komposisi maksimum 100%.
- **FR-004**: Sistem MUST menampilkan kelima komposisi dan totalnya setelah edit.
- **FR-005**: Sistem MUST menyimpan satu baris edit ke sumber data utama sebelum mengubah tampilan lokal atau mencatat audit sukses.
- **FR-006**: Sistem MUST mempertahankan form dan tidak memberi sukses palsu saat penyimpanan utama gagal.
- **FR-007**: Sistem MUST meminta konfirmasi berbasis preview sebelum menyinkronkan satu baris ke Sheet.
- **FR-008**: Sistem MUST mempertahankan data utama bila sinkron Sheet dibatalkan atau gagal, serta menyediakan retry melalui push manual.
- **FR-009**: Sistem MUST menolak nilai invalid pada batas data utama meski tidak berasal dari form aplikasi.
- **FR-010**: Form edit MUST tidak meminta luas terpakai sebagai input terpisah dan MUST menampilkan nilai turunannya secara langsung.

### Key Entities

- **Kapasitas Gudang**: Luas lahan, luas terpakai, luas sisa, utilisasi, status, lima komposisi, waktu pembaruan, dan identitas UPT/gudang/sub-gudang.
- **Salinan Sheet**: Representasi operasional satu baris kapasitas yang mengikuti data utama setelah konfirmasi pengguna.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% edit valid tetap terlihat setelah refresh.
- **SC-002**: 100% percobaan menyimpan total komposisi di atas 100% ditolak sebelum mengubah data.
- **SC-003**: Satu aksi sinkron per edit hanya menargetkan satu baris Sheet.
- **SC-004**: Kegagalan salah satu tujuan tidak pernah dilaporkan sebagai sukses penuh.

## Assumptions

- Database self-host adalah sumber kebenaran; Google Sheet adalah salinan operasional App→Sheet.
- Total komposisi kurang dari 100% valid dan menjadi nilai utilisasi record yang disimpan melalui form edit.
- Record lama yang belum konsisten tidak dinormalisasi massal; record menjadi canonical ketika disimpan ulang melalui form edit.
- Role dan RLS existing tidak berubah.
- Sinkron Sheet memakai integrasi yang sudah deployed.
