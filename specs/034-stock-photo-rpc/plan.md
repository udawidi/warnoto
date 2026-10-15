# Implementation Plan: Penyimpanan Foto Data Stok Aman

**Branch**: `main` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

## Summary

Ganti full-row upsert untuk foto dan OCR dengan dua RPC SECURITY DEFINER yang memodifikasi row server terbaru secara sempit tanpa melonggarkan guard TUG-3.

## Technical Context

**Language/Version**: JavaScript/React 18, PostgreSQL PL/pgSQL
**Primary Dependencies**: Supabase JS existing
**Storage**: PostgreSQL self-host + bucket `stock-photos`
**Testing**: Node test, PostgreSQL rehearsal, Vite build
**Target Platform**: Browser + Supabase self-host
**Project Type**: Web application
**Constraints**: Tanpa dependency baru; schema production hanya setelah konfirmasi; review-first; multi-UPT fail-closed
**Scale/Scope**: Dua RPC, tiga jalur frontend (detail, edit, auto-OCR)

## Constitution Check

- PASS: solusi minimum memakai helper dan pola migration existing.
- PASS: trigger keamanan tidak dilonggarkan.
- PASS: test executable mencakup logic non-trivial dan role/scope.
- PASS: tidak ada perubahan dependency atau arsitektur di luar kontrak RPC.

## Project Structure

```text
App.jsx
supabase/migrations/20261015_stock_photo_rpc.sql
supabase/schema.sql
scripts/rehearse_stock_photo_rpc.mjs
tests/unit/stockPhotoRpc.contract.test.mjs
```

**Structure Decision**: RPC berada di migration/schema existing; integrasi tetap di App.jsx untuk diff minimum.

## Design

- RPC foto mengunci row, memvalidasi actor/scope/object, lalu mengubah hanya JSON foto/history/OCR.
- RPC OCR memakai URL expected sebagai compare-and-set.
- Frontend menggabungkan payload canonical hasil RPC ke state dan tidak melakukan optimistic full-row write untuk foto/OCR.
- Edit form menyimpan field non-foto dengan foto lama, kemudian menyimpan foto melalui RPC.
