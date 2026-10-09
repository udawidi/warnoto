# RPC Contract: Operasional MTU KHS

## `mtu_khs_update_operational`

Input: `p_record_id`, `p_expected_version`, `p_patch`, `p_idempotency_key`.
Patch whitelist: `katalogId`, `lifecycleStatus`, `ultgId`, `gudangId`, `lokasiId`, `garduIndukId`, `bayId`.
Output: record canonical terbaru. TL hanya record UPT sendiri.

## `mtu_khs_request_transfer`

Input: source record/version, qty, target UPT dan lokasi detail, note, idempotency key.
Output: transfer request `PENDING`. Target wajib UPT berbeda dalam UIT yang sama.

## `mtu_khs_decide_transfer`

Input: request ID, `APPROVED|REJECTED`, note.
Output: request final dan target record ID bila approved. Hanya ASMAN source UPT.

## `mtu_khs_register_evidence`

Input: record ID, kind, object path, MIME, size, idempotency key.
Output: evidence aktif. Object harus ada di bucket private dan memenuhi validasi.

## `mtu_khs_list_records`

Parameter existing ditambah `p_rfq` dan `p_contract_kr`. Output existing ditambah facets `rfqs` dan `contractKrs`. Ranking: exact catalog/RFQ/KR, prefix, all-token, trigram.
