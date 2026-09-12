# Implementation Plan: MTU KHS

**Branch**: `002-mtu-khs` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

Build a dedicated Supabase-backed MTU KHS feature, stage legacy workbook imports, reuse existing organization/supplier/catalog masters, provide scoped GI/Bay masters through Master Data, enforce server-side hierarchical scope and approval, and provide a responsive Apple-like SaaS operational UI.

## Technical Context

**Language/Version**: JavaScript ES modules, React 18

**Primary Dependencies**: Vite 4, Supabase client, existing `xlsx`, Phosphor icons

**Storage**: Existing self-hosted PostgreSQL/Supabase plus Google Drive document URLs

**Testing**: Node test runner, SQL contract checks, Playwright mobile tests, Vite build

**Target Platform**: WARNOTO web app, desktop and mobile browsers

**Project Type**: Existing single-page web application

**Performance Goals**: Paginated queries and responsive interactions for at least the initial 1,070 imported records

**Constraints**: No new dependency, production schema changes require explicit user approval, App.jsx thin wiring, no direct stock mutation, RLS mandatory

**Scale/Scope**: Two MTU worksheets plus the complete GI/Bay workbook (`D:\CLAUDE\WARNOTO data\Data Material HAR\BAY GI.xlsx`, sheet `3a. BAY`): 2,429 raw rows, six UPT, 15 normalized ULTG, 185 GI, 2,427 Bay, additive legacy preservation, and hierarchical UIT/UPT/ULTG/GI/Bay scope

## Constitution Check

The constitution is an unfilled template. Project AGENTS.md, HANDOFF.md, and design guidelines govern implementation. Required gates: review-first writes, proposed-only schema, no HANDOFF edit, no push, reuse existing components, and server-side scope.

## Project Structure

```text
src/features/mtu-khs/
├── MtuKhsTab.jsx
├── MtuKhsDetail.jsx
├── MtuKhsImportPanel.jsx
├── mtuKhsApi.js
├── mtuKhsImport.js
└── mtuKhsModel.js

supabase/migrations/
└── 20260911_mtu_khs.sql

tests/unit/
└── mtuKhs.test.mjs
```

`App.jsx` only relabels and mounts the feature. Existing theme, OperationsHero, mobile-card-table, approval classes, role helpers, supplier/catalog masters, and TUG canonical data are reused.

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Dedicated relational tables | Scope, approvals, audit, imports, and documents require queryable integrity | One JSON blob would repeat prior multi-user durability and isolation failures |
| Feature-specific scope helper | PENGADAAN needs MTU-only national access | Expanding `can_access_upt` would change unrelated modules |
| GI/Bay management belongs in Master Data | Avoids a duplicate master UI inside MTU KHS while preserving row-level RPC writes | Keeping a feature-local tab would split the canonical master workflow |
| Typed GI UPT scope and normalized uniqueness | Makes RLS and hierarchy checks direct and deterministic | Deriving UPT through ULTG on every query permits ambiguity and duplicate names |
| Database-first Sheet mirror | Preserves review-first writes and provides durable retry/audit when Google is unavailable | Browser-side or automatic two-way sync would expose credentials and create last-writer-wins conflicts |
