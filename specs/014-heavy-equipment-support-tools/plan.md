# Implementation Plan: Alat Bantu Kerja Terisolasi per UPT

**Branch**: `main` | **Date**: 2026-09-20 | **Spec**: [spec.md](spec.md)

## Summary

Perluas domain Alat Berat dengan tipe Alat Bantu, scope typed `upt_id`, checkout/approval/return batch atomik, bukti foto private self-host, dan UI responsive redesign-preserve.

## Technical Context

**Language/Version**: JavaScript React 18, Vite, PostgreSQL Supabase self-host

**Dependencies**: Existing React, Supabase JS, Phosphor, Tailwind/CSS project; tidak ada dependency baru

**Storage**: `heavy_equipment`, `heavy_equipment_loans`, bucket private `heavy-equipment-evidence`

**Testing**: Node test, Playwright, SQL contract/rehearsal, Vite build

**Constraints**: Server-first, `upt_id` authoritative, RLS deny-by-default, backward-compatible loan legacy, production self-host only

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
tests/unit/heavyEquipmentSupportTools.test.mjs
tests/e2e/heavy-equipment.spec.js
```

## Design Read

Redesign-preserve untuk product UI operasional PLN. Enterprise trust-first. `DESIGN_VARIANCE=3`, `MOTION_INTENSITY=2`, `VISUAL_DENSITY=7`. Guideline WARNOTO menang atas Design Taste. Mobile-first, target sentuh 44 px, tanpa dependency visual baru.

## Constitution Check Post-Design

Lulus. Solusi menambah hanya kolom, RPC, dan bucket private yang diperlukan untuk keamanan dan durability.
