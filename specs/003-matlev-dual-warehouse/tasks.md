# Tasks: Penilaian Matlev Dua Jenis Gudang

## Phase 1: Data and contracts

- [X] T001 Add warehouse applicability plus source-column J/K evidence text to audit aspect definitions.
- [X] T002 Add pure warehouse-key, legacy-normalization, and weighted-scoring helpers with focused tests.
- [X] T003 Update maturity audit state and persistence to use version 2 while preserving FINAL immutability.

## Phase 2: Evidence, review, and AI isolation

- [X] T004 Use typed warehouse/aspect IDs across evidence upload/load/unlink and review persistence.
- [X] T005 Keep automatic evidence operations and 5S backfill while removing manual Drive sync/assignment.
- [X] T006 Isolate AI analysis by warehouse type.

## Phase 3: UI and exports

- [X] T007 Add accessible responsive warehouse tabs and applicable-aspect filtering.
- [X] T008 Show both warehouse subtotals and the combined weighted result.
- [X] T009 Update PDF/PPT/Excel outputs to distinguish warehouse types and patch Excel X/Y separately.

## Phase 4: Dead feature removal

- [X] T010 Remove Mode Demo TUG menu/banner and all production demo guards.
- [X] T011 Clear stale `warnoto_demo` browser state and remove the obsolete demo module/CSS.

## Phase 5: Verification

- [X] T012 Update contract and E2E tests affected by the new data model and demo removal.
- [X] T013 Run focused tests and production build.
- [X] T014 Run desktop/mobile browser smoke tests and refresh the graph index.
- [X] T015 Validate the current-month Form 5S from the Persediaan assessment regardless of the active warehouse tab.

## Phase 6: Evidence structure and audit presentation

- [X] T016 Classify PROGNOSA requirements into 19 checker-only `manualCriteria` and 10 normal document evidence items.
- [X] T017 Keep manual criteria display-only; remove stored child status, child review rows, and child-folder assumptions from the v2 contract.
- [X] T018 Implement separate normal evidence items for 2.1a-b, 2.5a-b, 3.6 clusters 1-4, and 5.1a-b; support 2.5 as an alternative path.
- [X] T019 Preserve read-only legacy aliases and ensure legacy data is not expanded into new child folders or stored child status.
- [X] T020 Render long evidence notes as compact, structured checker guidance while preserving source meaning and manual verification.
- [X] T021 Verify evidence coverage, review gates, unit tests, build, and desktop/mobile smoke after the redesign.
