# Quickstart Validation

1. Run targeted Node tests and build.
2. Run E2E Alat Berat at desktop, 360 px, and 768 px.
3. Run SQL migration in a rollback transaction with TEST data across two UPT.
4. Verify direct cross-UPT select/write denial and private storage denial.
5. Verify external checkout, inter-UPT pending approval, concurrent checkout, partial return, and reload.
6. Test HAR_UIT with `uit_id` and no `upt_id`: registry photos visible, owner UPT choices limited to the same UIT, only available cross-enabled assets selectable, borrower locked to HAR UIT, evidence required, and request pending owner Asman.
7. Verify HAR_UIT can read all in-UIT history but cannot read cross-UIT data or add/edit/approve/return.
8. Verify HAR_UIT without `uit_id`, spoofed UIT payload, non-cross asset, mixed owner, and orphan evidence cleanup paths are rejected safely.
9. Apply migration to self-host only after backup/preflight and explicit approval.
10. Verify PostgREST schema reload and perform no-op production reads before deploying the frontend.

Expected: no client success before RPC success; cache deletion does not remove canonical data.

## Production Release Gate

Do not deploy the frontend before the database contract is active. After explicit approval and a fresh backup, apply the migration with `ON_ERROR_STOP=1` in one transaction through `ssh minipc-gudang` and `docker exec -i supabase-db psql`, then run `supabase/verify_har_uit_heavy_equipment.sql` and read-only row-count checks before pushing `main`.

Rollback restores the previous heavy-equipment policies and RPC bodies from `20260920_heavy_equipment_upt_id_loans.sql` followed by `20260920b_heavy_equipment_quantity_pools.sql`. Keep `requester_uit_id` if any HAR loan exists; dropping the column after live use would destroy audit identity. Frontend rollback must happen after the database contract is restored.
