# Contract: Maturity Audit V2

## Client persistence contract

- Continue using the existing `maturity_audits` record and workflow fields.
- Store audit content with `formatVersion: 2` and both warehouse buckets.
- Keep combined `score` and `level` at the existing top level for downstream compatibility.

## Evidence/review identity contract

- Pass `${warehouseType}::${aspectId}` to existing evidence and review persistence functions.
- Do not change database column types, primary keys, or Edge Function request schemas.
- Existing raw aspect IDs are interpreted as legacy and normalized in memory.
- Normal evidence item IDs remain stable and are used for their own folder/upload/review flow. Manual criteria are display-only and have no item ID, folder, stored status, or review row.
- The 10 separate document items are 2.1a-b, 2.5a-b, 3.6 clusters 1-4, and 5.1a-b. The two 2.5 items are an alternative path; one is sufficient.
- Legacy aliases are read-only compatibility mappings. No additional folders are created for manual criteria and no child-status field is part of the contract.
- A review row is current only when its `reviewedAt` is at least the latest relevant file timestamp.

## Excel export contract

```js
buildMaturitySheetExport({
  scoresByWarehouse: {
    PERSEDIAAN: { "1.1": 4 },
    ATTB_MRWI: { "3.4": 3 }
  },
  tahun,
  namaUpt
})
```

- Write Persediaan scores only to template column X.
- Write ATTB/MRWI scores only to template column Y.
- Preserve formula cells and N/A/blank applicability cells.

## Compatibility contract

- No schema, RLS, dependency, or Edge Function deployment changes.
- Existing application-originated upload/load/open/download/unlink/backfill remains supported.
- Manual Drive scan and assignment are no longer exposed by the client.
