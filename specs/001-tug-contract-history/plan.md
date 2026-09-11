# Implementation Plan: Riwayat Sumber Kontrak TUG-8/9

**Branch**: `main` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

Tambahkan snapshot sumber informatif yang server-derived pada item canonical TUG-8/TUG-9, backfill data lama tanpa menyentuh hash dokumen, dan tampilkan seluruh kontrak atau asal stok pada picker, approval, dan riwayat.

## Technical Context

**Language/Version**: JavaScript/JSX, PostgreSQL PL/pgSQL, React + Vite 4

**Primary Dependencies**: Supabase JS yang sudah terpasang; tanpa dependency baru

**Storage**: PostgreSQL self-host, `stocks`, `tug3_transactions`, `tug_transactions`, `tug_items`

**Testing**: Node test runner, contract tests, rehearsal PostgreSQL, Vite build

**Target Platform**: Browser desktop/mobile dan Supabase self-host WARNOTO

**Project Type**: Web application dengan RPC PostgreSQL canonical

**Performance Goals**: Tidak menambah request per item; snapshot ikut query relasi existing

**Constraints**: Server-derived, RLS tetap berlaku, hash/approval lama immutable, bukan FIFO/batch

**Scale/Scope**: 700 stok; baseline 36 item canonical TUG-8/TUG-9 dan 27 item TUG-3 approved

## Constitution Check

Constitution masih template; pemeriksaan formal dilewati. Kontrak project tetap mengikat: review-first, migration proposal, tanpa dependency baru, TUG-8/TUG-9 tetap canonical, dan production hanya setelah konfirmasi.

## Architecture Decisions

- Tambah `tug_items.source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb`; jangan ubah `snapshot` atau `tug_hash`.
- Bentuk snapshot: `{sourceKind, contracts, provenance}`. Enum sumber: `TUG3_CONTRACT`, `SAP_MIGRATION`, `TUG10_RETURN`, `INITIAL_STOCK`.
- Helper SQL `SECURITY DEFINER` mengambil sumber dari `stocks.data`, mengurutkan kontrak terbaru, dedupe `docNo+noKontrak`, dan tidak diekspos ke role client.
- `tug_create_transaction` dan `tug_amend` mengisi snapshot dalam transaksi RPC yang sama tanpa mengubah signature.
- Backfill kontrak stok bersumber dari TUG-3 approved dan idempoten. Backfill item lama memfilter `tglMasuk <= tug_transactions.created_at`.
- `canonicalRowToTxn` mengekspos `sourceSnapshot`. History/approval membaca snapshot; picker membaca stok hidup.

## Project Structure

```text
supabase/migrations/             # migration kolom, helper, RPC, dan backfill
src/lib/tugCanonical.js          # mapping row canonical
src/lib/sap.js                   # normalisasi/format sumber
src/components/                  # picker, approval, transaction history
tests/unit/                      # contract dan formatter tests
scripts/                         # rehearsal PostgreSQL bila diperlukan
```

**Structure Decision**: Gunakan modul dan pola canonical existing; tidak membuat service, table, atau dependency baru.

## Rollout

1. Jalankan test dan rehearsal lokal.
2. Dry-run production: semua item TUG-3 harus resolve; baseline saat inspeksi 27/27 dan 0 unmatched.
3. Pastikan backup jam terbaru tersedia.
4. Apply migration dengan `ON_ERROR_STOP` dalam satu transaksi setelah konfirmasi user.
5. Verifikasi seluruh item TUG-8/TUG-9 memiliki snapshot; TUG-9 250 menunjukkan empat sumber benar; hash, qty, approval, dan stock movements tidak berubah.
6. Commit/push terpisah setelah izin eksplisit.

## Post-Design Constitution Check

Lulus terhadap kontrak project: perubahan minimal, server-authoritative, review-first, tanpa perubahan canonical hash, tanpa aksi production otomatis.
