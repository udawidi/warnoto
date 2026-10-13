# Implementation Plan: Stabilize SQL Bootstrap

**Branch**: `main` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

## Summary

Pertahankan migrations sebagai histori production dan bersihkan snapshot bootstrap dari data repair serta definisi fungsi lama yang tertimpa. Tambahkan contract check dan rehearsal PostgreSQL kosong dua kali.

## Technical Context

**Language/Version**: PostgreSQL PL/pgSQL; Node.js test runner
**Primary Dependencies**: PostgreSQL/Docker yang sudah tersedia; tanpa dependency baru
**Storage**: Supabase self-host PostgreSQL
**Testing**: `node --test`, rehearsal PostgreSQL, full `npm test`, Vite build
**Target Platform**: self-host production dan database restore/scratch
**Project Type**: React web app dengan schema SQL
**Performance Goals**: bootstrap deterministik; bukan jalur runtime
**Constraints**: tidak mengubah production; pertahankan signature/grant final; diff minimum
**Scale/Scope**: satu snapshot 5.231 baris, 117 migration

## Constitution Check

- PASS: solusi minimum, tanpa dependency baru.
- PASS: production review-first; tidak ada apply schema.
- PASS: perubahan non-trivial memiliki verifier runnable.

## Project Structure

```text
supabase/schema.sql
supabase/migrations/
scripts/rehearse_schema_bootstrap.mjs
tests/unit/schemaBootstrap.contract.test.mjs
specs/031-stabilize-sql-bootstrap/
```

**Structure Decision**: Tetap satu snapshot untuk kompatibilitas. Migrations tetap terpisah dan canonical untuk upgrade.
