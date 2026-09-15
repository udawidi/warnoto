# Research: Penilaian Matlev Dua Jenis Gudang

## Source workbook

- Sheet `PROGNOSA`, rows 6–48, contains 32 aspect IDs.
- Column J supplies evidence requirements; column K supplies notes.
- Column V applies to Gudang Persediaan; column X applies to Gudang ATTB/MRWI; `N/A` excludes an aspect.
- Applicability count: Persediaan 28, ATTB/MRWI 8.
- Shared aspects: 3.4, 4.3, 4.4, 5.2.
- ATTB/MRWI-only aspects: 3.5, 3.6, 3.7, 5.4.
- Remaining aspects are Persediaan-only.
- Source scoring example confirms 75/25 weighting.

## Decisions

- Keep current aspect titles and scoring rubrics; update only evidence and notes from J/K.
- Keep one audit row per UPT/period and evolve JSON instead of adding tables/columns.
- Use typed aspect IDs for evidence/reviews to avoid collisions without schema changes.
- Normalize legacy audits automatically; shared legacy content belongs to Persediaan only.
- Remove only manual Drive scan/assignment; retain application-originated evidence lifecycle.
- Remove Mode Demo entirely and clear the stale browser flag once.

## Alternatives rejected

- Separate audit rows per warehouse: breaks the existing workflow uniqueness contract and requires schema/workflow changes.
- Duplicate shared legacy evidence into both warehouses: creates false evidence and review state.
- Replace the Excel template: unnecessary and risks losing formulas/layout.
- Add a new dependency: existing platform and libraries are sufficient.

