# Tasks: Pengembalian Alat Berat

**Input**: Design documents in `specs/011-heavy-equipment-return/`

**Tests**: Wajib karena perubahan otorisasi dan transaksi lintas tabel.

## Phase 1: Setup

- [X] T001 Validasi baseline dan status worktree di repository root

## Phase 2: Foundational

- [X] T002 [P] Tambahkan unit/contract test izin dan kontrak RPC di `tests/unit/heavyEquipmentReturn.test.mjs`
- [X] T003 [P] Tambahkan skenario CTA owner/non-owner di `tests/e2e/heavy-equipment.spec.js`

## Phase 3: User Story 1 - Pengembalian Owner (P1)

**Goal**: ADMIN/TL pemilik menyelesaikan loan dari kartu alat dengan transaksi atomik.

**Independent Test**: CTA terlihat, checklist wajib, respons sukses menghasilkan loan selesai dan alat tersedia setelah refresh.

- [X] T004 [US1] Tambahkan helper izin owner pada `src/lib/heavyEquipment.js`
- [X] T005 [US1] Buat RPC atomik pada `supabase/migrations/20260919_heavy_equipment_loan_return_rpc.sql`
- [X] T006 [US1] Ganti handler client menjadi RPC server-first pada `src/hooks/useHeavyEquipment.js`
- [X] T007 [US1] Tampilkan CTA dan pertahankan modal saat gagal pada `src/components/HeavyEquipmentTabV2.jsx`

## Phase 4: User Story 2 - Penolakan Akses (P2)

**Goal**: Peminjam dan role selain ADMIN/TL owner tidak dapat menyelesaikan loan.

**Independent Test**: CTA tidak ada dan RPC menolak tanpa perubahan row.

- [X] T008 [US2] Verifikasi negative authorization dan rollback migration melalui `tests/unit/heavyEquipmentReturn.test.mjs` dan SQL transaction smoke

## Phase 5: Polish & Validation

- [X] T009 Jalankan targeted tests, full tests, build, diff-check, graphify, dan localhost smoke sesuai `specs/011-heavy-equipment-return/quickstart.md`

## Dependencies & Execution Order

- T001 lebih dulu.
- T002 dan T003 dapat paralel.
- T004 → T005 → T006 → T007 berurutan.
- T008 setelah RPC dan helper selesai.
- T009 terakhir.

## Implementation Strategy

Satu increment: test kontrak terlebih dahulu, implement helper/RPC/handler/UI, lalu verifikasi penuh. Migration production tidak diterapkan tanpa persetujuan user terpisah.
