# Implementation Plan: Alat Bantu Kerja dan Peminjaman HAR UIT

**Branch**: `main` | **Date**: 2026-09-20 | **Spec**: [spec.md](spec.md)

## Summary

Pertahankan alur TL/Asman yang sudah berjalan dan tambahkan requester organisasi HAR_UIT. Scope HAR diturunkan dari typed `uit_id`; registry dan histori dibaca hanya untuk UPT dalam UIT yang sama, sedangkan checkout hanya menerima alat tersedia yang mengaktifkan lintas-UPT. Bukti foto tetap private dan approval tetap milik Asman UPT pemilik.

## Technical Context

**Language/Version**: JavaScript React 18, Vite, PostgreSQL Supabase self-host

**Dependencies**: Existing React, Supabase JS, Phosphor, Tailwind/CSS project; tidak ada dependency baru

**Storage**: `heavy_equipment`, `heavy_equipment_loans.requester_uit_id`, bucket private `heavy-equipment-evidence`

**Testing**: Node test, Playwright, SQL contract/rehearsal, Vite build

**Constraints**: Server-first, typed `upt_id`/`uit_id` authoritative, RLS deny-by-default, RPC signature tetap kompatibel, backward-compatible loan legacy, production self-host only, frontend tidak dideploy sebelum migration aktif

## Constitution Check

Constitution masih template. Kontrak project yang mengikat: review-first, perubahan schema disetujui sebelum apply, reuse pola existing, self-host canonical, dan verifikasi security.

## Project Structure

```text
src/lib/heavyEquipment.js
src/hooks/useHeavyEquipment.js
src/components/HeavyEquipmentTabV2.jsx
src/lib/docBuilders.js
App.jsx
src/styles/operations.css
supabase/migrations/20260920_heavy_equipment_upt_id_loans.sql
supabase/migrations/20260921_har_uit_heavy_equipment_loans.sql
supabase/verify_har_uit_heavy_equipment.sql
tests/unit/heavyEquipmentSupportTools.test.mjs
tests/e2e/heavy-equipment.spec.js
```

## Design Read

Redesign-preserve untuk product UI operasional PLN. Enterprise trust-first. `DESIGN_VARIANCE=3`, `MOTION_INTENSITY=2`, `VISUAL_DENSITY=7`. Guideline WARNOTO menang atas Design Taste. Mobile-first, target sentuh 44 px, tanpa dependency visual baru.

## Constitution Check Post-Design

Lulus. Solusi menambah satu foreign key nullable, index, policy final, serta cabang HAR_UIT pada dua RPC checkout existing. Tidak ada dependency atau perubahan signature RPC. Migration production tetap membutuhkan persetujuan eksplisit.
