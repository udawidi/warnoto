# RPC Contracts

## `checkout_heavy_equipment_batch`

Input: equipment ID array, borrower JSON, job/date JSON, pickup evidence path. Server derives owner, actor, status, snapshots, IDs, and batch ID.

Output: `{ batchId, loans, equipment }`.

Failure is atomic for unauthorized actor, mixed owner, unavailable asset, invalid dates, missing evidence, or malformed borrower.

Cabang TL tetap mensyaratkan owner UPT sama dengan `profiles.upt_id` dan tidak dapat mengirim identitas HAR_UIT.

Cabang HAR_UIT mensyaratkan:

- profil memiliki role `HAR_UIT` dan typed `uit_id`;
- payload memiliki `borrowerType = HAR_UIT` serta `borrowerUitId` yang sama dengan profil;
- seluruh aset memiliki satu owner UPT dalam UIT akun, tersedia, dan flag lintas-UPT aktif;
- evidence path memakai prefix owner UPT tersebut.

Server menulis `requester_upt_id = null`, `requester_uit_id = profiles.uit_id`, snapshot requester `HAR UIT <nama/kode>`, `requestedBy = auth.uid()`, dan status pending approval Asman owner. Signature RPC tidak berubah.

## `checkout_heavy_equipment_batch_v2`

Kontrak otorisasi dan requester sama dengan RPC batch biasa, ditambah validasi quantity pool existing. Signature RPC tidak berubah.

## `approve_heavy_equipment_batch`

Input: loan ID. Server resolves full batch. Only Asman owner may approve/reject pending inter-UPT loans.

Output: updated loans and equipment.

## `complete_heavy_equipment_batch`

Input: loan ID array, return evidence path, condition note. Only TL owner may return active loans. Subset is allowed.

Output: updated selected loans and equipment.

## Registry

Registry upsert carries typed `upt_id` and is accepted only for TL with exact matching profile UPT. Client names never grant access.

HAR_UIT dapat membaca registry UPT dalam UIT yang sama. Hanya aset tersedia dengan flag lintas-UPT aktif yang dapat dipilih untuk checkout. HAR_UIT tidak mendapat hak insert, update, atau delete registry.

## Loan dan Evidence Read

HAR_UIT dapat membaca loan bila owner UPT atau requester UPT berada dalam UIT profil, atau `requester_uit_id` sama dengan UIT profil. Evidence mengikuti scope loan yang sama. Upload evidence HAR_UIT dibatasi ke prefix owner UPT dalam UIT; delete hanya untuk objek orphan buatan aktor yang belum direferensikan loan.
