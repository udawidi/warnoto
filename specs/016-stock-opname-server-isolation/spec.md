# Feature Specification: Isolasi Server Stock Opname per UPT

**Feature Branch**: `main`
**Created**: 2026-09-20
**Status**: Approved for implementation

## User Scenarios & Testing

### User Story 1 - Pengguna UPT Hanya Mengakses Data UPT Sendiri (P1)

Pengguna UPT membaca, membuat, mengubah, dan menghapus sesi Stock Opname/Stock Count hanya untuk `upt_id` miliknya.

**Independent Test**: Akun UPT Bali mendapat nol baris Surabaya dan insert berkode `UPT-SBY` ditolak oleh PostgreSQL RLS.

### User Story 2 - Pejabat Regional dan Nasional Tetap Bekerja (P1)

Tier UIT membaca UPT di UIT-nya. `SUPERADMIN` dan `ADMIN_LOG_PUSAT` tetap membaca seluruh UPT untuk monitoring dan approval.

**Independent Test**: Akun UPT Surabaya melihat data Surabaya; akun nasional melihat seluruh data.

### User Story 3 - Cache Browser Tidak Membocorkan UPT Lama (P1)

Saat browser pernah dipakai UPT lain atau server mengembalikan daftar kosong, aplikasi tidak menampilkan dan tidak mengunggah otomatis cache yang tidak terbukti satu scope.

**Independent Test**: Cache tanpa `uptId` diabaikan untuk akun scoped dan respons server kosong tetap dianggap canonical.

## Requirements

- **FR-001**: `stock_opname.upt_id` dan `stock_count.upt_id` MUST `NOT NULL`, ber-FK ke `upt(id)`, dan berindeks.
- **FR-002**: SELECT/INSERT/UPDATE/DELETE MUST dibatasi server dengan `can_access_upt(upt_id)` pada `USING` dan `WITH CHECK`.
- **FR-003**: Policy lama berbasis `auth.role()='authenticated'` MUST tidak ada.
- **FR-004**: Role `authenticated` MUST tidak memiliki hak `TRUNCATE`; role `anon` MUST tidak memiliki hak tabel.
- **FR-005**: `service_role` MUST tetap dapat melakukan administrasi dan backup.
- **FR-006**: Loader Stock Opname/Count MUST menambahkan filter `upt_id` ketika scope client diketahui, tanpa menggantikan RLS sebagai boundary keamanan.
- **FR-007**: Hasil server kosong MUST tidak memicu seed otomatis dari cache browser.
- **FR-008**: Cache user scoped MUST fail-closed untuk record tanpa `uptId` yang dapat diverifikasi.
- **FR-009**: Tier nasional dan UIT MUST mengikuti semantik `can_access_upt` existing.
- **FR-010**: Migration MUST idempotent, abort bila prasyarat typed scope tidak terpenuhi, dan diterapkan setelah backup.

## Success Criteria

- **SC-001**: Akun UPT-A membaca nol record UPT-B melalui query langsung sebagai role `authenticated`.
- **SC-002**: Cross-UPT insert/update ditolak RLS.
- **SC-003**: `has_table_privilege('authenticated', ..., 'TRUNCATE')` bernilai false untuk kedua tabel.
- **SC-004**: Semua unit test dan build lulus.
- **SC-005**: Tidak ada perubahan alur UI Stock Opname selain penguatan scope dan cache.

## Assumptions

- `can_access_upt(text)` dan hierarchy role existing adalah sumber kebenaran akses.
- Data production saat audit sudah memiliki `upt_id` valid; migration ini hardening, bukan backfill baru.
