# RPC Contract: TUG Workflow Persistence

## `save_tug_workflow_transaction`

Input: ID, tipe, scope, stage, status, data, expected version opsional.  
Output: `{ok, id, version, updatedAt}`.  
Rules: actor dan scope dari auth/profile; draft baru tanpa nomor; update versi lama ditolak; TUG-8/9 hanya DRAFT; data URL ditolak.

## `delete_tug_workflow_transaction`

Input: ID dan expected version.  
Output: `{ok, id}`.  
Rules: hanya pembuat atau role berwenang; TUG-8/9 hanya sebelum promosi; versi wajib cocok.

## `transition_tug_workflow_transaction`

Input: ID, expected version, target stage/status, patch tervalidasi.  
Output: `{ok, id, version, stage, status, docNumber?}`.  
Rules: matriks role/stage server-side; nomor diterbitkan hanya pada transisi Ajukan yang memerlukannya; retry idempotent.

## `transition_tug_workflow_with_child`

Input: `action`, parent ID, expected parent version, child ID, dan payload child.

Actions: `TUG5_MANAGER_APPROVE`, `TUG5_ULTG_ADOPT`, `TUG7_MGR_LOG_APPROVE`.

Rules: parent dikunci `FOR UPDATE`; stage/status, scope child, actor, timestamp, dan referensi parent-child berasal dari server. Parent dan child dibuat dalam satu transaksi. `parent_workflow_id` memakai FK `ON DELETE RESTRICT` dan unique partial index. Retry dengan parent yang sudah memiliki child yang sama mengembalikan pasangan tersimpan; versi berbeda atau child berbeda ditolak. Idempotensi minimum ini sengaja tidak memakai `tug_idempotency_keys`, karena constraint operasi canonical tidak menerima operasi workflow baru.

Output: `{ok, idempotent, action, parent, child}`.

## Client load/merge

- Load tabel workflow, TUG-3, TUG-10, dan canonical secara paralel.
- Server menang terhadap cache untuk ID yang sama.
- Cache-only draft diunggah satu kali; konflik tidak menimpa server.
- Promosi TUG-8/9: canonical sukses dahulu, baru hapus draft workflow.
