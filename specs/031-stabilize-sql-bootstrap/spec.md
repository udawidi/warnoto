# Feature Specification: Stabilize SQL Bootstrap

**Feature Branch**: `main`
**Created**: 2026-10-12
**Status**: Approved for implementation
**Input**: Stabilkan dan amankan pengelolaan `schema.sql` tanpa mengubah perilaku database produksi.

## User Scenarios & Testing

### User Story 1 - Bootstrap Aman (Priority: P1)

Operator dapat menjalankan bootstrap pada database kosong tanpa bergantung pada baris data produksi tertentu.

**Why this priority**: Ketergantungan pada data produksi membuat pemulihan database baru gagal.

**Independent Test**: Jalankan schema pada PostgreSQL kosong dua kali; kedua proses selesai tanpa error.

**Acceptance Scenarios**:

1. **Given** database kosong, **When** bootstrap dijalankan, **Then** seluruh objek final terbentuk tanpa membutuhkan data bisnis.
2. **Given** bootstrap sudah pernah dijalankan, **When** dijalankan ulang, **Then** proses tetap selesai tanpa merusak objek atau data.

### User Story 2 - Definisi Final Tunggal (Priority: P2)

Pengembang dapat meninjau satu definisi final untuk setiap fungsi penting di snapshot bootstrap.

**Why this priority**: Definisi ganda menyulitkan audit dan dapat menghidupkan kembali kontrak lama.

**Independent Test**: Pemeriksa statis memastikan fungsi yang diaudit hanya memiliki satu definisi final.

**Acceptance Scenarios**:

1. **Given** snapshot bootstrap, **When** objek final dihitung, **Then** tidak ada nama fungsi audit yang didefinisikan ulang.

### Edge Cases

- Migration data-repair tetap harus dapat dijalankan idempoten pada produksi.
- Bootstrap tidak boleh mencoba menerapkan ulang data-repair historis.
- Pembersihan definisi ganda tidak boleh mengubah signature, grant, atau perilaku fungsi final.

## Requirements

### Functional Requirements

- **FR-001**: `supabase/migrations/` MUST tetap menjadi histori perubahan production.
- **FR-002**: `supabase/schema.sql` MUST hanya berisi bootstrap schema/objek final, bukan data repair production-specific.
- **FR-003**: Bootstrap MUST dapat dijalankan dua kali pada database kosong.
- **FR-004**: Fungsi kritis yang diaudit MUST memiliki satu definisi final di snapshot.
- **FR-005**: Verifier MUST gagal bila data repair production-specific masuk lagi ke snapshot.
- **FR-006**: Refactor MUST tidak menerapkan DDL atau mutasi data baru ke production.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Bootstrap kosong lulus dua kali berturut-turut.
- **SC-002**: Nol blok data-repair production-specific di snapshot.
- **SC-003**: Nol nama fungsi kritis terduplikasi.
- **SC-004**: Seluruh test repository dan build tetap lulus.

## Assumptions

- Migration production yang sudah diterapkan tidak diubah.
- Snapshot tetap satu file untuk kompatibilitas workflow dan test saat ini.
- Pemecahan file per domain dan generator otomatis ditunda sampai rehearsal bootstrap stabil.
