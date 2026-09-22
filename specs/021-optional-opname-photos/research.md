# Research: Optional Stock Opname Photos

## Findings

1. The active client required-photo gates are in `OpnameLapanganView.jsx`, `StockOpnameTab.jsx`, and `useStockOpname.js`.
2. `normalizeOpnamePhotos` already handles both photo fields and uploads only `data:` values with the session UPT; it must remain on save, submit, and approval.
3. `isValidOpnamePhotoUrl` and `missingRequiredOpnamePhotos` have no legitimate caller after the gates are removed and can be deleted from the production helper.
4. `20260921_stock_opname_required_photo.sql` creates the trigger and helper functions. The safe forward change is to drop only the trigger; historical migration text remains untouched and helper functions remain available.
5. `20260919_stock_opname_photo_data_constraint.sql` rejects new data URLs, while `20260919_stock_opname_asman_approval_rpc.sql` remains the transactional approval contract.

## Decisions

- Empty photo fields are valid at draft save, submit, and approval.
- Supplied photos continue through the existing uploader and Data Stok/Kartu Gantung update path.
- No dependency or schema-table change is needed.
- Production apply is gated by local verification and backup.

## Production preflight (2026-09-22)

- Self-host production currently reports the required-photo trigger present, zero legacy data URLs, and the approval RPC present.
- Self-host production does not report `stock_opname_data_no_photo_data_url`; this differs from the rollout contract and blocks migration apply until the database state is reconciled by the parent/architect.
- Self-host production also reports zero rows for the newer named Stock Opname storage write policies; only legacy `Public upload/update/read stock-photos` policies are present. The approval RPC and authenticated grant are present.

## Required production prerequisite sequence

Because the preflight found missing security objects, the optional-photo migration must not be applied alone. After explicit user approval, the parent agent must:

1. Back up `vps-dr-stack/supabase-db`.
2. Apply existing `20260919_stock_opname_photo_security.sql` atomically and run its verifier.
3. Apply existing `20260919_stock_opname_photo_data_constraint.sql` atomically; it must report zero legacy data URLs.
4. Apply new `20260922_stock_opname_optional_photo.sql` atomically.
5. Run `verify_stock_opname_optional_photo.sql` and a rollback-only DB smoke transaction.

These existing migrations are not edited by this feature. User approval was received for this rollout, and the prerequisite sequence plus optional-photo migration completed successfully on 2026-09-22.
