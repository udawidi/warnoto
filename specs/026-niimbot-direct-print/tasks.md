# Tasks: Cetak Langsung NIIMBOT M2-H

**Input**: Design documents from `/specs/026-niimbot-direct-print/`

## Phase 1: Setup

- [X] T001 Tambahkan dependensi pinned `niimbot-web-bluetooth` 2.6.0 di `package.json` dan `package-lock.json`

## Phase 2: Foundational

- [X] T002 Buat unit test kontrak raster, rotasi, model M2-H, error, dan koneksi ulang di `tests/unit/niimbotM2h.test.mjs`
- [X] T003 Implementasikan renderer canvas dan lifecycle driver minimal di `src/lib/niimbotM2h.js`

## Phase 3: User Story 1 - Cetak compact ke M2-H

**Goal**: Satu aksi mencetak tepat satu label compact pada M2-H.

**Independent Test**: Mock driver menerima satu PNG 567×827, density 3, setelah identifikasi model 4608.

- [X] T004 [US1] Hubungkan aksi direct print, status proses, dan anti double click di `src/components/KartuGantungModal.jsx`
- [X] T005 [US1] Verifikasi isi dan urutan visual renderer compact di `tests/unit/niimbotM2h.test.mjs`

## Phase 4: User Story 2 - Pertahankan A4

**Goal**: A4 tetap memakai preview browser tanpa Web Bluetooth.

**Independent Test**: Handler A4 membuka builder existing dan tidak memanggil helper NIIMBOT.

- [X] T006 [US2] Pertahankan tombol A4 dan pisahkan tombol preview compact dari direct print di `src/components/KartuGantungModal.jsx`
- [X] T007 [US2] Tambahkan regresi A4 dan fallback preview di `tests/unit/kartuGantungCompact.test.mjs`

## Phase 5: User Story 3 - Pemulihan kegagalan

**Goal**: Error dapat ditindaklanjuti dan aksi dapat dicoba ulang.

**Independent Test**: Setiap error mengembalikan status idle-ready, koneksi rusak dibuang, dan pesan ramah tersedia.

- [X] T008 [US3] Lengkapi mapping error dan reset koneksi di `src/lib/niimbotM2h.js`
- [X] T009 [US3] Tampilkan status aksesibel dan state retry di `src/components/KartuGantungModal.jsx`

## Phase 6: Polish & Validation

- [X] T010 Jalankan unit tests terkait dan seluruh suite melalui perintah di `specs/026-niimbot-direct-print/quickstart.md`
- [X] T011 Jalankan production build dan `git diff --check` melalui perintah di `specs/026-niimbot-direct-print/quickstart.md`

## Dependencies & Execution Order

1. T001 sebelum test dan implementasi driver.
2. T002 sebelum T003 mengikuti red-green.
3. T003 sebelum integrasi modal T004.
4. T004-T009 berurutan karena menyentuh dua file yang sama.
5. T010-T011 terakhir.

## Implementation Strategy

MVP adalah US1 dengan validasi model fail-closed. US2 mempertahankan regresi A4 dan fallback. US3 menutup jalur error sebelum verifikasi penuh. Uji fisik sesuai quickstart dilakukan saat M2-H tersedia dan tidak menggantikan automated checks.
