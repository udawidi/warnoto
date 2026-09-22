# Quickstart: Optional Stock Opname Photos

## Local checks

```powershell
rtk node --test tests/unit/stockOpnameRequiredPhoto.test.mjs tests/unit/stockOpnamePhotoSecurity.contract.test.mjs
rtk npx playwright test tests/e2e/opname-lapangan.spec.js --project=phone-360 --workers=1
rtk npm run build
```

Expected behavior:

1. Count all material and leave both photo inputs empty.
2. Submit from Rekonsiliasi; status becomes `PENDING_ASMAN`.
3. Approve as ASMAN; status becomes `SELESAI`.
4. Repeat with a supplied photo; verify it remains storage-backed and appears on Data Stok/Kartu Gantung.

## Production checks

1. If preflight reports missing policy/constraint objects, obtain explicit user approval for the prerequisite schema/security rollout.
2. Back up the production `vps-dr-stack/supabase-db` database.
3. Apply existing `supabase/migrations/20260919_stock_opname_photo_security.sql` atomically with `ON_ERROR_STOP=1`; run its verifier.
4. Apply existing `supabase/migrations/20260919_stock_opname_photo_data_constraint.sql` atomically with `ON_ERROR_STOP=1`.
5. Apply `supabase/migrations/20260922_stock_opname_optional_photo.sql` atomically with `ON_ERROR_STOP=1`.
6. Run `supabase/verify_stock_opname_optional_photo.sql`.
7. Run a read-only/rollback transaction smoke; do not mutate business rows.
