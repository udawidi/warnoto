# Feature Specification: Output Resmi Stock Opname

**Feature Branch**: `007-stock-opname-official-output`
**Created**: 2026-09-16
**Status**: Approved
**Input**: Paket cetak resmi BA dan TUG15 berdasarkan contoh dokumen pengguna.

## User Scenarios & Testing

### User Story 1 - Cetak paket resmi (Priority: P1)

Petugas mencetak satu paket A4 portrait dari sesi SAP selesai: BA, TUG15 SAP, dan TUG15 Non-SAP bila sesi turunannya sudah selesai.

**Independent Test**: Selesaikan sesi SAP lalu cetak; keluaran memiliki satu dokumen HTML dengan BA dan TUG15 SAP.

**Acceptance Scenarios**:

1. **Given** sesi SAP selesai dan identitas UPT valid, **When** metadata dokumen disimpan dan dicetak, **Then** keluaran berisi BA dan TUG15 SAP dalam satu dokumen A4 portrait.
2. **Given** child Non-SAP selesai, **When** paket dicetak, **Then** TUG15 Non-SAP ikut dicetak setelah bagian SAP.
3. **Given** child Non-SAP belum ada atau belum selesai, **When** dialog dibuka, **Then** pengguna melihat peringatan dan tetap dapat mencetak paket SAP tanpa draft child.

### User Story 2 - Identitas penandatangan valid (Priority: P1)

Petugas memakai UPT sesi, Manager UPT, dan maksimal tiga pemeriksa yang dapat dipilih dari profil UPT atau diisi manual.

**Independent Test**: Buka dialog pada sesi valid; Manager terisi otomatis dan pemeriksa default adalah pembuat, TL, dan Asman tanpa duplikat.

**Acceptance Scenarios**:

1. **Given** tepat satu Manager pada UPT, **When** dialog dibuka, **Then** Manager tampil read-only dan tersimpan sebagai snapshot.
2. **Given** UPT legacy bertentangan atau Manager kosong/ganda, **When** dialog dibuka, **Then** cetak diblokir dengan alasan yang jelas.
3. **Given** profil pemeriksa tidak tersedia, **When** nama dan jabatan manual diisi, **Then** data manual dapat disimpan dan dicetak.

### User Story 3 - Metadata konsisten lintas perangkat (Priority: P2)

Metadata BA yang disimpan pada sesi dapat dibuka kembali dari perangkat lain tanpa mengandalkan localStorage.

**Independent Test**: Simpan metadata, muat ulang data opname, lalu buka dialog; tanggal, PID, pemeriksa, dan Manager sama.

**Acceptance Scenarios**:

1. **Given** metadata sudah pernah disimpan, **When** dialog dibuka kembali, **Then** form memakai snapshot pada opname.
2. **Given** penyimpanan gagal, **When** pengguna menekan Cetak, **Then** dokumen tidak dicetak dan metadata lama tidak dianggap berhasil diperbarui.

### Edge Cases

- Sesi legacy tanpa UPT memakai urutan `opn.uptId`, `gudang.uptId`, lalu `creator.uptId`; kandidat yang berbeda dianggap konflik.
- Manager dicari dengan role `MANAGER` pada UPT yang sama; nol atau lebih dari satu hasil memblokir cetak.
- Pemeriksa duplikat dihapus berdasarkan user ID atau identitas nama/jabatan.
- PID dapat dipisah koma, titik koma, atau baris baru; parser Excel belum termasuk scope.
- Child Non-SAP harus memiliki `sourceSapOpnameId` yang cocok dan status `SELESAI`.

## Requirements

### Functional Requirements

- **FR-001**: Sesi Stock Opname baru MUST menyimpan `uptId`; child Non-SAP MUST mewarisi UPT parent.
- **FR-002**: Sistem MUST menentukan UPT legacy dari tiga sumber dan MUST memblokir konflik.
- **FR-003**: Sistem MUST memilih tepat satu Manager UPT secara otomatis dan MUST memblokir hasil nol/ganda.
- **FR-004**: Sistem MUST menyediakan maksimal tiga pemeriksa dengan default pembuat, TL, dan Asman se-UPT tanpa duplikat, serta input manual sebagai fallback.
- **FR-005**: Sistem MUST menyimpan `documentMeta` versi 1 pada JSON opname sebelum mencetak.
- **FR-006**: Sistem MUST membuat satu dokumen HTML A4 portrait yang berisi BA dan TUG15 SAP.
- **FR-007**: Sistem MUST menambahkan TUG15 Non-SAP hanya jika child terkait selesai.
- **FR-008**: Sistem MUST memperingatkan child Non-SAP yang belum selesai tanpa memblokir paket SAP.
- **FR-009**: Tombol paket resmi MUST hanya tersedia pada parent SAP berstatus `SELESAI`.
- **FR-010**: Implementasi MUST mempertahankan builder lama, tidak menambah dependensi, dan tidak mengubah skema database.
- **FR-011**: Laporan akuntansi contoh poin 1 dan parser PID Excel MUST tetap di luar scope.

### Key Entities

- **DocumentMeta**: Versi, tanggal, referensi PID, snapshot pemeriksa, snapshot Manager, waktu simpan, dan penyimpan.
- **DocumentIdentity**: UPT hasil resolusi, status konflik, Manager tunggal, serta kandidat pemeriksa se-UPT.
- **DocumentPackage**: Satu HTML cetak berisi BA, TUG15 SAP, dan TUG15 Non-SAP opsional.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Paket hasil cetak memiliki tepat satu doctype dan satu pasangan elemen HTML/body.
- **SC-002**: Seluruh kombinasi resolusi UPT valid, konflik, Manager nol/satu/ganda, dan deduplikasi pemeriksa lulus unit test.
- **SC-003**: Metadata tersimpan dapat dimuat ulang tanpa localStorage.
- **SC-004**: Build produksi dan test Stock Opname lulus tanpa regresi alur SAP-first.

## Assumptions

- Profil tidak memiliki NIPEG; label dokumen dapat tetap `Nama / Nipeg`, tetapi nilai yang tersedia adalah nama.
- Sesi selesai bersifat read-only sehingga penyimpanan metadata tidak bersaing dengan edit hitungan aktif.
- Browser mengizinkan popup cetak yang dibuka langsung dari klik pengguna.
