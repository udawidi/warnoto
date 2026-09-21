# Feature Specification: Label Material Barcode Blok

**Feature Branch**: `018-barcode-block-material-labels`

**Created**: 2026-09-21

**Status**: In Progress

**Input**: User description: "Pada Master Data > Master Gudang > Barcode Blok Gudang, tambahkan keterangan status SAP/Non-SAP dan jenis material pada daftar material blok."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identifikasi Material dari Barcode Blok (Priority: P1)

Pengguna memindai barcode blok gudang dan dapat langsung membedakan material SAP dengan Non-SAP serta melihat jenis material setiap baris tanpa membuka menu lain.

**Why this priority**: Status dan jenis material dibutuhkan untuk mengenali perlakuan material saat pemeriksaan fisik di area blok.

**Independent Test**: Pindai satu barcode blok yang berisi material SAP dan Non-SAP, lalu pastikan setiap baris menampilkan status serta jenis material yang sesuai master katalog.

**Acceptance Scenarios**:

1. **Given** satu blok memiliki material berkatalog SAP, **When** barcode blok dibuka, **Then** baris material menampilkan status "SAP" dan jenis material canonical.
2. **Given** satu blok memiliki material berkatalog Non-SAP, **When** barcode blok dibuka, **Then** baris material menampilkan status "Non-SAP" dan jenis material canonical.
3. **Given** data lama tidak memiliki status atau jenis material, **When** barcode blok dibuka, **Then** daftar tetap tampil dan nilai yang belum tersedia ditandai secara netral tanpa menebak.

### Edge Cases

- Satu blok tidak memiliki stok dengan kuantitas positif.
- Katalog lama tidak memiliki status atau jenis material.
- Nama atau satuan material kosong tetapi status dan jenis tersedia.
- Barcode dibuka sebagai pengguna publik tanpa sesi login.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Daftar material blok MUST menampilkan status SAP atau Non-SAP pada setiap baris ketika status dapat ditentukan dari data canonical.
- **FR-002**: Daftar material blok MUST menampilkan jenis material pada setiap baris ketika nilai tersedia.
- **FR-003**: Nilai status dan jenis material MUST memakai klasifikasi khusus baris stok bila tersedia, lalu fallback ke master katalog yang sama.
- **FR-004**: Sistem MUST mempertahankan akses baca publik dan tidak menambah kemampuan mengubah data.
- **FR-005**: Sistem MUST mempertahankan katalog, nama, satuan, kuantitas, urutan, serta identitas lokasi yang sudah ditampilkan.
- **FR-006**: Data legacy yang kosong MUST ditampilkan dengan penanda netral dan tidak boleh diklasifikasikan melalui tebakan.
- **FR-007**: Perubahan MUST tidak memutasi data stok, katalog, gudang, atau lokasi yang sudah ada.

### Key Entities

- **Material blok**: Material dengan kuantitas positif pada satu lokasi blok, berikut katalog, nama, satuan, kuantitas, status SAP, dan jenis material.
- **Master katalog**: Sumber canonical status SAP/Non-SAP dan jenis material untuk material blok.
- **Lokasi blok**: Identitas publik UPT, gudang, sub-gudang, dan blok yang dibaca melalui barcode.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% baris dengan master katalog lengkap menampilkan status SAP/Non-SAP dan jenis material yang cocok.
- **SC-002**: Barcode blok tetap dapat dibuka tanpa login dan seluruh material lama tetap terlihat.
- **SC-003**: Pengguna dapat membedakan status dan jenis material langsung dari satu layar tanpa navigasi tambahan.
- **SC-004**: Tidak ada perubahan nilai pada data stok, katalog, gudang, atau lokasi setelah fitur diterapkan.

## Assumptions

- Status SAP/Non-SAP dan jenis material mengikuti nilai canonical paling spesifik: baris stok, lalu master katalog.
- Label status memakai istilah yang sudah dipakai di menu Data Stok dan Stock Opname.
- Status kosong pada payload lama ditampilkan sebagai "Belum tersedia"; jenis material kosong memakai penanda netral "-".
- Tidak ada perubahan hak akses, alur bisnis, atau dependensi baru.
