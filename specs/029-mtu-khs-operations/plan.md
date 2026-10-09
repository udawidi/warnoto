# Implementation Plan: Operasional MTU KHS

**Branch**: `029-mtu-khs-operations` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

## Summary

Perluas modul MTU KHS existing dengan mutation RPC tervalidasi, audit append-only, private evidence, pencarian ranked, dan transfer parsial/full antar-UPT. Reuse komponen, helper kompresi, Supabase, RLS, role, katalog, serta hierarki lokasi yang sudah ada.

## Technical Context

**Language/Version**: JavaScript/JSX, PostgreSQL PL/pgSQL, Supabase Edge TypeScript bila diperlukan
**Primary Dependencies**: React, Vite, Supabase JS, Phosphor Icons; tanpa dependency npm baru
**Storage**: PostgreSQL self-host dan private Supabase Storage
**Testing**: Node test contracts/unit, Vite build, SQL rehearsal bila tersedia
**Target Platform**: Desktop dan mobile web 360 px
**Project Type**: React web application dengan Supabase backend
**Performance Goals**: Hasil pencarian dataset saat ini <1 detik
**Constraints**: RLS fail-closed, multi-UPT, review-first untuk transfer, migration production perlu konfirmasi
**Scale/Scope**: Sekitar 1.070 record awal, bertumbuh lewat import dan transfer

## Constitution Check

Constitution project masih template. Kontrak AGENTS/HANDOFF mengikat: reuse pola existing, tanpa dependency baru, DB self-host canonical, schema proposal sebelum apply, dan jangan mengubah HANDOFF tanpa izin.

## Architecture

- Migration menambah `lokasi_id`, search text/index trigram, event, evidence, transfer request, private bucket/policies, RPC mutasi, serta RPC read-only master tujuan lintas-UPT dalam UIT.
- `mtu_khs_update_operational` menerima patch whitelist dan menyimpan langsung untuk TL scoped.
- `mtu_khs_request_transfer` serta `mtu_khs_decide_transfer` menangani approval ASMAN asal dan split/move atomik.
- `mtu_khs_register_evidence` memvalidasi object sebelum mengganti foto aktif.
- `mtu_khs_list_records` diperluas dengan filter RFQ/KR, ranking, dan facets.
- Frontend tetap berada di `src/features/mtu-khs/`; `App.jsx` hanya wiring existing.

## Project Structure

```text
src/features/mtu-khs/
├── MtuKhsTab.jsx
├── MtuKhsDetail.jsx
├── mtuKhsApi.js
├── mtuKhsModel.js
└── mtuKhs.css
supabase/migrations/20261009_mtu_khs_operations.sql
tests/unit/mtuKhsOperations.contract.test.mjs
```

## Rollout

1. Tulis migration dan contract tests.
2. Implement API/model/UI terhadap kontrak RPC.
3. Jalankan unit tests dan build.
4. Minta konfirmasi sebelum apply migration self-host.
5. Apply migration, smoke akun TL/ASMAN/UPT tujuan, lalu push main.

## Complexity Tracking

Transfer parsial memerlukan tabel request dan event terpisah karena change-request legacy tidak menyimpan scope tujuan, lineage split, atau akses audit dua UPT.
