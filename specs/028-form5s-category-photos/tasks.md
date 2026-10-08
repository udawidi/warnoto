# Tasks: Foto Kategori dan Cetak Form 5S

## Phase 1: Tests and contracts

- [x] T001 [P] Tambah kontrak batas 2 MiB, kategori, indeks 0–14, timeout, dan legacy di tests/unit/form5sSecurity.contract.test.mjs
- [x] T002 [P] Tambah migration guard Form 5S baru dan sinkronkan definisinya ke supabase/schema.sql

## Phase 2: User Story 1 — Foto lengkap per kategori

- [x] T003 [US1] Terapkan kompresi khusus Form 5S maksimal 2 MiB dan dimensi 2000 px di src/lib/maturityDrive.js
- [x] T004 [US1] Terapkan batas upload 2 MiB serta signing/download indeks 0–14 di supabase/functions/maturity-drive/index.ts
- [x] T005 [US1] Ubah uploader, draft, validasi final, dan metadata foto menjadi tiga foto per kategori di src/components/MaturityAuditSystem.jsx
- [x] T006 [US1] Pastikan serialisasi draft/final membuang preview lokal dan mempertahankan categoryId di src/lib/maturitySync.js
- [x] T007 [US1] Agregasikan evidence foto Form 5S menjadi satu referensi 4.5 di src/hooks/useMaturity.jsx

## Phase 3: User Story 2 — Cetak tidak terkunci

- [x] T008 [US2] Tambah timeout delapan detik saat membuka sumber foto dan fallback placeholder di src/components/MaturityAuditSystem.jsx
- [x] T009 [US2] Kelompokkan lampiran per kategori dan aktifkan cetak setelah timeout gambar delapan detik di src/lib/docBuilders.js

## Phase 4: User Story 3 — Kompatibilitas legacy

- [x] T010 [US3] Pertahankan history dan PDF record lama tanpa categoryId di src/components/MaturityAuditSystem.jsx dan src/lib/docBuilders.js

## Phase 5: Verification

- [x] T011 Jalankan test Form 5S, npm test, dan npm run build
- [x] T012 Audit diff, pastikan migration/deploy production belum dijalankan, lalu tandai seluruh task selesai

## Dependencies

- T001 dan T002 dapat berjalan paralel.
- T003–T007 mengikuti kontrak T001/T002.
- T008–T010 mengikuti bentuk data final dari T005.
- T011–T012 terakhir.

## Independent Test Criteria

- **US1:** Finalisasi hanya berhasil dengan lima kategori × tiga foto dan semua foto maksimal 2 MiB.
- **US2:** Cetak aktif maksimal 16 detik dengan placeholder untuk foto gagal.
- **US3:** Record legacy satu sampai tiga foto tetap terbaca dan tercetak.
