# Implementation Plan: Perbaikan Edit dan Sinkron Kapasitas Gudang

**Branch**: `main` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

## Summary

Validasi perhitungan kapasitas dipusatkan pada helper murni. Edit memakai upsert satu baris ke database self-host, lalu sinkron satu baris ke Google Sheet melalui kontrak preview/confirm existing. Constraint database menegakkan batas dan konsistensi rumus.

## Technical Context

**Language/Version**: JavaScript/JSX, Node.js >=20.19, PostgreSQL

**Primary Dependencies**: React 18, Supabase JS existing; tanpa dependency baru

**Storage**: PostgreSQL self-host `warehouse_capacity`; Google Sheet operasional

**Testing**: Node test runner, Vite build, self-check mapping existing

**Target Platform**: Browser desktop/mobile dan Supabase self-host

**Project Type**: React web application dengan Edge Function existing

**Performance Goals**: Satu edit hanya melakukan satu upsert DB dan maksimal satu update baris Sheet

**Constraints**: Review-first, DB authoritative, no silent clamp, no cross-system rollback palsu

**Scale/Scope**: 44 baris production saat preflight; satu tabel dan satu layar edit

## Constitution Check

Constitution masih template tanpa aturan aktif. Kontrak project tetap dipenuhi: perubahan skema diproposalkan dan disetujui, solusi minimum, test untuk logika non-trivial, push terpisah.

## Project Structure

```text
src/components/KapasitasGudangTab.jsx
src/lib/masterSync.js
src/lib/warehouseCapacity.mjs
supabase/migrations/20260915b_warehouse_capacity_bounds.sql
tests/unit/warehouseCapacity.test.mjs
```

**Structure Decision**: Pertahankan struktur React/Vite existing; helper murni baru hanya untuk rumus dan validasi yang harus dapat diuji langsung.

## Complexity Tracking

Tidak ada pelanggaran constitution atau dependency baru.
