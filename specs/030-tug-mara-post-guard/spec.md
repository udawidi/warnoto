# Feature Specification: TUG MARA Posting Guard

**Feature Branch**: `main`
**Created**: 2026-10-12
**Status**: Approved
**Input**: Blokir posting material TUG 3&4 dan TUG 10 ke Data Stok bila nomor katalog tidak tersedia atau tidak sesuai dengan data MARA.

## User Scenarios & Testing

### User Story 1 - Posting material tervalidasi MARA (Priority: P1)

Sebagai approver final, saya hanya dapat memasukkan material TUG ke Data Stok bila setiap nomor katalog memiliki satu padanan MARA yang jelas.

**Why this priority**: Mencegah identitas material bebas atau salah masuk ke saldo resmi gudang.

**Independent Test**: Finalisasi satu TUG dengan kode valid dan satu TUG dengan kode tidak terdaftar; hanya transaksi valid yang boleh mengubah stok.

**Acceptance Scenarios**:

1. **Given** semua item memiliki padanan MARA unik, **When** TUG disetujui final, **Then** stok bertambah sekali dengan identitas material dari MARA.
2. **Given** satu item tidak memiliki padanan MARA, **When** TUG disetujui final, **Then** seluruh approval gagal tanpa perubahan stok, katalog, status, atau audit.
3. **Given** item berstatus Non-SAP atau ATTB, **When** nomor katalog tidak ada di MARA, **Then** item tetap ditolak.

### User Story 2 - Input barang baru diarahkan ke MARA (Priority: P2)

Sebagai pembuat TUG, saya memilih barang baru dari hasil pencarian MARA agar nama, nomor katalog, satuan, dan kategori tidak diketik bebas.

**Independent Test**: Buka form barang baru dan pastikan item hanya dapat dilengkapi melalui pilihan MARA.

**Acceptance Scenarios**:

1. **Given** hasil MARA dipilih, **When** item disimpan, **Then** identitas material terkunci dari hasil tersebut.
2. **Given** draft lama memakai identitas manual, **When** dibuka kembali, **Then** draft tetap terbaca tetapi harus dipetakan ke MARA sebelum final.

### Edge Cases

- Kode yang hanya berbeda leading zero dianggap sama.
- Nol atau lebih dari satu padanan MARA dianggap tidak valid.
- Nama atau satuan input yang berbeda tidak dipercaya; nilai MARA digunakan.
- Campuran item valid dan invalid gagal seluruhnya.
- Retry approval tidak boleh menggandakan stok.

## Requirements

### Functional Requirements

- **FR-001**: Semua item TUG 3&4 dan TUG 10, termasuk Non-SAP/ATTB, MUST memiliki padanan MARA unik sebelum posting final.
- **FR-002**: Pencocokan MUST mengabaikan leading zero setelah whitespace luar dibuang.
- **FR-003**: Nama, nomor katalog, satuan, dan kategori hasil posting MUST berasal dari MARA.
- **FR-004**: Approval final MUST atomik dan idempoten.
- **FR-005**: Draft dan pending lama MUST tetap dapat dibuka dan diperbaiki.
- **FR-006**: Transaksi historis approved MUST tidak dimutasi.
- **FR-007**: Barang baru MUST dipilih dari MARA; input manual dan pelepasan kunci tidak tersedia untuk pengajuan baru.
- **FR-008**: Penolakan MUST menyebut item dan alasan validasi tanpa menulis perubahan parsial.

### Key Entities

- **MARA Material**: Identitas material authoritative berupa kode, nama, satuan, dan kategori.
- **Master Katalog**: Identitas material aktif yang wajib ditautkan dan diselaraskan ke MARA.
- **TUG Receipt**: Dokumen penerimaan TUG 3&4 atau TUG 10 yang memuat item dan status approval.
- **Stock Row**: Saldo per katalog, lokasi, UPT, dan lot sumber.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% posting final TUG dengan satu item tanpa padanan MARA ditolak tanpa perubahan data.
- **SC-002**: 100% stok hasil TUG valid memakai identitas nama, katalog, dan satuan dari MARA.
- **SC-003**: Retry approval yang sama menghasilkan tepat satu penambahan saldo.
- **SC-004**: Draft lama tetap dapat dibuka dan diperbaiki tanpa kehilangan data transaksi.

## Assumptions

- `mara_catalog` tersedia pada production self-host dan menjadi sumber kebenaran tertinggi identitas material.
- Draft boleh tidak lengkap; enforcement mutlak terjadi saat approval final.
- Deployment database memerlukan persetujuan pengguna terpisah.
