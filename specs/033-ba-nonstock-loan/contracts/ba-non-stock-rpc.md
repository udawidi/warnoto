# RPC Contract: BA Non Stock

## `save_ba_non_stock_draft`

Input: `p_id text`, `p_expected_version integer|null`, `p_upt_id text`, dan `p_payload jsonb` berisi header serta `items[]`.

Authorization: ADMIN pada UPT sendiri atau SUPERADMIN. Create hanya saat expected version null; update hanya DRAFT/REJECTED milik pembuat.

Output: `{ ok, id, version, stage, status }`.

## `submit_ba_non_stock`

Input: `p_id text`, `p_expected_version integer`.

Authorization: pembuat ADMIN pada UPT sendiri atau SUPERADMIN.

Behavior: validasi kelengkapan, foto, Satpam, item; snapshot Penerima dan Satpam; transisi ke `PENDING_TL`. Tidak menerbitkan nomor.

Output: `{ ok, id, version, stage: 'PENDING_TL', status: 'PENDING' }`.

## `decide_ba_non_stock`

Input: `p_id text`, `p_expected_version integer`, `p_decision text` (`APPROVE | REJECT`), dan `p_reason text|null`.

Authorization: TL pada UPT dokumen atau SUPERADMIN.

Approval: lock BA dan counter tahunan, validasi ulang data/object foto, increment counter, terbitkan nomor, snapshot TL, set final immutable.

Reject: alasan wajib, simpan audit penolak, set `REJECTED` tanpa nomor.

Output: `{ ok, id, version, stage, status, docNumber }`.

## Read Contract

Client membaca tabel melalui RLS bersama item child. Scope mengikuti `can_access_upt(upt_id)`. Tidak ada direct INSERT/UPDATE/DELETE grant untuk authenticated.

## Stable Error Codes

- `BA_AUTH_REQUIRED`
- `BA_ROLE_DENIED`
- `BA_SCOPE_DENIED`
- `BA_NOT_FOUND`
- `BA_VERSION_MISMATCH`
- `BA_STAGE_INVALID`
- `BA_REQUIRED_FIELD`
- `BA_ITEM_INVALID`
- `BA_PHOTO_REQUIRED`
- `BA_PHOTO_NOT_STORED`
- `BA_SATPAM_INVALID`
- `BA_REJECT_REASON_REQUIRED`
