# Tasks: TUG-10 Target Stok

## Phase 1: Contract and Tests

- [X] T001 [US1] Tambahkan contract test `stockHandling`, target stok, MERGE/SEPARATE, dan idempotensi di `tests/`
- [X] T002 [US1] Tambahkan skenario UI approval/form di `tests/e2e/desktop.spec.js`

## Phase 2: User Story 1

- [X] T003 [US1] Simpan, validasi, dan reset `stockHandling`/`targetStockId` melalui `src/components/TugFormModals.jsx` dan `src/hooks/useTugTransactions.js`
- [X] T004 [US1] Tampilkan pilihan Gabungkan/Pisah, target, dan status validasi konsisten melalui `src/components/ApprovalTab.jsx`
- [X] T005 [US1] Tambahkan migration delta RPC atomik MERGE/SEPARATE dan verifier di `supabase/migrations/` serta `supabase/verify_tug10_atomic_final_approval.sql`
- [X] T006 [US1] Sinkronkan definisi RPC ke `supabase/schema.sql`
- [X] T006a [US1] Pastikan lot SEPARATE memakai ID deterministik, `sourceLot`, `returnStatus`, mapping `jenisBarang`, dan `upt_id` fisik

## Phase 3: Validation

- [X] T007 Jalankan targeted unit/contract test dan build; Playwright hanya bila environment tersedia
- [ ] T008 Rehearse PostgreSQL dengan `ROLLBACK` dan verifikasi kasus dokumen 276
- [X] T009 Review diff, keamanan, dan scope; jangan apply production tanpa persetujuan

## Required contract scenarios

- MERGE 3 + 3 menjadi 6 pada target yang sama.
- SEPARATE membuat lot baru dan retry tidak menggandakan qty.
- Legacy no handling: target, satu kandidat, nol kandidat, dan kandidat ambigu.
- Target mismatch/not found gagal atomic.

## Dependencies

T001-T002 mendahului T003-T006. T007-T009 dilakukan setelah implementasi selesai.
