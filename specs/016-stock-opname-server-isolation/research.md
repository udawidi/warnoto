# Research: Isolasi Server Stock Opname per UPT

## Fakta Audit

- Production sudah memakai `Scoped read/write` dengan `can_access_upt(upt_id)`.
- `upt_id` kedua tabel sudah `NOT NULL`, ber-FK, dan tanpa nilai null.
- Simulasi role: Bali melihat 0/0; Surabaya melihat 2 opname dan 3 count; SUPERADMIN melihat seluruh 2/3.
- Insert Bali dengan `upt_id=UPT-SBY` ditolak RLS.
- Gap nyata: `authenticated` masih memiliki `TRUNCATE`, yang tidak dipagari RLS.
- `schema.sql` masih berisi policy authenticated-wide lama sehingga berisiko regresi saat bootstrap.
- Loader memakai `select("*")`; RLS sudah memfilter server, tetapi filter query eksplisit belum ada.
- Respons remote kosong saat ini dapat menampilkan/seed cache lokal, berisiko lintas-login.

## Keputusan

- Tidak mengganti helper role atau arsitektur approval.
- Tambah hardening grant, parity schema, explicit query filter, dan fail-closed cache.
- Tidak memakai `FORCE ROW LEVEL SECURITY`; service/maintenance tetap memakai jalur admin existing.
