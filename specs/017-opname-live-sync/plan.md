# Implementation Plan: Sinkronisasi Langsung Stock Opname

**Branch**: `main` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

## Summary

Tambahkan autosave yang fail-closed, sinkronisasi Realtime untuk satu baris sesi, dan RPC freeze TL-only. Pertahankan model JSONB serta merge per blok yang sudah ada.

## Technical Context

**Language/Version**: JavaScript/JSX, PostgreSQL 15  
**Primary Dependencies**: React, Vite 4, Supabase JS yang sudah terpasang  
**Storage**: Self-host Supabase PostgreSQL; `stock_opname.data` JSONB  
**Testing**: Node test runner, Playwright, Vite build, SQL verifier  
**Target Platform**: Browser desktop/mobile dan Supabase self-host  
**Project Type**: Web application  
**Performance Goals**: Perubahan terlihat lintas akun <=2 detik setelah save  
**Constraints**: Tanpa dependensi baru; single-row writes; data Fajar tidak dimutasi saat verifikasi  
**Scale/Scope**: Satu tabel sesi Stock Opname, role UPT, ratusan item per sesi

## Constitution Check

Konstitusi project belum diisi. Kontrak `AGENTS.md` berlaku: reuse pola, perubahan minimum, schema proposal/approval, review-first, dan keamanan tidak disederhanakan. PASS.

## Project Structure

```text
src/components/StockOpnameTab.jsx
src/hooks/useStockOpname.js
src/lib/stockOpnameFlow.js
src/lib/stockOpnameRealtime.js
supabase/migrations/20260921_stock_opname_live_sync.sql
supabase/verify_stock_opname_live_sync.sql
tests/unit/
```

**Structure Decision**: Pertahankan struktur React/Supabase existing. Subscription berada di hook domain agar tidak menambah konflik pada `App.jsx` yang sedang dirty.
