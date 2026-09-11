# Feature Specification: Riwayat Sumber Kontrak TUG-8/9

**Feature Branch**: `main`

**Created**: 2026-09-11

**Status**: Approved for implementation

**Input**: Setiap material pada transaksi TUG-8/TUG-9 harus menunjukkan riwayat sumber kontrak atau asal stok yang dapat dipertanggungjawabkan.

## User Scenarios & Testing

### User Story 1 - Melihat sumber setiap material keluar (Priority: P1)

Petugas melihat riwayat atau antrean TUG-8/TUG-9 dan dapat mengetahui seluruh kontrak penerimaan yang terkait dengan setiap material.

**Why this priority**: Informasi asal material dibutuhkan untuk audit dan penelusuran pengadaan.

**Independent Test**: Buka TUG-9 nomor 250 dan pastikan keempat material menampilkan sumbernya.

**Acceptance Scenarios**:

1. **Given** material memiliki satu atau lebih penerimaan TUG-3, **When** item TUG-8/TUG-9 ditampilkan, **Then** seluruh kontrak yang sudah ada saat transaksi dibuat tampil dari terbaru ke terlama.
2. **Given** material tidak memiliki penerimaan kontrak TUG-3, **When** item ditampilkan, **Then** asalnya tampil sebagai Migrasi SAP, Retur TUG-10, atau Stok awal tanpa kontrak.

---

### User Story 2 - Riwayat lama ikut lengkap (Priority: P2)

Petugas dapat menelusuri sumber pada transaksi TUG-8/TUG-9 lama, bukan hanya transaksi baru.

**Why this priority**: Data historis tetap digunakan dalam audit gudang.

**Independent Test**: Semua item TUG-8/TUG-9 lama memiliki snapshot sumber dan transaksi 250 menampilkan sumber yang benar.

**Acceptance Scenarios**:

1. **Given** transaksi lama dibuat sebelum fitur tersedia, **When** backfill selesai, **Then** sumber dihitung dari data resmi tanpa mengubah qty, dokumen, hash, atau approval.
2. **Given** kontrak diterima setelah transaksi lama dibuat, **When** backfill menghitung sumber, **Then** kontrak masa depan tidak dimasukkan.

### Edge Cases

- Satu stok memiliki beberapa kontrak penerimaan.
- Referensi kontrak yang sama tersimpan lebih dari sekali.
- Stok berasal dari migrasi SAP, retur TUG-10, atau sumber awal yang tidak memiliki kontrak.
- Payload client membawa metadata kontrak yang berbeda dari data stok server.
- TUG-8/TUG-9 diubah saat masih menunggu approval.

## Requirements

### Functional Requirements

- **FR-001**: Setiap item TUG-8/TUG-9 MUST memiliki snapshot sumber yang diambil dari data stok resmi.
- **FR-002**: Snapshot sumber MUST menyimpan seluruh kontrak terkait, diurutkan terbaru ke terlama dan dideduplikasi.
- **FR-003**: Sumber tanpa kontrak MUST diklasifikasikan sebagai Migrasi SAP, Retur TUG-10, atau Stok awal.
- **FR-004**: Client MUST NOT dapat menentukan atau memalsukan snapshot sumber.
- **FR-005**: Riwayat lama MUST dibackfill tanpa mengubah snapshot dokumen resmi, hash, approval, qty, atau mutasi stok.
- **FR-006**: Backfill MUST mengecualikan kontrak dengan waktu penerimaan setelah waktu transaksi.
- **FR-007**: Picker menggunakan sumber stok hidup; antrean dan riwayat transaksi menggunakan snapshot immutable.
- **FR-008**: Informasi sumber MUST dijelaskan sebagai riwayat stok, bukan alokasi FIFO atau batch fisik.

### Key Entities

- **Item TUG**: Baris material keluar yang memiliki referensi stok dan snapshot sumber informatif.
- **Snapshot sumber**: Klasifikasi asal, daftar kontrak, dan provenance pencatatan.
- **Referensi kontrak**: Supplier, kontrak/pekerjaan, nomor TUG-3, tanggal masuk, SP, dan amandemen.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% item TUG-8/TUG-9 memiliki snapshot sumber setelah migrasi.
- **SC-002**: Keempat item TUG-9 nomor 250 menampilkan sumber yang benar.
- **SC-003**: Tidak ada perubahan pada hash dokumen, qty stok, mutasi stok, atau approval selama backfill.
- **SC-004**: Semua test canonical, sumber, dan build lulus.

## Assumptions

- Riwayat kontrak bersifat informatif dan tidak menerapkan FIFO/batch.
- PDF resmi tidak berubah; cakupan UI adalah picker, approval, dan riwayat transaksi.
- Tidak ada dependensi baru.
- Migrasi production dijalankan hanya setelah verifikasi backup dan dry-run.
