# Quickstart: MTU KHS Verification

1. Apply the proposed migration only to an isolated test database.
2. Run the MTU unit and SQL contract tests.
3. Start WARNOTO on port 3001.
4. Verify UPT, UIT, Pusat, PENGADAAN, ASMAN, and ASMAN_LOG_UIT scenarios.
5. Import copies of the 2024 and 2026 worksheets and review mappings before commit.
6. Verify an exact 2024 drawing and confirm it is unavailable for a 2026 record.
7. Verify an approved TUG usage link without stock mutation.
8. Run mobile checks at 360 px and the production build.

## GI warehouse and TUG flow

Use an isolated database with the proposed GI warehouse migration applied. Do not create disposable transactions in production.

1. Create an active GI in Master GI & Bay. Confirm exactly one `GI-<id>` warehouse row and one `GILOK-<id>` location row exist with the GI's UPT, and neither appears in ordinary Master Gudang/Lokasi editing.
2. Receive one catalog item at the GI through TUG-3. Confirm its sole location is selected automatically, then complete TL/TUG-4/Asman approval. For a linked 2026 MTU receipt, confirm the server RPC accepts the location and applies the quantity once.
3. Return another item through TUG-10. Confirm its sole location is selected automatically, complete TL/Asman approval, reload, and confirm the stock has the correct UPT.
4. Issue part of the GI stock through TUG-8 or TUG-9. Confirm canonical final approval decreases only that stock once and does not report a location or UPT mismatch.
5. Sign in as a different UPT and confirm the GI stock is not readable or writable. Save an ordinary warehouse and location, then confirm the GI rows still exist.
6. Attempt to deactivate a GI with stock, an MTU record, or pending transaction; each attempt must fail. Deactivate an unused GI; it must disappear from new TUG choices while its adapter rows remain archived.
7. Before applying the migration, confirm a client build hides GI transaction choices rather than creating virtual-only transactions.
