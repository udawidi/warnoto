# Implementation Plan: Pengembalian Alat Berat

**Branch**: `main` | **Date**: 2026-09-19 | **Spec**: [spec.md](spec.md)

## Summary

Tambahkan CTA pengembalian pada kartu alat dan ganti penyimpanan dua upsert client dengan RPC PostgreSQL atomik yang hanya menerima ADMIN/TL UPT pemilik.

## Technical Context

**Language/Version**: JavaScript React/Vite 4; PostgreSQL Supabase self-host

**Primary Dependencies**: React, `@supabase/supabase-js`, helper role/scope existing

**Storage**: `heavy_equipment`, `heavy_equipment_loans` JSONB canonical

**Testing**: Node test, Playwright, SQL transaction rollback, Vite build

**Target Platform**: Web desktop/mobile; production `warnoto.com`

**Project Type**: Single React web application dengan backend Supabase

**Performance Goals**: Satu RPC per pengembalian; feedback UI langsung setelah respons

**Constraints**: Tidak ada dependency/kolom/bucket baru; migration production gated; state tidak boleh berubah sebelum server sukses

**Scale/Scope**: Satu lifecycle action pada modul Alat Berat

## Constitution Check

Constitution project masih template dan tidak memiliki gate aktif. Kontrak project tetap mengikat: review-first, perubahan schema perlu persetujuan, reuse pola existing, dan verifikasi penuh.

## Project Structure

### Documentation

```text
specs/011-heavy-equipment-return/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/return-rpc.md
└── tasks.md
```

### Source Code

```text
src/components/HeavyEquipmentTabV2.jsx
src/hooks/useHeavyEquipment.js
src/lib/heavyEquipment.js
supabase/migrations/20260919_heavy_equipment_loan_return_rpc.sql
tests/unit/heavyEquipmentReturn.test.mjs
tests/e2e/heavy-equipment.spec.js
```

**Structure Decision**: Pertahankan modul existing; helper izin di domain lib, handler di hook, UI di komponen, dan satu migration RPC.

## Constitution Check Post-Design

Lulus. Solusi tidak menambah dependency atau abstraksi baru dan membatasi perubahan pada lifecycle pengembalian.
