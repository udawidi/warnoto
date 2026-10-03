# Feature Specification: Foto Stock Opname pada Data Stok

**Feature Branch**: `main`
**Status**: Approved for implementation

## User Scenarios & Testing

### User Story 1 - Promosi foto sesi selesai (Priority: P1)

Sebagai Asman, saya ingin foto pada sesi `SELESAI` menjadi foto utama stok UPT yang sama, agar Data Stok memakai kondisi lapangan terbaru tanpa mengubah qty.

**Test**: approval UPT-A dengan katalog yang juga ada di UPT-B hanya mengubah stok UPT-A; retry tidak menambah history.

### User Story 2 - Riwayat foto yang dapat ditelusuri (Priority: P1)

Sebagai pengguna Data Stok, saya ingin membuka switch `Opname` dan melihat foto lama serta foto tiap sesi, agar audit visual tidak hilang.

**Test**: tab default tidak mount history; sesi terbaru terbuka; sesi lain baru merender gambar saat dibuka.

### User Story 3 - Pencarian visual/OCR aman UPT (Priority: P1)

Sebagai pengguna UPT, saya ingin pencarian hanya mengembalikan pasangan `(uptId, katalog)` yang boleh saya akses, termasuk OCR historis, agar katalog yang sama dari UPT lain tidak muncul.

**Test**: hasil visual dan OCR dipisahkan per UPT; query history hanya terjadi setelah pencarian.

## Requirements

- Foto wajib terisolasi oleh `uptId`; katalog sama antar-UPT tidak boleh tercampur.
- Approval Asman sesi `SELESAI` hanya mempromosikan foto item ke stok pada UPT yang sama; qty aktif tidak berubah.
- Foto utama sebelumnya diarsipkan pada `photoHistory`; objek Storage tidak dihapus.
- Penggantian foto manual juga mengarsipkan foto sebelumnya.
- Modal Data Stok memiliki switch `Detail | Riwayat | Opname`, default `Detail`.
- Tab `Opname` hanya mount saat dipilih, memuat maksimal 10 sesi awal, foto lazy, dan memakai lightbox existing.
- Draft/Pending/Ditolak dapat dilihat sebagai history, bukan foto utama atau sumber AI.
- Visual search dan OCR memakai pasangan `(uptId, katalog)`, bukan katalog saja.
- Upload tanpa UPT gagal; path memakai namespace UPT dan upload `upsert:false`.
- Migration database dan backfill production adalah proposal; tidak dijalankan otomatis.

## Acceptance Criteria

- Approval UPT-A tidak mengubah foto stok UPT-B walau katalog sama.
- Retry approval tidak menggandakan history.
- Foto lama dan semua foto opname tetap dapat dibuka.
- Bootstrap web tidak mengambil atau merender foto history.
- Scoped RPC mengembalikan `upt_id`, `katalog`, dan `similarity`.
- Build, unit test, dan `git diff --check` lulus.

## Success Criteria

- Tidak ada upload foto tanpa `uptId`, dan tidak ada operasi `upsert` pada upload foto.
- Tidak ada `<img>` foto history yang ter-mount saat bootstrap atau pada sesi collapsed.
- Setiap history entry hanya menyimpan foto `before`; foto baru tetap berasal dari `stock_opname.data.items`.
- Embedding current dan opname `SELESAI` memiliki `upt_id`; RPC scoped mengelompokkan hasil per UPT+katalog.
- Migration/backfill production tetap gated dan tidak dijalankan pada implementasi ini.
