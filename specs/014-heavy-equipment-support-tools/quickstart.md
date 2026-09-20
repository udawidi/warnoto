# Quickstart Validation

1. Run targeted Node tests and build.
2. Run E2E Alat Berat at desktop, 360 px, and 768 px.
3. Run SQL migration in a rollback transaction with TEST data across two UPT.
4. Verify direct cross-UPT select/write denial and private storage denial.
5. Verify external checkout, inter-UPT pending approval, concurrent checkout, partial return, and reload.
6. Apply migration to self-host only after backup/preflight and explicit approval.
7. Verify PostgREST schema reload and perform no-op production reads before using real records.

Expected: no client success before RPC success; cache deletion does not remove canonical data.
