# Implementation Plan: Isolasi Server Stock Opname per UPT

## Technical Context

- React 18, Vite, Supabase PostgreSQL self-host.
- Reuse `can_access_upt`, `loadMasterTable`, dan typed `upt_id` existing.
- Tidak menambah dependency.

## Architecture

- PostgreSQL RLS tetap boundary utama. Migration idempotent menegaskan scoped policies dan mempersempit grants.
- `schema.sql` disamakan dengan state aman agar bootstrap tidak membuat policy authenticated-wide.
- Loader menerima opsi `uptIds`; query menambahkan `.in("upt_id", uptIds)` hanya bila scope diketahui.
- Cache lokal hanya fallback untuk record dengan scope terverifikasi; respons remote kosong tidak dianggap alasan untuk seed otomatis.

## Rollout

1. Backup database self-host.
2. Terapkan migration hardening dalam transaction.
3. Jalankan verifier catalog dan simulasi JWT UPT/nasional.
4. Jalankan unit, build, E2E relevan.
5. Commit dan push `main` tanpa menyertakan perubahan UI Stock Opname yang tidak terkait.

## Risks

- Revokasi grant berlebih dapat memblokir CRUD: verifier memastikan empat hak CRUD tetap ada untuk `authenticated`.
- Filter client salah dapat menyembunyikan data tier UIT: saat scope organisasi belum tersedia, loader tidak memasang filter dan tetap mengandalkan RLS.
- Cache legacy tanpa `uptId` tidak tampil ketika offline: dipilih fail-closed untuk mencegah kebocoran lintas-login.

## Constitution Check

Self-host canonical, `upt_id` sebagai boundary, review-first, migration sesudah backup, PONYTAIL, dan verifikasi keamanan terpenuhi.
