# Tasks: Perbaikan Edit dan Sinkron Kapasitas Gudang

**Input**: Design documents from `/specs/004-capacity-edit-sync/`

## Phase 1: Foundational

- [X] T001 [P] Tambah unit test rumus dan batas komposisi di tests/unit/warehouseCapacity.test.mjs
- [X] T002 [P] Tambah migration dan rollback constraint di supabase/migrations/20260915b_warehouse_capacity_bounds.sql
- [X] T003 Implementasikan helper rumus/validasi murni di src/lib/warehouseCapacity.mjs

## Phase 2: User Story 1 — Edit tersimpan dan terlihat

- [X] T004 [US1] Tambah upsert-only satu/sekumpulan baris di src/lib/masterSync.js
- [X] T005 [US1] Ubah callback save menjadi DB-first boolean dan audit setelah sukses di App.jsx
- [X] T006 [US1] Await save, pertahankan modal saat gagal, tampilkan semua komposisi dan total di src/components/KapasitasGudangTab.jsx

## Phase 3: User Story 2 — Validasi persentase

- [X] T007 [US2] Terapkan validasi luas, desimal, individual, dan total komposisi di src/components/KapasitasGudangTab.jsx
- [X] T008 [US2] Verifikasi migration terhadap data production dan apply atomic ke self-host

## Phase 4: User Story 3 — Sinkron Sheet per edit

- [X] T009 [US3] Reuse preview/confirm push-kapasitas untuk satu baris setelah DB sukses di src/components/KapasitasGudangTab.jsx
- [X] T010 [US3] Tambah contract assertion save satu baris dan partial failure di tests/unit/warehouseCapacity.test.mjs

## Phase 5: Verification

- [X] T011 Jalankan unit test, mapping self-check, npm test, build, dan git diff check
- [X] T012 Jalankan graphify update . dan smoke test aman tanpa menulis baris produksi spekulatif
- [X] T013 Revisi helper dan modal agar luas terpakai otomatis berasal dari total komposisi
- [X] T014 Tambah regression test untuk rumus otomatis, batas lahan nol, dan penghapusan input luas terpakai

## Dependencies & Execution Order

T001 dan T002 dapat paralel. T003 mendahului T007. T004 mendahului T005, lalu T006/T007/T009. T008 setelah test migration. T010–T012 terakhir.

## Implementation Strategy

Tulis test terlebih dahulu, implementasi diff minimum, apply constraint setelah preflight, lalu verifikasi. Tidak commit atau push tanpa izin terpisah.
