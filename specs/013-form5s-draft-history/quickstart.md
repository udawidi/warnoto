# Quickstart verification

1. Apply the proposal migration to a test database only.
2. Login as TL, fill partial Form 5S, add a photo, then save draft.
3. Reload and verify all fields plus photo count return.
4. Login as another account/UPT and verify the draft is absent.
5. Finalize the audit and verify it appears in history while the draft disappears.
6. Open history on mobile: confirm Detail Audit and Cetak/PDF are visible and no photo request occurs before Detail Audit.
7. Run `npm test` and `npm run build`.
