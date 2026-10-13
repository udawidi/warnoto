# Tasks: ATTB Unit Trace

## Phase 1: Setup

- [x] T001 Tambahkan contract tests awal untuk migration/public payload di `tests/unit/attbUnitTrace.contract.test.mjs`
- [x] T002 [P] Tambahkan unit tests helper URL/label di `tests/unit/attbTrace.test.mjs`

## Phase 2: Foundational

- [x] T003 Implementasikan tabel, RLS, trigger histori, token, public RPC, dan update final TUG-10 di `supabase/migrations/20261013_attb_unit_trace.sql`
- [x] T004 Sinkronkan final-state bootstrap di `supabase/schema.sql`
- [x] T005 Tambahkan rehearsal SQL scratch di `scripts/rehearse_attb_unit_trace.mjs`

## Phase 3: User Story 1 - Identitas Unit (P1)

- [x] T006 [US1] Tambahkan kontrak helper tracking/URL/token di `src/lib/attbTrace.js`
- [x] T007 [US1] Kunci qty 1 dan seri/aset pada form TUG-10 di `src/components/TugFormModals.jsx`
- [x] T008 [US1] Selaraskan merge respons approval dan source key ATTB di `App.jsx`

## Phase 4: User Story 2 - Riwayat Unit (P2)

- [x] T009 [US2] Muat histori scoped dan tampilkan timeline/detail/label di `src/components/AttbTab.jsx`
- [x] T010 [US2] Tambahkan rotasi token TL/SUPERADMIN dengan konfirmasi di `src/components/AttbTab.jsx`

## Phase 5: User Story 3 - Scan Publik (P3)

- [x] T011 [US3] Implementasikan halaman allowlist publik di `src/components/ScanAttbPublicView.jsx`
- [x] T012 [US3] Tambahkan route `?attb=` sebelum login di `App.jsx`

## Phase 6: Verification

- [x] T013 Jalankan contract/unit tests, rehearsal PostgreSQL, full test, build, dan diff-check
- [x] T014 Tandai seluruh task selesai dan review scope production tetap tidak tersentuh di `specs/032-attb-unit-trace/tasks.md`

## Dependencies

T001/T002 → T003/T004/T005 → T006/T007/T008 → T009/T010 → T011/T012 → T013/T014.

## Implementation Strategy

SQL/RPC/RLS dikerjakan senior lebih dulu. UI dikerjakan worker setelah kontrak data final. Main agent melakukan integrasi dan verifikasi akhir.

