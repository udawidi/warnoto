# Tasks: Optional Heavy Equipment Loan Letter

## Phase 1: Setup

- [X] T001 Review existing HAR UIT checkout, evidence upload, and storage contracts in `src/hooks/useHeavyEquipment.js`, `src/components/HeavyEquipmentTabV2.jsx`, and `supabase/migrations/20260921_har_uit_heavy_equipment_loans.sql`

## Phase 2: Foundational

- [X] T002 Add regression assertions for optional HAR UIT evidence and unchanged return evidence in `tests/unit/heavyEquipmentSupportTools.test.mjs`

## Phase 3: User Story 1 - Ajukan Tanpa Surat (P1)

**Goal**: HAR UIT dapat mengajukan alat individual atau berbasis jumlah tanpa surat.

**Independent Test**: Kedua RPC menerima `NULL` untuk HAR UIT, tetap menolak path lintas UPT, dan build frontend lulus.

- [X] T003 [US1] Add backward-compatible RPC override migration in `supabase/migrations/20260921b_har_uit_optional_loan_letter.sql`
- [X] T004 [US1] Mirror final RPC definitions in `supabase/schema.sql`
- [X] T005 [US1] Make evidence upload and cleanup conditional for HAR UIT in `src/hooks/useHeavyEquipment.js`
- [X] T006 [US1] Replace required Foto Serah-Terima UI with optional Surat Peminjaman in `src/components/HeavyEquipmentTabV2.jsx`

## Phase 4: User Story 2 - Lampirkan Surat Opsional (P2)

**Goal**: PDF atau gambar surat dapat diunggah dan dibuka dari riwayat.

**Independent Test**: File valid memakai path unit/batch yang benar dan tombol riwayat membuka signed URL.

- [X] T007 [US2] Support PDF/image letter MIME handling and `loan-letter` filenames in `src/hooks/useHeavyEquipment.js`
- [X] T008 [US2] Update optional file input, preview, and history action labels in `src/components/HeavyEquipmentTabV2.jsx`

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T009 Run focused unit/contract checks, production build, diff check, and localhost smoke test using commands in `specs/019-optional-loan-letter/quickstart.md`

## Dependencies

- T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009.
- User Story 2 depends on the optional server contract from User Story 1.

## Parallel Opportunities

None: migration, schema snapshot, hook, component, and tests share one compatibility contract and should be changed sequentially.

## Implementation Strategy

MVP is User Story 1: submission without a document. User Story 2 adds optional document formats and history access without changing the stored compatibility field.
