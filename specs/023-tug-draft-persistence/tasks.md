# Tasks: Persistensi Draft Seluruh TUG

## Phase 1: Setup

- [X] T001 Tambah kontrak test awal untuk durability, nomor, scope, dan konflik di `tests/unit/tugWorkflowPersistence.contract.test.mjs`

## Phase 2: Foundational

- [X] T002 Buat migration, RPC versioned, RLS, rollback, dan verifier di `supabase/migrations/20260923_tug_workflow_persistence.sql`, `supabase/migrations/20260923_tug_workflow_persistence.rollback.sql`, dan `supabase/verify_tug_workflow_persistence.sql`
- [X] T003 Mirror tabel dan policy bootstrap di `supabase/schema.sql`
- [X] T004 Implement load/save/delete/version conflict client di `src/lib/tugWorkflowSync.js`

## Phase 3: User Story 1 - Draft lintas perangkat

- [X] T005 [US1] Muat workflow server paralel dan merge server-wins dengan cache lama di `App.jsx`
- [X] T006 [US1] Jadikan draft TUG-3 database-first dan terbitkan nomor saat Ajukan di `src/hooks/useTugTransactions.js` dan `src/lib/tug3Sync.js`
- [X] T007 [US1] Pertahankan DB-first TUG-10 dan pindahkan penerbitan nomor ke Ajukan di `src/hooks/useTugTransactions.js` dan `src/lib/tug10Sync.js`
- [X] T008 [US1] Simpan/update/hapus draft TUG-8/9 melalui workflow server di `src/hooks/useTugTransactions.js` dan `src/hooks/useTugApprovals.js`
- [X] T009 [US1] Tambah aksi Simpan Draft TUG-5 di `src/components/TugFormModals.jsx` dan `src/hooks/useTugTransactions.js`

## Phase 4: User Story 2 - Workflow durable

- [X] T010 [US2] Persist seluruh transisi TUG-5/TUG-7 dan pembuatan draft turunan ke workflow server di `src/hooks/useTugApprovals.js`
- [X] T011 [US2] Hapus draft workflow hanya setelah promosi canonical TUG-8/9 berhasil di `src/hooks/useTugApprovals.js`
- [X] T012 [US2] Pertahankan referensi induk-anak saat ID draft dipromosikan di `src/hooks/useTugTransactions.js` dan `src/hooks/useTugApprovals.js`

## Phase 5: User Story 3 - Konflik dan scope

- [X] T013 [US3] Tampilkan konflik versi sebagai kegagalan jelas tanpa overwrite di `src/lib/tugWorkflowSync.js` dan `src/hooks/useTugTransactions.js`
- [X] T014 [US3] Tambah test scope UPT/UIT, version conflict, server-wins, dan retry promotion di `tests/unit/tugWorkflowPersistence.contract.test.mjs`

## Phase 6: Polish & Validation

- [X] T015 Jalankan verifier SQL runtime dalam transaksi rollback dan dokumentasikan hasil di `specs/023-tug-draft-persistence/quickstart.md`
- [X] T016 Jalankan full unit test, build, dan diff-check lalu centang seluruh task di `specs/023-tug-draft-persistence/tasks.md`

## Dependencies

- T001 mendahului implementasi.
- T002-T004 foundational dan mendahului T005-T014.
- US1 mendahului US2; US3 memverifikasi keduanya.
- T015-T016 dilakukan terakhir.

## Parallel Opportunities

- T003 dapat berjalan paralel dengan T004 setelah kontrak T002 stabil.
- T006 dan T007 menyentuh area hook sama sehingga tetap berurutan.
- T014 dapat disiapkan paralel dengan T010-T012 setelah T002-T004 selesai.

## Independent Test Criteria

- **US1**: enam tipe draft muncul setelah refresh dan pada perangkat kedua tanpa nomor/stok berubah.
- **US2**: rantai TUG-5→TUG-7→TUG-8 serta TUG-5 ULTG→TUG-9 bertahan lintas perangkat.
- **US3**: edit versi lama dan akses lintas scope ditolak tanpa kehilangan data terbaru.

## MVP

US1 adalah minimum, tetapi rilis production wajib menyelesaikan US2/US3 karena workflow dan isolasi data tidak boleh setengah jalan.
