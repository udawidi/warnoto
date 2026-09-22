# Requirements Checklist

- [x] SAP, physical, and WARNOTO are compared per catalog.
- [x] Non-SAP compares physical and WARNOTO only.
- [x] Every discrepant material requires its own note.
- [x] Approval does not mutate active stock quantity.
- [x] Latest SAP baseline is stored per catalog and UPT.
- [x] Approval validation uses the locked pending snapshot.
- [x] Optional TUG reference is role-gated and post-completion only.
- [x] RPC finalizes only after all guards and metadata writes.
- [x] Read-only verifier and rollback proposal added.
- [x] Existing migrations untouched; new migration is proposal-only.
- [x] No `schema.sql` blob added because function is migration-only in this project.
- [x] Focused tests added.
- [x] Full tests/build/diff-check run.
- [x] Qty Fisik hanya dapat ditulis ADMIN/TL/SUPERADMIN pada UI, hook, dan database.
- [x] Penolakan Asman tetap berjalan melalui RPC setelah RLS diperketat.
- [x] Backfill hanya menyentuh baseline stok UPT-SBY dari approval 2026-09-22 WIB.
- [x] Hash dan catatan dokumen opname target tidak berubah setelah backfill.
