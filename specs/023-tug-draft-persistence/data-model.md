# Data Model: Persistensi Draft Seluruh TUG

## `tug_workflow_transactions`

| Field | Rule |
|---|---|
| `id` | Text primary key; mempertahankan ID draft lama |
| `doc_type` | `TUG5`, `TUG7`, `TUG8`, atau `TUG9` |
| `upt_id` | Scope UPT; wajib untuk TUG-5/8/9 bila bukan workflow UIT |
| `uit_id` | Scope UIT; wajib untuk TUG-7 dan draft UIT |
| `ultg_id` | Scope ULTG opsional untuk reservasi ULTG |
| `created_by` | UUID pembuat server-authoritative |
| `stage` | Tahap workflow existing |
| `status` | `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` |
| `doc_number` | Null untuk draft baru; dapat berisi nomor legacy |
| `doc_sequence` | Null untuk draft baru; dapat berisi sequence legacy |
| `version` | Integer mulai 1; naik setiap mutasi |
| `data` | Snapshot transaksi lengkap tanpa binary data URL |
| `created_at` | Waktu server |
| `updated_at` | Waktu server |

## Validation

- Tepat satu scope utama tersedia: UPT atau UIT; ULTG harus memiliki parent UPT.
- Child workflow menyimpan `parent_workflow_id` self-FK `ON DELETE RESTRICT`; satu parent hanya boleh memiliki satu child workflow.
- TUG-8/9 di tabel ini hanya boleh berstatus DRAFT.
- Draft baru tidak boleh memiliki nomor/sequence.
- `data.docType`, typed `doc_type`, scope, stage, dan status harus konsisten.
- Data URL foto ditolak; hanya path/URL Storage.

## State Transitions

- TUG-5: `DRAFT → PENDING_ASMAN/PENDING_MGR_ULTG → ... → APPROVED|REJECTED`.
- TUG-7: `DRAFT_UIT → PENDING_MGR_LOGISTIK → APPROVED|REJECTED`.
- TUG-8/9: `DRAFT → canonical create+submit`; row workflow dihapus setelah canonical sukses.
- Edit: `version N → N+1`; expected version selain N ditolak.

## Existing Entities

- `tug3_transactions`: tetap sumber kebenaran TUG-3/4.
- `tug10_transactions`: tetap sumber kebenaran TUG-10.
- `tug_transactions`: tetap sumber kebenaran canonical TUG-8/9 setelah Ajukan.
