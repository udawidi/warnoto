# Implementation Plan: Label Material Barcode Blok

**Branch**: `018-barcode-block-material-labels` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/018-barcode-block-material-labels/spec.md`

## Summary

Perluas respons baca-saja barcode blok dengan label SAP final dan jenis material, lalu tampilkan keduanya pada setiap kartu material. Sumber per baris stok menang atas master katalog; fallback katalog dan aturan label existing menjaga data legacy. Agregasi kuantitas dipisahkan berdasarkan katalog, label SAP, dan jenis material agar klasifikasi berbeda tidak tercampur.

## Technical Context

**Language/Version**: JavaScript/JSX, SQL PostgreSQL

**Primary Dependencies**: React, Vite, Supabase/PostgREST; tanpa dependensi baru

**Storage**: PostgreSQL self-host; tidak ada tabel atau kolom baru

**Testing**: Node test runner, contract tests berbasis source, SQL verifier, Vite production build

**Target Platform**: Browser desktop/mobile dan Supabase self-host production

**Project Type**: Web application dengan RPC database publik baca-saja

**Performance Goals**: Satu pemindaian tetap memakai satu permintaan data blok dan menampilkan hasil tanpa navigasi tambahan

**Constraints**: Token harus tetap di fragment URL; RPC tetap read-only, scoped tepat satu blok, dan dapat dipanggil anon/authenticated; migration production hanya setelah konfirmasi pengguna

**Scale/Scope**: Satu komponen tampilan, satu kontrak RPC existing, satu migration pengganti fungsi, mirror schema, verifier, dan contract test

## Constitution Check

*GATE: Passed sebelum dan sesudah desain.*

- Solusi memakai RPC dan pola UI yang sudah ada; tidak menambah abstraksi atau dependensi.
- Tidak ada data stok, katalog, gudang, lokasi, atau token yang dimutasi.
- Hak akses tidak diperluas: hanya payload read-only existing untuk token blok yang valid.
- Nilai legacy memiliki fallback eksplisit; jenis tidak ditebak.
- Perubahan kontrak dilengkapi migration, mirror schema, verifier, dan test.
- Apply production ditahan sampai konfirmasi eksplisit pengguna.

## Project Structure

### Documentation (this feature)

```text
specs/018-barcode-block-material-labels/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── public-block-stock.md
└── tasks.md
```

### Source Code (repository root)

```text
src/components/ScanBlockPublicView.jsx
supabase/migrations/20260921_public_block_material_labels.sql
supabase/schema.sql
supabase/verify_lokasi_public_qr.sql
tests/unit/qrBlok.test.mjs
```

**Structure Decision**: Extend file dan kontrak existing. Tidak membuat service/helper baru karena label final dikirim langsung oleh RPC dan badge style existing dapat dipakai ulang.

## Complexity Tracking

Tidak ada pelanggaran atau kompleksitas tambahan yang perlu dibenarkan.
