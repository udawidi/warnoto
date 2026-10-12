# Quickstart: TUG MARA Posting Guard

## Automated

```powershell
npm test
npm run build
```

Run the feature contract test and SQL verifier added by this feature.

## Manual Validation

1. Create one TUG-3 and one TUG-10 with a valid MARA code; approve through Asman and confirm stock increases once.
2. Repeat with a missing MARA code; confirm final approval fails and no table changes.
3. Use a code with leading zeros; confirm it resolves to the same MARA material.
4. Submit wrong manual name/unit with a valid code; confirm posted stock and Master Katalog use MARA values.
5. Retry the same approval; confirm qty is unchanged after the first success.

Production migration and smoke test require explicit user approval.
