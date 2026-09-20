# Data Model: Isolasi Server Stock Opname per UPT

## stock_opname

- `upt_id text NOT NULL REFERENCES upt(id) ON DELETE RESTRICT`
- SELECT: `can_access_upt(upt_id)`
- ALL writes: `USING can_access_upt(upt_id)` dan `WITH CHECK can_access_upt(upt_id)`

## stock_count

- Kontrak scope sama dengan `stock_opname`.

## Privileges

- `anon`: tidak memiliki privilege tabel.
- `authenticated`: SELECT, INSERT, UPDATE, DELETE; tanpa TRUNCATE.
- `service_role`: administrasi existing dipertahankan.

## Invariant

Kolom typed `upt_id`, bukan nilai JSONB, menentukan boundary server. Loader menimpa `data.uptId` dengan nilai typed saat mapping.
