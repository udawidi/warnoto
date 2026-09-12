# Feature Specification: MTU KHS

**Feature Branch**: `002-mtu-khs`

**Created**: 2026-09-11

**Status**: Approved for implementation

**Input**: Replace Rencana Kedatangan with a scoped MTU KHS monitoring workspace backed by dedicated data, spreadsheet migration, drawing links, stock usage visibility, and master GI/Bay data.

## User Scenarios & Testing

### User Story 1 - Monitor MTU by organizational scope (Priority: P1)

Operational users monitor procurement, location, onsite, usage, installation, contract, and drawing status without combining spreadsheets manually.

**Why this priority**: A single trustworthy view is the main business outcome.

**Independent Test**: Sign in as UPT, UIT, and Pusat users and verify each sees the correct records and summary totals.

**Acceptance Scenarios**:

1. **Given** a UPT user, **When** the menu opens, **Then** only records owned by that UPT are visible.
2. **Given** a UIT user, **When** the menu opens, **Then** records from every child UPT and no other UIT are visible.
3. **Given** a mobile viewport, **When** records are viewed, **Then** key data and actions fit without horizontal page overflow.

### User Story 2 - Import and normalize legacy KHS data (Priority: P1)

PENGADAAN imports the 2024 and 2026 worksheets into a review queue before canonical records are created.

**Why this priority**: Existing operational history must be preserved and cleaned safely.

**Independent Test**: Import both worksheets, resolve required mappings, approve the batch, and compare accepted counts and values with the source.

**Acceptance Scenarios**:

1. **Given** the source workbook, **When** it is parsed, **Then** headers, displayed values, and hyperlinks are retained while formulas are not persisted.
2. **Given** unresolved UPT or installation-site mappings, **When** approval is attempted, **Then** promotion is blocked with row-level reasons.
3. **Given** duplicate candidates, **When** the batch is reviewed, **Then** they remain visible and are never removed automatically.

### User Story 3 - Update MTU through approval (Priority: P1)

PENGADAAN and TL UPT submit changes that become canonical only after the correct approver accepts them.

**Why this priority**: Location and contract data affect regulated operational decisions.

**Independent Test**: Submit changes from both roles and verify approval routing, immutability before approval, and audit history.

**Acceptance Scenarios**:

1. **Given** a TL UPT change, **When** submitted, **Then** ASMAN of the same UPT is required.
2. **Given** a PENGADAAN change, **When** submitted, **Then** ASMAN_LOG_UIT for the record's UIT is required.
3. **Given** a cross-UPT location reference, **When** submitted, **Then** the server rejects it.

### User Story 4 - Open exact drawings and compare stock usage (Priority: P2)

Users open the exact same-year drawing for a record and see usage from approved TUG separately from installed quantity.

**Why this priority**: Engineering documents and material accountability must be traceable.

**Independent Test**: Attach a 2024 PDF, link an approved TUG, and verify drawing availability and independent usage/installation totals.

**Acceptance Scenarios**:

1. **Given** a matching PDF, **When** Drawing is opened, **Then** the exact document URL opens.
2. **Given** only a 2024 document for a 2026 record, **When** viewed, **Then** the record says drawing is unavailable.
3. **Given** an approved TUG link, **When** viewed, **Then** usage is shown without changing stock or installed quantity.

### Edge Cases

- Empty or `-` organization/location values remain unresolved and do not create fake master rows.
- GI names associated with multiple ULTG require manual selection.
- Serialized and non-serialized allocations remain usable in one dataset.
- SUPERVISI rows remain reportable but do not count as physical quantity.
- Network or approval failure leaves canonical data unchanged and presents a retryable error.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST replace the visible Rencana Kedatangan menu with MTU KHS while retaining compatible internal route and permission identifiers.
- **FR-001a**: GI/Bay master management MUST be exposed under Master Data > Master GI & Bay, not as a duplicate tab inside the MTU KHS workspace.
- **FR-001b**: GI masters MUST be anchored directly to an existing UPT and use normalized-name uniqueness per UPT; Bay masters MUST use normalized-name uniqueness per GI.
- **FR-002**: The system MUST keep all new feature logic outside App.jsx, leaving only thin wiring there.
- **FR-003**: Every canonical MTU record MUST have one UPT owner linked to the existing UPT master.
- **FR-004**: UPT users MUST see one UPT, UIT users MUST see child UPTs, and Pusat/Super Admin MUST see all authorized data.
- **FR-005**: The system MUST reuse existing UIT, UPT, ULTG, supplier, warehouse, location, and catalog masters.
- **FR-006**: The system MUST provide scoped GI/GIS/GITET and Bay masters beneath ULTG and prevent deletion after transactional use.
- **FR-007**: The system MUST import Input KHS 2024 and Input KHS 2026 through staging and explicit review.
- **FR-008**: Import MUST preserve source values and hyperlinks, classify SUPERVISI as service, and retain duplicate candidates.
- **FR-009**: UPT and every non-empty installation-site label MUST resolve to either a GI/Bay or an existing warehouse before a staged row becomes canonical.
- **FR-010**: TL UPT and PENGADAAN changes MUST use the specified approval routes and retain an audit trail.
- **FR-011**: Location references MUST belong to the same UPT hierarchy as the record.
- **FR-012**: Usage MUST be derived only from approved TUG links and MUST NOT mutate stock.
- **FR-013**: Drawing availability MUST require an exact PDF matching vendor, procurement year, MTU code, and revision context.
- **FR-014**: The system MUST NOT attach a drawing from a different procurement year.
- **FR-015**: The UI MUST support desktop and 360 px mobile operation, light/dark themes, keyboard focus, loading, empty, and error states.
- **FR-016**: The legacy `pln_rencana_v1` data MUST not be shown or deleted.

### Key Entities

- **MTU Record**: Procurement allocation, UPT owner, hierarchy references, quantities, commercial fields, milestones, and operational status.
- **MTU Unit**: Optional serialized child of an MTU record.
- **GI**: Scoped installation-site master beneath one ULTG.
- **Bay**: Scoped master beneath one GI.
- **MTU Specification**: KHS code and optional reviewed catalog association.
- **Document**: Exact external document metadata and URL.
- **Usage Link**: Reference from an MTU allocation to an approved TUG item.
- **Change Request**: Proposed mutation, approver scope, decision, and audit data.
- **Import Batch/Row**: Source workbook audit, normalized candidate, mapping state, and validation issues.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Authorized users can find an MTU record and its current location in under 30 seconds.
- **SC-002**: Scope tests expose zero records outside the user's UPT or UIT.
- **SC-003**: The importer reports 719 raw worksheet rows for 2024 and 362 for 2026, then identifies 713 and 357 qualifying data records respectively after blank/summary classification.
- **SC-004**: All unresolved hierarchy conflicts are visible before approval and none are silently guessed.
- **SC-005**: No MTU update or usage-link action changes stock outside the existing approved TUG flow.
- **SC-006**: The primary mobile workflow completes at 360 px without horizontal page overflow or touch targets below 44 px.

## Assumptions

- WARNOTO becomes canonical after the initial approved migration; there is no two-way Sheet sync.
- Canonical records always belong to UPT, not directly to UIT.
- PENGADAAN has national MTU access; its approval target is derived from the record's UPT and UIT.
- A workbook spanning multiple UIT is partitioned into one approval batch per UIT.
- Drawing folders are navigation sources only; exact PDFs are indexed separately.
- Database migration is committed as a proposal but is not applied to production without user confirmation.
