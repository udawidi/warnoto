# Implementation Plan: Optional Heavy Equipment Loan Letter

**Branch**: `[019-optional-loan-letter]` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-optional-loan-letter/spec.md`

## Summary

Ubah dokumen awal peminjaman HAR UIT dari Foto Serah-Terima wajib menjadi Surat Peminjaman opsional. Pertahankan nama field dan parameter server lama untuk kompatibilitas, izinkan nilai kosong hanya pada alur HAR UIT, dan tetap validasi kepemilikan path bila surat diunggah.

## Technical Context

**Language/Version**: JavaScript/JSX, PostgreSQL PL/pgSQL

**Primary Dependencies**: React, Vite 4, Supabase JS yang sudah terpasang

**Storage**: PostgreSQL dan Supabase Storage bucket `heavy-equipment-evidence`

**Testing**: Node test runner, SQL contract test, Vite production build

**Target Platform**: Browser desktop/mobile dan Supabase production

**Project Type**: Web application

**Performance Goals**: Tidak menambah request saat surat kosong; satu upload saat surat tersedia

**Constraints**: Data dan signature RPC lama tetap kompatibel; tidak menambah dependensi; migration production diterapkan sebelum frontend

**Scale/Scope**: Form peminjaman HAR UIT, dua RPC checkout, storage evidence, dan riwayat alat berat

## Constitution Check

*GATE: Passed before research and after design.*

- Diff minimum dan memakai helper/upload/storage yang sudah ada.
- Tidak ada dependensi baru atau perubahan struktur aplikasi.
- Migration baru bersifat backward-compatible; tidak mengubah atau menghapus data lama.
- Validasi path lintas UPT dan bukti pengembalian tetap dipertahankan.
- Perubahan production memerlukan persetujuan pengguna sebelum migration diterapkan.

## Project Structure

### Documentation (this feature)

```text
specs/019-optional-loan-letter/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── heavy-equipment-checkout.md
└── tasks.md
```

### Source Code (repository root)

```text
src/components/HeavyEquipmentTabV2.jsx
src/hooks/useHeavyEquipment.js
supabase/migrations/20260921b_har_uit_optional_loan_letter.sql
supabase/schema.sql
supabase/test_heavy_equipment_quantity_contract.sql
tests/unit/heavyEquipmentSupportTools.test.mjs
tests/e2e/heavy-equipment.spec.js
```

**Structure Decision**: Pertahankan struktur existing; perubahan hanya pada form/hook alat berat, override RPC melalui migration baru, schema snapshot, dan test terkait.

## Complexity Tracking

Tidak ada pelanggaran yang memerlukan pengecualian.
