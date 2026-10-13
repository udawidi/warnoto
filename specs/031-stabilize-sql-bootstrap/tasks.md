# Tasks: Stabilize SQL Bootstrap

## Phase 1: Foundational

- [x] T001 Audit blok data repair dan definisi fungsi ganda di `supabase/schema.sql`

## Phase 2: User Story 1 - Bootstrap Aman (P1)

**Independent Test**: schema dapat dijalankan dua kali pada PostgreSQL kosong.

- [x] T002 [US1] Tambah contract test larangan data repair di `tests/unit/schemaBootstrap.contract.test.mjs`
- [x] T003 [US1] Hapus mirror data repair production-specific dari `supabase/schema.sql`
- [x] T004 [US1] Tambah rehearsal bootstrap dua kali di `scripts/rehearse_schema_bootstrap.mjs`

## Phase 3: User Story 2 - Definisi Final Tunggal (P2)

**Independent Test**: fungsi kritis tidak terduplikasi dan signature final tetap ada.

- [x] T005 [US2] Tambah assertion fungsi kritis tunggal di `tests/unit/schemaBootstrap.contract.test.mjs`
- [x] T006 [US2] Hapus definisi fungsi lama yang tertimpa dari `supabase/schema.sql`

## Phase 4: Verification

- [x] T007 Jalankan contract test dan rehearsal dari `specs/031-stabilize-sql-bootstrap/quickstart.md`
- [x] T008 Jalankan full test dan build lalu tandai seluruh task selesai di `specs/031-stabilize-sql-bootstrap/tasks.md`

## Dependencies & Execution Order

T001 -> T002/T003/T004 -> T005/T006 -> T007 -> T008.

## Implementation Strategy

MVP: T001-T004. Pembersihan duplikasi hanya dilakukan bila signature final dan dependency dapat dibuktikan aman.
