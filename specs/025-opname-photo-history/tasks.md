# Tasks: Foto Stock Opname pada Data Stok

## Phase 1: Contract and pure mapping

- [X] T001 Buat helper scope, mapping, promotion, dan history.
- [X] T002 Tambah unit/contract test cross-UPT, idempotency, no-empty-history, dan upload contract.

## Phase 2: User Story 1 — approval dan edit foto

- [X] T003 Terapkan UPT fail-closed pada upload dan manual update.
- [X] T004 Terapkan archive/promote idempoten pada approval Asman tanpa mengubah qty.
- [X] T005 Buat backfill default dry-run dengan explicit `--write` dan merge JSONB identity-safe.

## Phase 3: User Story 2 — modal dan lazy history

- [X] T006 Tambah tab `Opname` conditional, max 10 sesi, controlled active session, dan lazy thumbnails.
- [X] T007 Simpan/render hanya foto sebelumnya; foto sesi tetap dari `stock_opname`.

## Phase 4: User Story 3 — embedding/OCR scoped

- [X] T008 Tambah scoped visual/OCR search dan result key UPT+katalog.
- [X] T009 Buat migration/schema proposal UPT embedding, RLS, scoped RPC, serta staged cleanup RPC.

## Phase 5: Validation and gated production

- [X] T009a Perluas embedding current/opname `SELESAI`, stable ID, same-UPT fallback, dan OCR header/workflow secret.
- [ ] T010 Terapkan migration dan backfill production setelah approval user.
- [ ] T011 Verifikasi browser production setelah deploy.

Focused tests, full test, build, dan diff check dijalankan sebelum handoff. T010/T011 belum selesai karena production apply dan browser production belum diizinkan.

## Dependencies

T001-T002 mendahului T003-T005. T003-T007 mendahului T008-T009a. T010 membutuhkan hasil dry-run/backups dan persetujuan user; T011 membutuhkan deploy selesai dan T010.
