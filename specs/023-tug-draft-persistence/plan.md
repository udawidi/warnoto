# Implementation Plan: Persistensi Draft Seluruh TUG

**Branch**: `main` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

## Summary

Jadikan server sumber kebenaran semua draft TUG. Pertahankan tabel dedicated TUG-3/TUG-10 dan canonical TUG-8/TUG-9. Tambah satu tabel workflow untuk lifecycle TUG-5/TUG-7 serta draft pra-canonical TUG-8/TUG-9. Semua write dilakukan melalui RPC versioned dan scoped; cache browser hanya recovery sementara.

## Technical Context

**Language/Version**: JavaScript/JSX, PostgreSQL PL/pgSQL  
**Primary Dependencies**: React, Vite, `@supabase/supabase-js` existing  
**Storage**: Supabase PostgreSQL self-host + Supabase Storage existing  
**Testing**: Node test runner, contract tests, build Vite, SQL verifier  
**Target Platform**: Browser desktop/mobile, Vercel frontend, Supabase self-host  
**Project Type**: Web application  
**Performance Goals**: Simpan/muat draft satu round-trip; boot tetap paralel  
**Constraints**: Tidak mengubah stok saat draft; nomor resmi server-only; fail-closed; tanpa dependency baru  
**Scale/Scope**: Enam tipe TUG dan workflow UPT/UIT/ULTG existing

## Constitution Check

Constitution project masih template dan tidak menambah gate. AGENTS/HANDOFF tetap mengikat:

- PASS: reuse pola sync/RPC existing dan tanpa dependency baru.
- PASS: migration hanya proposal sampai persetujuan apply production.
- PASS: scope UPT/UIT dan review-first dipertahankan.
- PASS: test non-trivial dan rollback/verifier wajib.
- PASS: cache lama tidak dihapus otomatis.

Post-design check: seluruh gate tetap PASS.

## Project Structure

### Documentation

```text
specs/023-tug-draft-persistence/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/rpc.md
└── tasks.md
```

### Source Code

```text
App.jsx
src/hooks/useTugTransactions.js
src/hooks/useTugApprovals.js
src/lib/tugWorkflowSync.js
src/lib/tug3Sync.js
src/lib/tug10Sync.js
src/components/TugFormModals.jsx
supabase/migrations/20260923_tug_workflow_persistence.sql
supabase/migrations/20260923_tug_workflow_persistence.rollback.sql
supabase/verify_tug_workflow_persistence.sql
supabase/schema.sql
tests/unit/tugWorkflowPersistence.contract.test.mjs
tests/unit/tugCanonical.contract.test.mjs
```

**Structure Decision**: Tambah satu client sync dan satu tabel workflow. Jangan ubah bentuk canonical TUG-8/9 atau membuat tabel per jenis TUG baru.

## Complexity Tracking

Tidak ada pelanggaran. Satu tabel workflow adalah tambahan minimum untuk scope UPT/UIT yang berbeda dan lifecycle noncanonical.

