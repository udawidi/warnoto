# Implementation Plan: Remove Stock Opname Freeze

**Branch**: `020-remove-opname-freeze`  **Date**: 2026-09-21

## Summary

Hapus seluruh mekanisme freeze Stock Opname dari aplikasi dan database object, pertahankan Realtime/`updated_at`, dan biarkan data legacy inert.

## Technical Context

- React + Vite + Supabase.
- Implementasi memakai pola dan dependency existing.
- Migration removal adalah perubahan database object yang harus direview dan dijalankan terkontrol.
- Tidak ada mass-update data legacy.

## Constitution Check

- Caveman/Ponytail/RTK: dipatuhi; diff minimum, tanpa dependency baru.
- Constraint project dari `AGENTS.md` dan `HANDOFF.md`: review-first, schema change perlu konfirmasi, Realtime `stock_opname` tetap, `wa_sync_status` tidak disentuh.
- Tidak ada unresolved constitutional conflict.

## Project Structure

- `App.jsx` dan `src/`: UI serta alur Stock Opname.
- `supabase/` atau migration SQL existing: RPC/trigger/database object freeze.
- `tests/` atau test existing: regresi freeze, GI, Barcode, dan seed.
- `specs/020-remove-opname-freeze/`: artefak perencanaan.

## Implementation Sequence

1. Inventarisir referensi freeze di UI, RPC, trigger, guard, helper, test, dan migration.
2. Hapus jalur UI dan aplikasi yang menampilkan/memblokir freeze.
3. Tambahkan migration untuk drop object freeze; jangan drop tabel atau Realtime.
4. Verifikasi `updated_at`, legacy inert, GI/QR/Barcode, dan role-gated heavy seed.
5. Jalankan typecheck/build/test serta smoke test ADMIN dan TUG.

## Risks and Mitigations

- Referensi tersembunyi: pencarian repository dan smoke test save.
- Migration salah sasaran: review object name dan pastikan hanya object freeze yang di-drop.
- Realtime regresi: verifikasi subscription dan event setelah save.
