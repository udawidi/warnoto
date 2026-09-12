# Data Model: MTU KHS

## Hierarchy

`uit -> upt -> ultg -> gardu_induk -> gardu_induk_bay -> mtu_khs_records`

Every MTU record stores `upt_id`. Optional lower-level references must resolve to that same UPT. UIT is always derived.

## Entities

- `gardu_induk`: id, non-null `upt_id`, `ultg_id`, non-null `normalized_name`, data, created_at. A `(upt_id, normalized_name)` unique key prevents duplicate GI names inside one UPT.
- `gardu_induk_bay`: id, `gardu_induk_id`, non-null `normalized_name`, data, created_at. A `(gardu_induk_id, normalized_name)` unique key prevents duplicate Bay names inside one GI.
- `mtu_khs_specs`: id, code, material_family, katalog_id, mapping_status, metadata.
- `mtu_khs_records`: allocation, owner UPT, GI/Bay or warehouse target, supplier/spec references, quantities, contract fields, milestones, lifecycle, service flag, original labels, version.
- `mtu_khs_units`: optional record child with serial number and unit-level state.
- `mtu_khs_documents`: vendor, year, MTU code, document type, revision, exact URL.
- `mtu_khs_record_documents`: exact record-to-document association.
- `mtu_khs_usage_links`: record-to-approved-TUG item reference and quantity snapshot.
- `mtu_khs_change_requests`: proposed patch, actor, required approver role/scope, decision, timestamps.
- `mtu_khs_import_batches`: file/sheet metadata, counts, status, actor and approval.
- `mtu_khs_import_rows`: batch row, raw values, normalized candidate, hyperlinks, validation and mapping state.
- `mtu_khs_sheet_sync_jobs`: one durable App-to-Sheet delivery job per approved change or usage update, with source tab/row identity, status, attempts, before/after values, error, and timestamps.

## Invariants

- Canonical `upt_id` is required.
- A non-empty source installation-site label must resolve to either `gardu_induk_id`/`bay_id` or existing `gudang_id`; warehouse/spare labels are never converted into fake GI masters.
- Referenced ULTG, GI, and Bay must be in the record UPT branch.
- Active referenced masters cannot be deleted; they can be disabled.
- `SUPERVISI` is excluded from physical quantity.
- Drawing year must equal procurement year.
- Usage links can target only approved TUG records and never change stock.
- Import identity is `file_sha256 + sheet_name + source_row_number + raw_row_sha256`. Repeating the same file/sheet returns the existing batch. Business duplicates remain reviewable and are not collapsed.
- Canonical tables expose authenticated SELECT only. Direct authenticated INSERT/UPDATE/DELETE is revoked.
- GI/Bay management lives in Master Data > Master GI & Bay (`garduInduk`); MTU KHS consumes these masters and does not render a duplicate management tab.
- Database records remain canonical. Google Sheets are an operational mirror; failed or conflicting delivery is retained for retry and never overwrites a canonical approval.
- The approved one-time seed is insert-only and provenance-tagged. It maps six UPT IDs (`UPT-BLI`, `UPT-GRS`, `UPT-MDN`, `UPT-MLG`, `UPT-PBG`, `UPT-SBY`) to 15 normalized ULTG, 82 GI, and 195 Bay. `GI 150KV KASIHJATIM` is explicitly assigned to `KRIAN`.
