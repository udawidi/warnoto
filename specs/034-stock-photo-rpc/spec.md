# Feature Specification: Penyimpanan Foto Data Stok Aman

**Feature Branch**: `main`
**Created**: 2026-10-15
**Status**: Approved
**Input**: Update foto nameplate Data Stok gagal dengan `TUG3_STOCK_RPC_REQUIRED`.

## User Scenarios & Testing

### User Story 1 - Perbarui foto stok (Priority: P1)

ADMIN atau TL memperbarui Foto Nameplate atau Foto Keseluruhan tanpa mengubah identitas, jumlah, atau sumber stok.

**Why this priority**: Jalur aktif gagal pada stok hasil TUG-3.

**Independent Test**: Ganti foto pada stok TUG-3, refresh, lalu pastikan foto baru tampil dan qty/sumber tetap.

**Acceptance Scenarios**:

1. **Given** stok TUG-3 dalam scope pengguna, **When** foto valid disimpan, **Then** foto berubah dan field stok lain tetap.
2. **Given** foto lama tersedia, **When** diganti, **Then** foto lama tercatat dalam riwayat.
3. **Given** pengguna di luar scope atau tanpa role yang benar, **When** menyimpan foto, **Then** perubahan ditolak.

### User Story 2 - OCR nameplate konsisten (Priority: P2)

Setelah foto nameplate berubah, OCR hanya disimpan bila masih merujuk foto yang sama.

**Why this priority**: OCR latar belakang juga memakai full-row upsert dan dapat memicu guard yang sama.

**Independent Test**: Ganti nameplate saat OCR berjalan; hasil OCR foto lama tidak boleh menimpa foto baru.

**Acceptance Scenarios**:

1. **Given** URL nameplate belum berubah, **When** OCR selesai, **Then** teks tersimpan.
2. **Given** URL nameplate sudah berubah, **When** OCR lama selesai, **Then** hasil diabaikan.

### Edge Cases

- URL bukan object nyata di bucket `stock-photos` ditolak.
- Field selain dua foto stok ditolak.
- Foto yang sama tidak membuat entri riwayat baru.
- Kegagalan database tidak membuang foto pending dari UI.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST memperbarui hanya field foto yang diminta pada row stok server terbaru.
- **FR-002**: Sistem MUST mempertahankan qty, sumber lot, marker TUG-3, katalog, lokasi, dan scope UPT.
- **FR-003**: Sistem MUST membatasi perubahan foto manual kepada ADMIN, TL, dan SUPERADMIN dalam scope UPT.
- **FR-004**: Sistem MUST memvalidasi URL dan keberadaan object foto sebelum menyimpan referensi.
- **FR-005**: Sistem MUST mencatat foto lama dalam `photoHistory` saat foto benar-benar berubah.
- **FR-006**: Sistem MUST mereset OCR ketika nameplate berubah dan mencegah hasil OCR stale.
- **FR-007**: Guard `TUG3_STOCK_RPC_REQUIRED` MUST tetap aktif untuk full-row write yang mengubah field terlindungi.
- **FR-008**: UI MUST mempertahankan foto pending ketika penyimpanan gagal dan menampilkan pesan yang dapat ditindaklanjuti.

### Key Entities

- **Stock**: Row Data Stok beserta foto, riwayat foto, UPT, qty, dan sumber lot.
- **Photo history entry**: Snapshot foto sebelumnya beserta sumber, waktu, stock ID, dan UPT.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Kedua jenis foto dapat disimpan pada stok TUG-3 dan tetap tampil setelah refresh.
- **SC-002**: Verifikasi sebelum/sesudah menunjukkan nol perubahan pada field stok terlindungi.
- **SC-003**: Semua skenario role, scope, URL palsu, dan OCR stale ditolak atau diabaikan sesuai kontrak.
- **SC-004**: Full-row write TUG-3 yang tidak sah tetap menghasilkan `TUG3_STOCK_RPC_REQUIRED`.

## Assumptions

- Bucket `stock-photos`, helper validasi URL, dan policy upload existing tetap dipakai.
- Object yatim dari percobaan lama tidak dihapus otomatis.
- Tidak ada perubahan dependency.
