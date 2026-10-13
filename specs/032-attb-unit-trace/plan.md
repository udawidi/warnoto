# Implementation Plan: ATTB Unit Trace

**Branch**: `main` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

## Summary

Pisahkan grain ATTB dari grain katalog. Final Asman membuat satu unit ATTB, public token, dan event history per baris TUG-10 ATTB; halaman publik membaca payload allowlist melalui RPC bertoken.

## Technical Context

**Language/Version**: React/JavaScript; PostgreSQL PL/pgSQL
**Primary Dependencies**: Supabase client, qrcode, browser print; tanpa dependency baru
**Storage**: `attb_list` existing + dua tabel scoped baru
**Testing**: Node test runner, PostgreSQL/Docker rehearsal, Vite build
**Target Platform**: Vercel frontend + Supabase self-host
**Project Type**: Web application
**Performance Goals**: Satu lookup indexed per scan; timeline satu unit saja
**Constraints**: Review-first; production tidak disentuh tanpa persetujuan; tidak backfill legacy
**Scale/Scope**: Unit ATTB baru dari TUG-10 setelah rollout

## Constitution Check

- PASS: solusi minimum memakai pola QR fragment/RPC existing.
- PASS: tidak menambah dependency.
- PASS: data publik di-whitelist server-side; tabel tetap tertutup.
- PASS: migration production tetap manual setelah backup dan persetujuan.

## Project Structure

```text
supabase/migrations/20261013_attb_unit_trace.sql
supabase/schema.sql
src/lib/attbTrace.js
src/components/AttbTab.jsx
src/components/ScanAttbPublicView.jsx
App.jsx
tests/unit/
specs/032-attb-unit-trace/
```

**Structure Decision**: Reuse modul ATTB/TUG-10 existing; helper kecil baru untuk kontrak tracking/URL/label.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Dua tabel baru | Token publik dan histori append-only memiliki privilege/lifecycle berbeda | JSONB `stageHistory` dapat ditimpa client dan tidak aman untuk halaman publik |

