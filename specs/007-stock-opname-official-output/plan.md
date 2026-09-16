# Implementation Plan: Output Resmi Stock Opname

**Branch**: `007-stock-opname-official-output` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

## Summary

Tambahkan paket cetak resmi BA dan TUG15 pada alur SAP-first. Identitas UPT, Manager, pemeriksa, tanggal, dan PID divalidasi lalu disimpan sebagai snapshot `documentMeta` di JSON sesi sebelum satu dokumen HTML A4 portrait dibuka untuk cetak.

## Technical Context

**Language/Version**: JavaScript, React 18, Vite 4
**Primary Dependencies**: Dependensi project yang sudah ada; tidak ada dependensi baru
**Storage**: Supabase `stock_opname` JSON melalui `saveOpname`; tanpa migrasi
**Testing**: Node test runner, Vitest/Playwright yang sudah terpasang, Vite production build
**Target Platform**: Browser desktop/mobile, print A4 portrait
**Project Type**: React single-page web application
**Performance Goals**: Resolusi identitas dan pembuatan HTML lokal, tanpa request tambahan
**Constraints**: Pertahankan draft legacy, builder lama, alur SAP-first, dan perubahan banner lokal
**Scale/Scope**: Satu dialog Stock Opname, dua helper library, satu aturan scope App

## Constitution Check

Constitution masih berupa template. Batas project berlaku: review-first, tanpa migrasi/dependensi, solusi minimum, unit test untuk logika bercabang. PASS.

## Architecture Decisions

- Pure helper di `src/lib/stockOpnameFlow.js` menyelesaikan UPT legacy, Manager, pemeriksa default, dan child Non-SAP agar dapat diuji tanpa React.
- `documentMeta` versi 1 menjadi sumber data lintas perangkat; localStorage tidak menjadi sumber kebenaran.
- UI menyimpan metadata melalui `saveOpname` sebelum menghasilkan dokumen.
- `buildStockOpnamePackageHTML` menghasilkan tepat satu dokumen HTML dan memakai bagian BA/TUG15 dari builder yang sudah ada.
- Popup dibuka synchronously saat klik untuk menghindari popup blocker, tetapi konten dokumen hanya ditulis setelah save berhasil.

## Project Structure

```text
App.jsx
src/
├── components/StockOpnameTab.jsx
└── lib/
    ├── docBuilders.js
    └── stockOpnameFlow.js
tests/
└── unit/
    ├── stockOpnameFlow.test.mjs
    └── stockOpnameDocumentPackage.test.mjs
```

**Structure Decision**: Gunakan struktur React dan helper yang sudah ada. Tidak membuat service atau state layer baru.

## Implementation Order

1. Tambah test gagal dan pure helper resolusi identitas.
2. Stamp/scope UPT pada sesi baru dan child.
3. Tambah single-package builder dan test integritas dokumen.
4. Ganti dialog cetak agar memakai picker/manual fallback dan menyimpan metadata durable.
5. Verifikasi unit, build, alur SAP-first, dan print HTML.

## Risks and Guards

- Konflik sumber UPT tidak boleh ditebak; cetak diblokir.
- Manager nol/ganda tidak boleh dipilih otomatis; cetak diblokir.
- `saveOpname` gagal berarti popup ditutup dan dokumen tidak ditulis.
- Child draft tidak dicetak; SAP tetap boleh dicetak dengan warning.
- Label Nama/Nipeg tetap, tetapi hanya nama tersedia dari profil.

## Complexity Tracking

Tidak ada pelanggaran yang memerlukan justifikasi.
