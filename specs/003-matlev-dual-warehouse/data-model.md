# Data Model: Penilaian Matlev Dua Jenis Gudang

## Persisted audit JSON version 2

```json
{
  "formatVersion": 2,
  "warehouseAssessments": {
    "PERSEDIAAN": {
      "aspekScores": {},
      "evidence": {},
      "aiAnalysis": {}
    },
    "ATTB_MRWI": {
      "aspekScores": {},
      "evidence": {},
      "aiAnalysis": {}
    }
  },
  "score": 0,
  "level": ""
}
```

Existing workflow fields remain unchanged. Top-level `score` and `level` represent the combined result.

## Warehouse types

- `PERSEDIAAN`: 28 applicable aspects; weighted 75%.
- `ATTB_MRWI`: 8 applicable aspects; weighted 25%.

## Typed persistence key

`<warehouseType>::<aspectId>`

Examples:

- `PERSEDIAAN::3.4`
- `ATTB_MRWI::3.4`

The key is stored in existing text fields for Drive evidence and review rows. No schema change is needed.

## Legacy normalization

- Exclusive aspect → sole applicable warehouse.
- Shared aspect → Persediaan only.
- Missing buckets → empty objects.
- Read normalization is pure and does not persist.
- Active audits serialize as version 2 on the next legitimate edit/save.
- FINAL audits remain unchanged in storage when merely viewed.

## Evidence classification

Each aspect may expose a compact `manualCriteria` array for checker-only reading. These 19 criteria are display-only and have no persisted completion state. A requirement that needs its own document is represented as a normal `requiredEvidence` item. There are 10 such items: 2.1a-b, 2.5a-b, 3.6 clusters 1-4, and 5.1a-b. The two 2.5 items are alternative paths; either one satisfies the requirement.

## Validation invariants

- Only applicable aspects participate in completion and scores.
- Evidence/review lookup for shared aspects always includes warehouse type.
- 5S evidence is only associated with `PERSEDIAAN::4.5`.
- Each normal evidence item requires at least one file, except alternative-path items where one member of the path is sufficient.
- UIT review rows are current only when `reviewedAt >= latest relevant file timestamp`.
- Legacy files without `itemId` remain usable through their read-only alias mapping; no child status is synthesized.
- Multiple files on one parent never satisfy another missing parent.
