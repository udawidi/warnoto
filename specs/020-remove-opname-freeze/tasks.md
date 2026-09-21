# Tasks

## Phase 1 — Discovery

- [x] T001 Inventarisir referensi freeze pada `App.jsx`, `src/`, `supabase/`, dan `tests/`.
- [x] T002 Petakan object freeze pada `supabase/migrations/20260921c_remove_stock_opname_freeze.sql` dan verifier `supabase/verify_stock_opname_freeze_removal.sql`.

## Phase 2 — US1 ADMIN save (P1)

- [x] T003 [US1] Hapus UI dan guard save/edit freeze pada `App.jsx` dan komponen Stock Opname terkait.
- [x] T004 [US1] Hapus pemanggilan RPC/helper freeze pada jalur save di `App.jsx` dan `src/`.
- [x] T005 [US1] Tambahkan migration SQL `supabase/migrations/20260921c_remove_stock_opname_freeze.sql` untuk drop object freeze tanpa mengubah `stock_opname` Realtime/`updated_at`.
- [x] T006 [P] [US1] Jalankan 368 unit tests dan build pada `package.json` scripts; verifikasi save Stock Opname pada test suite existing.

## Phase 3 — US2 TUG no freeze (P2)

- [x] T007 [US2] Hapus trigger/fungsi/guard freeze tersisa pada `supabase/migrations/20260921c_remove_stock_opname_freeze.sql`.
- [x] T008 [US2] Pertahankan legacy `freeze` inert tanpa mass-update pada `supabase/migrations/20260921c_remove_stock_opname_freeze.sql`.
- [x] T009 [P] [US2] Jalankan 5 GI tests dan 6 Stock Opname tests pada test files existing sebagai regresi GI/Stock Opname.

## Phase 4 — US3 heavy seed and regressions (P3)

- [x] T010 [US3] Verifikasi bootstrap non-TL/ADMIN tidak mencoba seed `heavy_equipment`, dan fallback write hanya TL pada `App.jsx` serta contract test existing.
- [x] T011 [P] [US3] Jalankan seluruh heavy-equipment E2E pada test files existing sebagai regresi umum; gate seed dibuktikan contract T010.
- [x] T012 Verifikasi GI pada `supabase/migrations/20260918_gi_tug_warehouse.sql` dan QR/Barcode pada `supabase/migrations/20260918_lokasi_public_qr.sql` tanpa perubahan fitur.
- [x] T013 Jalankan contract verifier lokal pada `supabase/verify_stock_opname_freeze_removal.sql` dan path test existing; pastikan kontrak Realtime/`updated_at` tetap tanpa klaim eksekusi database.

## Phase 5 — Production pending

- [ ] T014 Terapkan migration `supabase/migrations/20260921c_remove_stock_opname_freeze.sql` ke Supabase production setelah koneksi tersedia.
- [ ] T015 Jalankan verifier `supabase/verify_stock_opname_freeze_removal.sql` di production.
- [ ] T016 Jalankan smoke test save/edit akun ADMIN/Fajar dan TUG di production setelah deploy.
