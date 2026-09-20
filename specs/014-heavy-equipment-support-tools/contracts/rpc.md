# RPC Contracts

## `checkout_heavy_equipment_batch`

Input: equipment ID array, borrower JSON, job/date JSON, pickup evidence path. Server derives owner, actor, status, snapshots, IDs, and batch ID.

Output: `{ batchId, loans, equipment }`.

Failure is atomic for unauthorized actor, mixed owner, unavailable asset, invalid dates, missing evidence, or malformed borrower.

## `approve_heavy_equipment_batch`

Input: loan ID. Server resolves full batch. Only Asman owner may approve/reject pending inter-UPT loans.

Output: updated loans and equipment.

## `complete_heavy_equipment_batch`

Input: loan ID array, return evidence path, condition note. Only TL owner may return active loans. Subset is allowed.

Output: updated selected loans and equipment.

## Registry

Registry upsert carries typed `upt_id` and is accepted only for TL with exact matching profile UPT. Client names never grant access.
