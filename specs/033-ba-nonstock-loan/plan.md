# Implementation Plan: BA Pengeluaran Material Non Stock dan Pinjam

**Branch**: `033-ba-nonstock-loan` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

## Summary

Bangun modul BA server-first yang terpisah dari canonical TUG-8/9. Header dan item disimpan pada tabel khusus, foto memakai bucket `tug-photos`, seluruh mutasi memakai RPC ber-version, dan nomor tahunan diterbitkan atomik saat TL menyetujui. UI ditambahkan sebagai kartu ketiga pada TUG Barang Keluar dengan form manual, Approval Hub, riwayat, serta cetakan A4 dua bagian.

## Technical Context

**Language/Version**: JavaScript ES modules, React 18.2, SQL PostgreSQL/Supabase, Node.js >=20.19

**Primary Dependencies**: React, Vite, `@supabase/supabase-js`, komponen dan helper WARNOTO existing

**Storage**: Supabase self-host PostgreSQL; bucket public existing `tug-photos`

**Testing**: Node test runner, contract tests, PostgreSQL scratch rehearsal, Playwright, Vite production build

**Target Platform**: Browser desktop dan mobile; Vercel frontend; Supabase self-host backend

**Project Type**: Single-page web application dengan PostgreSQL RPC

**Performance Goals**: Form dan riwayat tetap responsif pada ratusan BA per UPT; nomor final aman pada approval paralel

**Constraints**: Tidak menyentuh stok/TUG-15; review-first; RLS per UPT; tidak menyimpan base64; schema production tidak diterapkan tanpa konfirmasi; tidak menambah dependency

**Scale/Scope**: Satu modul BA, tiga role path utama, tiga tabel, tiga RPC, satu builder cetak

## Constitution Check

Constitution project masih berupa template dan tidak memiliki prinsip aktif. Gate project yang berlaku berasal dari `AGENTS.md` dan `HANDOFF.md`:

- PASS: solusi terpisah mencegah perubahan kontrak canonical TUG-8/9.
- PASS: alur Admin ke TL mempertahankan review-first.
- PASS: database migration hanya dibuat; apply production menunggu konfirmasi.
- PASS: reuse bucket, compressor, master gudang/satpam, pola preview, dan permission existing.
- PASS: tidak ada dependency atau abstraksi baru yang tidak diperlukan.
- PASS: schema snapshot mengikuti migration dan diuji bootstrap dua kali.

## Project Structure

### Documentation

```text
specs/033-ba-nonstock-loan/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ba-non-stock-rpc.md
└── tasks.md
```

### Source Code

```text
App.jsx
src/components/BaNonStockTab.jsx
src/components/BaNonStockFormModal.jsx
src/components/ApprovalHubTab.jsx
src/components/StockModals.jsx
src/components/TransactionHubTab.jsx
src/lib/baNonStockSync.js
src/lib/docBuilders.js
src/lib/tugRoute.js
supabase/migrations/20261015_ba_non_stock.sql
supabase/schema.sql
tests/unit/baNonStock.contract.test.mjs
tests/unit/baNonStockDocument.test.mjs
tests/e2e/ba-non-stock.spec.js
```

**Structure Decision**: Modul UI dan sync dibuat terpisah. Integrasi ke `App.jsx`, Transaction Hub, Approval Hub, preview, route, dan schema bersifat additive. Area dirty existing tidak direwrite.

## Design Phases

1. Tambah migration, RLS, counter, RPC, schema snapshot, dan rehearsal.
2. Tambah client sync dan upload dua bukti foto.
3. Tambah route, form, daftar riwayat, dan approval.
4. Tambah builder A4, preview/print, contract/unit/E2E tests.
5. Jalankan test penuh dan build; migration production tetap belum diterapkan.

## Constitution Re-check

PASS setelah desain: akses, nomor, foto, state transition, dan larangan mutasi stok ditegakkan di server; frontend hanya mengorkestrasi UX.

## Complexity Tracking

Tidak ada pelanggaran yang perlu justifikasi. Tabel khusus dipilih karena generic TUG workflow memiliki allowlist dan state machine berbeda; memperluasnya akan meningkatkan risiko terhadap TUG existing.
