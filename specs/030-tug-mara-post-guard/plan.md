# Implementation Plan: TUG MARA Posting Guard

**Branch**: `main` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

## Summary

Move TUG-3 final posting to an atomic RPC and add one shared MARA resolver to all TUG receipt RPC paths. Keep draft compatibility, derive posted identity from MARA, and remove manual new-material entry from the TUG forms.

## Technical Context

**Language/Version**: JavaScript/React, PostgreSQL PL/pgSQL
**Primary Dependencies**: Existing Vite, Supabase client, PostgreSQL functions
**Storage**: Supabase self-host PostgreSQL with JSONB master tables
**Testing**: Node test runner, contract source tests, SQL verification, Vite build
**Target Platform**: Browser frontend and Supabase self-host
**Project Type**: Web application
**Constraints**: No new dependency; production schema requires manual approval; posting must be atomic and idempotent

## Constitution Check

- Reuses existing RPC, idempotency, audit, and master-table patterns.
- Adds no dependency or speculative abstraction.
- Enforces validation at the trust boundary.
- Preserves review-first approval and UPT scope.

## Project Structure

```text
App.jsx
src/hooks/useTugApprovals.js
src/lib/tug3Sync.js
src/components/TugFormModals.jsx
supabase/migrations/
supabase/schema.sql
tests/unit/
```

**Structure Decision**: Extend current TUG modules and database functions; no new application layer.
