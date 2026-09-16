# Tasks: Output Resmi Stock Opname

## Phase 1: Identity foundation

- [X] T001 [US2] Tambah unit test resolusi UPT, Manager, pemeriksa default, deduplikasi, dan child Non-SAP di `tests/unit/stockOpnameFlow.test.mjs`.
- [X] T002 [US2] Implementasikan pure helper identitas dokumen di `src/lib/stockOpnameFlow.js`.

## Phase 2: Durable UPT and metadata

- [X] T003 [US3] Stamp `uptId` pada sesi baru/child dan utamakan scope record pada `src/components/StockOpnameTab.jsx` serta `App.jsx`.
- [X] T004 [US3] Ganti form cetak agar memakai snapshot `documentMeta`, picker profil, fallback manual, validasi, dan penyimpanan sebelum cetak di `src/components/StockOpnameTab.jsx`.

## Phase 3: Official package

- [X] T005 [US1] Tambah test integritas single-document serta kombinasi SAP-only/SAP+Non-SAP di `tests/unit/stockOpnameDocumentPackage.test.mjs`.
- [X] T006 [US1] Implementasikan `buildStockOpnamePackageHTML` A4 portrait dengan BA, TUG15 SAP, dan TUG15 Non-SAP opsional di `src/lib/docBuilders.js`.
- [X] T007 [US1] Batasi tombol pada parent SAP selesai dan tampilkan warning child yang belum selesai di `src/components/StockOpnameTab.jsx`.

## Phase 4: Validation

- [X] T008 Jalankan unit test terkait, build produksi, smoke Stock Opname, pemeriksaan diff, dan `graphify update .`.

## Dependencies & Execution Order

- T001 harus gagal sebelum T002 diimplementasikan.
- T003 selesai sebelum T004 agar metadata selalu memiliki UPT.
- T005 harus gagal sebelum T006 diimplementasikan.
- T004, T006, dan T007 berurutan karena menyentuh alur cetak yang sama.
- T008 setelah seluruh implementasi selesai.
