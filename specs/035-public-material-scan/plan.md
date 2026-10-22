# Implementation Plan: Public Material Scan per UPT

**Branch**: `main` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

Tambahkan satu RPC publik terkurasi untuk membaca material berdasarkan UPT, lalu kirim UPT ID di QR baru dan render hasil scan berdasarkan payload RPC.

## Technical Context

React + Vite 4, Supabase/PostgreSQL self-host, tanpa dependency baru. Migration canonical berada di `supabase/migrations/`; bootstrap mirror berada di `supabase/schema.sql`.

## Design

1. RPC `public.public_material_scan(text,text)` memilih UPT dari stok yang tidak konflik, mengembalikan material, opsi UPT, qty, lokasi live, dan history scoped.
2. `scanUrlFor(id, uptId)` menambahkan `upt` ketika scope tersedia. Bulk print mengelompokkan `(catalog, UPT)` dan fail-closed bila UPT tidak diketahui.
3. `ScanPublicView` memakai RPC, picker untuk QR lama multi-UPT, dynamic UPT header/footer, dan teks lokasi kosong yang eksplisit.
4. A4/compact/NIIMBOT/TUG/Stock Opname callers meneruskan UPT ID yang sudah tersedia atau menahan QR ketika scope tidak dapat ditentukan.

## Security and Rollout

- RPC revoke execute dari `public`, grant hanya `anon` dan `authenticated`.
- Tidak mengubah grant SELECT tabel lama.
- Migration production ditinjau dan dijalankan terpisah setelah persetujuan user.

## Verification

- Contract test URL/QR dan UI static guard.
- Rehearsal SQL scratch untuk shared catalog, invalid UPT, legacy picker, lokasi, dan history.
- `npm test`, `npm run build`, `git diff --check`.
