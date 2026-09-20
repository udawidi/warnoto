# Tasks: Isolasi Server Stock Opname per UPT

## Phase 1: Server Boundary

- [X] T001 Tambah contract test hardening RLS/grant dan filter loader.
- [X] T002 Tambah migration idempotent serta verifier production.
- [X] T003 Samakan blok Stock Opname/Count di `supabase/schema.sql` dengan policy scoped.

## Phase 2: Client Defense-in-Depth

- [X] T004 Tambah opsi filter `uptIds` pada `loadMasterTable`.
- [X] T005 Pasang filter typed scope pada load Stock Opname/Count bila scope organisasi diketahui.
- [X] T006 Jadikan cache fallback fail-closed dan hapus auto-seed saat remote kosong.
- [X] T007 Perbaiki filter UI agar record scoped tanpa `uptId` tidak lolos.

## Phase 3: Deployment and Verification

- [X] T008 Jalankan unit, build, dan diff check.
- [X] T009 Backup self-host, terapkan migration, lalu verifikasi catalog dan simulasi role.
- [X] T010 Jalankan regression test final, commit, dan push `main`.

## Dependencies

T001 sebelum T002-T007. T002-T007 sebelum T008. T008 sebelum T009. T009 sebelum T010.
