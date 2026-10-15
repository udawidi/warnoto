# Tasks: Penyimpanan Foto Data Stok Aman

**Input**: Design documents from `specs/034-stock-photo-rpc/`

## Phase 1: Foundational

- [x] T001 [US1] Tambah contract test migration dan frontend di `tests/unit/stockPhotoRpc.contract.test.mjs`, termasuk snapshot URL dua foto dan deteksi perubahan non-foto
- [x] T002 [US1] Tambah rehearsal PostgreSQL role/scope/preservation di `scripts/rehearse_stock_photo_rpc.mjs`

## Phase 2: User Story 1 - Perbarui foto stok (P1)

**Independent Test**: Foto stok TUG-3 tersimpan setelah refresh tanpa perubahan field terlindungi.

- [x] T003 [US1] Implementasikan RPC foto di `supabase/migrations/20261015_stock_photo_rpc.sql`
- [x] T004 [US1] Mirror kontrak RPC foto ke `supabase/schema.sql`
- [x] T005 [US1] Ganti jalur detail dan edit foto memakai RPC di `App.jsx`

## Phase 3: User Story 2 - OCR konsisten (P2)

**Independent Test**: OCR hanya tersimpan bila URL nameplate masih sama.

- [x] T006 [US2] Implementasikan RPC OCR di migration dan `supabase/schema.sql`
- [x] T007 [US2] Ganti jalur OCR langsung dan auto-OCR memakai RPC di `App.jsx`

## Phase 4: Verification

- [x] T008 Jalankan rehearsal PostgreSQL dan unit test terkait (lulus)
- [x] T009 Jalankan seluruh test, build, dan `git diff --check`

## Dependencies & Execution Order

- T001-T002 mendefinisikan test sebelum implementasi.
- T003-T004 mendahului T005.
- T006 mendahului T007.
- T008-T009 dijalankan setelah seluruh implementasi.

## Implementation Strategy

Implementasikan kontrak database dahulu, lalu integrasi frontend, lalu verifikasi penuh. Migration production tidak diterapkan tanpa persetujuan eksplisit pengguna.
