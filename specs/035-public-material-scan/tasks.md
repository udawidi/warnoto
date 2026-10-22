# Tasks: Public Material Scan per UPT

## Phase 1 — Contract

- [x] T001 Tambah spec dan acceptance criteria.
- [x] T002 Definisikan payload RPC/status dan aturan scope.

## Phase 2 — Database

- [x] T003 Implementasikan RPC read-only di migration.
- [x] T004 Mirror RPC ke `supabase/schema.sql`.

## Phase 3 — Frontend

- [x] T006 Tambah `upt` ke seluruh QR material scoped.
- [x] T007 Migrasikan halaman publik ke RPC dan picker QR lama.
- [x] T008 Tampilkan UPT/lokasi live dan fail-closed untuk UPT kosong/konflik.

## Phase 4 — Verification

- [x] T009 Tambah contract test URL/QR dan static UI guard.
- [x] T010 Tambah rehearsal SQL scratch untuk kontrak RPC.
- [x] T011 Jalankan unit test, build, dan diff check.

## Rollout setelah persetujuan

- [x] T005 Terapkan migration production setelah user meninjau SQL dan memberi persetujuan terpisah.

## Execution Order

T001–T002 → T003–T004 → T006–T008 → T009–T011 → T005 rollout production.
