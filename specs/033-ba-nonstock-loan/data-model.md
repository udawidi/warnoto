# Data Model: BA Pengeluaran Material Non Stock dan Pinjam

## `ba_non_stock`

- `id text primary key`
- `upt_id text not null`
- `kind text not null`: `NON_STOCK | PINJAM`
- `stage text not null`: `DRAFT | PENDING_TL | APPROVED | REJECTED`
- `status text not null`: `DRAFT | PENDING | APPROVED | REJECTED`
- `version integer not null default 1`
- `doc_number text unique null`
- `sequence_year integer null`
- `sequence_value bigint null`
- `warehouse_id text null`
- `security_guard_id text null`
- `issue_date date null`
- `sender text null`
- `destination_unit text null`
- `reference_document text null`
- `purpose text null`
- `recipient_name text null`
- `recipient_title text null`
- `recipient_unit text null`
- `driver_name text null`
- `vehicle_number text null`
- `photo_label_url text null`
- `photo_loaded_url text null`
- `recipient_snapshot jsonb not null default '{}'`
- `security_guard_snapshot jsonb not null default '{}'`
- `tl_snapshot jsonb not null default '{}'`
- `created_by uuid not null`
- `submitted_by uuid null`
- `approved_by uuid null`
- `rejected_by uuid null`
- `rejection_reason text null`
- `submitted_at timestamptz null`
- `approved_at timestamptz null`
- `rejected_at timestamptz null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Constraints: kind/status/stage allowlist, version positif, nomor/sequence hanya ketika final, unique `(upt_id, sequence_year, sequence_value)` ketika terisi.

## `ba_non_stock_items`

- `ba_id text not null references ba_non_stock(id) on delete cascade`
- `line_no integer not null`
- `material_name text not null`
- `qty numeric not null check qty > 0`
- `unit text not null`
- `description text not null default ''`
- Primary key `(ba_id, line_no)`

## `ba_non_stock_counters`

- `upt_id text not null`
- `year integer not null`
- `last_value bigint not null default 0`
- `updated_at timestamptz not null`
- Primary key `(upt_id, year)`

## State Transitions

```text
DRAFT --submit by ADMIN--> PENDING_TL
PENDING_TL --approve by TL--> APPROVED
PENDING_TL --reject by TL--> REJECTED
REJECTED --save/edit by creator ADMIN--> DRAFT
```

`APPROVED` immutable. SUPERADMIN dapat menjalankan jalur operasional sesuai bypass existing.

## Validation

- Draft boleh parsial; supplied values tetap harus bertipe benar.
- Submit memerlukan seluruh header wajib, satpam se-gudang, minimal satu item lengkap, dan dua URL path yang tepat.
- Approval mengulangi validasi dan memastikan dua object ada di `storage.objects`.
- Semua mutation memerlukan `expected_version`; mismatch gagal tertutup.
- Snapshot Penerima dan Satpam ditetapkan saat submit; snapshot TL ditetapkan saat approve.
- Nomor memakai waktu approval server dan format `LPAD(sequence,3,'0').BA/<upt_id>/<MM>/<YYYY>`.
