# Implementation Plan: Penilaian Matlev Dua Jenis Gudang

**Branch**: `main` | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md)

## Summary

Evolve the existing maturity audit JSON to an in-memory-compatible version 2 with two warehouse assessment buckets. Reuse current audit rows, Drive metadata, review tables, templates, and UI patterns. Remove obsolete demo and manual Drive-sync paths. No schema or dependency changes.

## Technical Context

**Language/Version**: JavaScript/JSX, React, Vite 4  
**Primary Dependencies**: Existing React, Supabase client, XLSX/export libraries  
**Storage**: Existing `maturity_audits` JSON plus evidence/review tables  
**Testing**: Node test runner, Playwright, Vite build  
**Target Platform**: Responsive web, minimum 360 px viewport  
**Constraints**: No database migration, no Edge Function deploy, FINAL audits immutable, production save paths preserved

## Constitution Check

Project constitution is an unfilled template. Binding project rules from AGENTS.md and HANDOFF.md govern this change: review-first workflow, no schema execution without approval, mobile usability, minimum diff, and explicit release stages.

## Project Structure

```text
src/
├── components/          # Maturity UI and app overlays/header
├── data/                # Audit aspect source definitions
├── hooks/               # Audit normalization, state, scoring, persistence
└── lib/                 # Evidence, AI, export, sync helpers
tests/
├── unit/                # Contract and scoring/normalization tests
└── e2e/                 # Browser regression checks
```

## Implementation Strategy

1. Add warehouse applicability and exact source J/K text to existing aspects.
2. Add small pure helpers for typed IDs, legacy normalization, and weighted scoring; cover them with unit tests.
3. Adapt `useMaturity` and evidence/review/AI callers to the normalized warehouse state without altering database schema.
4. Add accessible responsive warehouse tabs and warehouse-aware summaries/exports.
5. Remove demo and manual Drive-sync UI/guards while retaining automatic evidence operations.
6. Update tests, build, graph index, and browser-smoke both desktop and 360 px.

## Evidence presentation and classification

Evidence text is normalized into short headings and readable nested lines so the audit card does not render one long paragraph. The source meaning remains unchanged.

- 19 manual criteria are shown as a read-only “Yang diperiksa” section for the checker. They do not create status fields, review rows, or completion gates.
- 10 true document requirements are ordinary evidence items with their own upload/review/folder behavior: 2.1 (2), 2.5 (2), 3.6 (4), and 5.1 (2).
- 2.5 is an alternative path: one of the two artifacts is sufficient (ND/Surat kegiatan or photo activity).
- Legacy aliases remain read-only compatibility mappings. No additional folders are created for manual criteria.

This presentation reuses the existing evidence flow and adds no schema, dependency, or Edge Function.

## Risk Controls

- Preserve FINAL immutability; normalization alone never writes.
- Shared legacy data maps only to Persediaan to prevent duplication.
- Typed aspect IDs are used only at persistence boundaries; human-facing IDs remain unchanged.
- Current Excel template formulas/N/A cells remain authoritative.
- Remove demo guards at shared call sites so no production write silently short-circuits.
