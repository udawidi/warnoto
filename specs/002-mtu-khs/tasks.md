# Tasks: MTU KHS

**Input**: Design documents from `/specs/002-mtu-khs/`

## Phase 1: Setup

- [x] T001 Create the feature module under `src/features/mtu-khs/` and keep `App.jsx` wiring-only
- [x] T002 Add unit tests for normalization, physical quantity, import identity, scope, and drawing-year rules in `tests/unit/mtuKhs.test.mjs`

## Phase 2: Foundation

- [x] T003 Add proposed MTU/GI/Bay schema, RLS, validation, indexes, and RPCs in `supabase/migrations/20260911_mtu_khs.sql`
- [x] T004 Add SQL contract tests proving direct DML denial, PENGADAAN/UPT/UIT/Pusat scope, approval routing, row locking, atomic decisions, hierarchy validation, and import retry idempotency
- [x] T005 Implement shared model constants and pure validators in `src/features/mtu-khs/mtuKhsModel.js`
- [x] T006 Implement scoped Supabase queries and mutation calls in `src/features/mtu-khs/mtuKhsApi.js`

## Phase 3: Monitor and update MTU (US1, US3)

- [x] T007 [US1] Build responsive monitor, KPI, filters, table/card list and states in `src/features/mtu-khs/MtuKhsTab.jsx`
- [x] T008 [US1] Build record detail tabs for location, usage, installation, drawing, contract and history
- [x] T009 [US3] Build role-aware change form and pending approval presentation
- [x] T010 [US1] Relabel and mount MTU KHS through thin changes in `App.jsx`

## Phase 4: Import and master mapping (US2)

- [x] T011 [US2] Implement 2024/2026 workbook parser and validation in `src/features/mtu-khs/mtuKhsImport.js`
- [x] T012 [US2] Build per-UIT staging review for GI/Bay or warehouse targets, duplicates, supplier, spec and catalog mappings
- [x] T013 [US2] Add scoped GI/Bay management to the MTU feature or Master Data with row-level writes

## Phase 5: Drawing and usage (US4)

- [x] T014 [US4] Implement exact same-year document registry and record attachment UI
- [x] T015 [US4] Implement approved-TUG usage links as read-only stock references

## Phase 6: Validation

- [x] T016 Run unit tests and fix failures
- [x] T017 Run mobile audit/card-collapse checks and fix regressions
- [x] T018 Run production build and inspect final diff for App.jsx bloat, security, and unrelated changes

## Phase 7: Master data consolidation (revised plan)

- [x] T019 Move GI/Bay management out of MTU KHS into the Master Data `garduInduk` subtab, reusing `MtuKhsMasterPanel`.
- [x] T020 Add typed GI scope (`upt_id`, `normalized_name`) and deterministic Bay name uniqueness to the proposed MTU migration; use direct UPT scope in RLS/RPCs.
- [x] T021 Add the insert-only, idempotent 20260912 master seed migration with provenance from the approved Google Sheet export (15 ULTG, 82 GI, 195 Bay).
- [x] T022 Extend contract tests and feature artifacts for the revised master scope, UPT mapping, Kasihjaitm/KRIAN exception, and hierarchy uniqueness.
- [x] T023 Re-run focused tests, production build, mobile-card audit checks, and diff hygiene checks.
- [x] T024 Correct Master Gardu Induk UX to a single cascading UIT → UPT → ULTG → GI → Bay hierarchy; Bay is always scoped to its GI.

## Phase 8: Complete GI/Bay source consolidation

- [x] T025 Replace the partial seed source with `D:\CLAUDE\WARNOTO data\Data Material HAR\BAY GI.xlsx`, sheet `3a. BAY`: 2,429 raw rows, 185 GI, 2,427 Bay, 15 ULTG, and 6 UPT.
- [x] T026 Add the pure workbook transform and deterministic, idempotent additive migration generator in `scripts/generate_mtu_gi_bay_seed.mjs`; preserve legacy rows and source provenance, deduplicate exact pairs, and retain duplicate external IDs as separate Bays.
- [x] T027 Mark `TIDAK OPERASI` Bays inactive while retaining source status and rows; pin the NGIMBANG hierarchy anomaly to ULTG BABAT.
- [x] T028 Filter inactive GI/Bay rows from the MTU master loader and add focused transform tests for counts, deduplication, blank IDs, status, and hierarchy.
- [x] T029 Run focused tests, full build, diff hygiene, and graphify update after implementation.

## Phase 9: Legacy MTU record migration

- [x] T030 Correct workbook column selection and data-row qualification so the source yields exactly 713 records for 2024 and 357 for 2026 without dropping incomplete business rows.
- [x] T031 Add focused parser tests for ambiguous material headers, footer exclusion, source-row preservation, and the missing-code review blocker.
- [x] T032 Produce a read-only mapping audit against production UPT, ULTG, GI, Bay, warehouse, supplier, specification, and catalog masters; never guess ambiguous matches or create masters automatically.
- [x] T033 Propose a follow-up migration that enforces the same hierarchy and blocker rules in stage, mapping update, and commit RPCs without promoting any canonical record.
- [ ] T034 Generate deterministic per-UIT review batches with real file and row hashes, source provenance, duplicate candidates, and a reversible staging procedure.
- [ ] T035 Run focused tests, build, mapping audit, production backup verification, and confirm canonical MTU records remain empty before requesting approval to apply the hardening migration and stage data.

## Dependencies

- T003-T006 block feature UI and writes.
- T007-T010 deliver the monitor independently.
- T011-T013 depend on master and API foundation.
- T014-T015 depend on record detail and API foundation.
- T016-T018 run after implementation tasks.
