# Feature Specification: Optional Stock Opname Photos

**Feature Branch**: `021-optional-opname-photos`  **Created**: 2026-09-22  **Status**: Ready for implementation

## User Scenarios & Testing

### User Story 1 - Submit counted material without a photo (Priority: P1)

An ADMIN or TL completes a Stock Opname count and submits it to the ASMAN even when no photo was captured.

**Why this priority**: Photo capture is not always possible in the field; it must not block the core audit workflow.

**Independent Test**: Complete all required counts and explanations, leave both photo fields empty, submit from Rekonsiliasi, and observe `PENDING_ASMAN`.

**Acceptance Scenarios**:

1. **Given** every material is counted and the session is in Rekonsiliasi, **When** the user submits with no photos, **Then** the session is saved as `PENDING_ASMAN`.
2. **Given** a positive physical quantity and no photo, **When** the user submits, **Then** no photo-required validation error is shown.

### User Story 2 - Preserve supplied photos (Priority: P2)

A user optionally captures one or both Stock Opname photos and the system retains them through draft save, submit, and ASMAN approval.

**Why this priority**: Optional must not mean discarded; supplied evidence remains useful for Data Stok and Kartu Gantung.

**Independent Test**: Save a session with a photo, submit it, approve it as ASMAN, and confirm the stored photo is available on the resulting stock record.

**Acceptance Scenarios**:

1. **Given** a photo is selected, **When** the draft or submit is saved, **Then** the photo is normalized to the Stock Opname storage bucket before persistence.
2. **Given** a normalized photo exists at approval, **When** ASMAN approves, **Then** Data Stok receives the photo and Kartu Gantung receives the opname history date.

### User Story 3 - Keep photo security fail-closed (Priority: P1)

The system rejects unsafe photo values while allowing empty optional fields.

**Why this priority**: Removing a required field must not reintroduce data URL persistence or bypass storage boundaries.

**Independent Test**: Attempt to submit a data URL or fail a storage upload and verify that the operation is rejected without persisting the unsafe value.

**Acceptance Scenarios**:

1. **Given** a photo field contains a `data:` URL, **When** save, submit, or approve normalizes the session, **Then** the operation fails and the data URL is not persisted.
2. **Given** storage upload fails, **When** a supplied photo is saved, **Then** the operation fails closed and the workflow status remains unchanged.

### User Story 4 - Submit SAP count without Non-SAP child work (Priority: P1)

An ADMIN or TL completes the SAP Stock Opname flow and submits it to the ASMAN without creating or completing the optional Non-SAP child session.

**Why this priority**: SAP reconciliation must not be blocked by additional optional material review.

**Independent Test**: Complete the SAP session, leave the Non-SAP child unopened, submit and verify `PENDING_ASMAN`; any existing child draft remains separate and is not included in the SAP output.

**Acceptance Scenarios**:

1. **Given** SAP items are 100% counted and the session is in Rekonsiliasi, **When** the user has not opened Non-SAP input, **Then** the user can submit SAP to ASMAN.
2. **Given** a Non-SAP child is `DRAFT` or `PENDING`, **When** SAP output is prepared, **Then** the child is not included until its own flow is completed.

## Edge Cases

- Both photo fields are empty for every item; submit and approval remain available.
- Only one photo field is supplied; the supplied field is preserved and the empty field remains empty.
- A legacy session already contains a stored URL; it remains readable and is not removed.
- A legacy session contains a data URL; save/submit/approval rejects it until normalized.
- Realtime or server save failure does not advance the status or discard the previous local session.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST allow a fully counted Stock Opname with no photos to be submitted to `PENDING_ASMAN`.
- **FR-002**: The system MUST allow ASMAN approval of a fully counted Stock Opname with no photos.
- **FR-003**: The system MUST keep both Stock Opname photo inputs available and label them as optional.
- **FR-004**: The system MUST normalize any supplied `data:` photo through the existing Stock Opname storage uploader before save, submit, or approval.
- **FR-005**: The system MUST fail closed when photo normalization or storage upload fails.
- **FR-006**: The system MUST reject persistence of `data:` photo URLs while retaining the existing database constraint, storage policies, RLS, and approval RPC contract.
- **FR-007**: The system MUST continue updating Data Stok and Kartu Gantung when a normalized photo is supplied at approval.
- **FR-008**: The database MUST stop enforcing the retired required-photo trigger without dropping its helper functions or changing the approval RPC signature.
- **FR-009**: The SAP Stock Opname flow MUST allow submit and ASMAN approval after SAP completion without requiring a Non-SAP child session.
- **FR-010**: The UI MUST identify Non-SAP input as optional while preserving the existing child creation and review workflow.
- **FR-011**: Non-SAP child sessions in `DRAFT` or `PENDING` MUST remain separate and MUST NOT be included in SAP output.

### Key Entities

- **Stock Opname session**: Counted material items, quantities, optional photo references, status, and approval metadata.
- **Stock photo reference**: A storage-backed URL or path for `fotoKeseluruhan` or `fotoNameplate`; empty is valid.
- **Data Stok row**: The approved stock record that may receive supplied photos and opname history.
- **Kartu Gantung history**: The approved opname date/history entry attached to the stock record.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of valid fully counted sessions without photos can reach `PENDING_ASMAN` in focused tests.
- **SC-002**: 100% of valid fully counted sessions without photos can reach `SELESAI` through ASMAN approval in focused tests.
- **SC-003**: 100% of supplied photos are normalized before persistence, and 0 new `data:` photo URLs are accepted.
- **SC-004**: Existing photo-enabled approval behavior continues to update Data Stok and Kartu Gantung in focused and E2E coverage.
- **SC-005**: Production verifier reports the retired required-photo trigger absent while anti-dataURL constraint, storage policies, and approval RPC/grants remain present.
- **SC-006**: 100% of focused SAP sessions can submit without opening a Non-SAP child, and incomplete child sessions do not alter SAP output.

## Assumptions

- Quantity completion, recount, location, and discrepancy explanation rules remain unchanged.
- Existing storage bucket, RLS, storage policies, and approval RPC are reused.
- Production migration is applied only after local tests/build and a production backup succeed.
- Production rollout may require explicit approval to apply the existing Stock Opname photo security and anti-dataURL migrations first when preflight shows those production objects are missing.
- `HANDOFF.md` is updated only by the parent agent after explicit user approval.

## Out of Scope

- Removing photo storage, photo inputs, storage policies, RLS, or the approval RPC.
- Editing the existing required-photo migration or dropping its helper database functions.
- Changing Stock Opname quantity, recount, UPT scope, approval, Data Stok, or Kartu Gantung business rules.
