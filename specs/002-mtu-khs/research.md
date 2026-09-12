# Research: MTU KHS

## Decisions

- Existing `uit`, `upt`, and `ultg` already model the organization hierarchy.
- Existing `supplier` is national and can represent material and installation providers.
- Existing katalog/MARA remains the material identity source; MTU specification mapping requires review.
- New GI and Bay masters are necessary. Source data has 116 GI labels in 2024, 84 in 2026, and several conflicting GI-to-ULTG mappings.
- `syncMasterTable()` reconciliation is unsafe for scoped subsets. GI/Bay use row-level upsert/delete operations or RPCs.
- Existing `can_access_upt()` must remain unchanged. MTU uses a feature-specific scope helper for PENGADAAN.
- Canonical tables are authenticated SELECT-only. Approval cannot be bypassed through direct REST writes; changes use SECURITY DEFINER RPCs with row locks, versions, and idempotency keys.
- Labels such as warehouse/spare locations map to existing `gudang`, not fake GI rows.
- Raw worksheet extents are 719 rows for 2024 and 362 for 2026; after excluding blank/summary rows, qualifying records are 713 and 357.
- Google Drive folders do not prove an exact drawing attachment. Store exact PDF metadata and forbid cross-year fallback.
- Mobile layout follows `docs/DESIGN_GUIDELINES.md`: CSS-first breakpoints, OperationsHero, mobile-card-table, existing tokens and actions.
- Approved master source is Google Sheet `1P4uzA61kt5-B8SejwifQqQAmziDY5E3kPAKcXAFBI7g`, tab `Lapor UPT DISESUSAIKAN`, gid `2023228375`. One-time normalization strips an optional `ULTG` prefix and collapses uppercase whitespace.
- Final seed scope is six existing UPT IDs, 15 normalized ULTG, 82 GI, and 195 GI/Bay pairs. `GI 150KV KASIHJATIM` is resolved to `ULTG KRIAN`; no other GI has a conflicting ULTG after normalization.
- GI/Bay management is exposed under Master Data > Master GI & Bay and reuses the existing `MtuKhsMasterPanel`; the MTU KHS workspace retains monitoring/import/approval only.
- The seed migration is insert-only, idempotent by deterministic IDs and normalized-name lookups, and stores source provenance in both a seed-run record and seeded row metadata. It never deletes or auto-syncs.
