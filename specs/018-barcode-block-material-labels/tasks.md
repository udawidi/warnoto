# Tasks: Label Material Barcode Blok

## Phase 1: Setup

- [x] T001 Kunci kontrak output `sapLabel` dan `jenisBarang` di `specs/018-barcode-block-material-labels/contracts/public-block-stock.md`

## Phase 2: Foundational

- [x] T002 Tambah contract assertions untuk klasifikasi, grain agregasi, dan keamanan RPC di `tests/unit/qrBlok.test.mjs`

## Phase 3: User Story 1 - Identifikasi Material dari Barcode Blok

**Goal**: Pengguna melihat status SAP/Non-SAP dan jenis material pada setiap baris hasil scan barcode blok.

**Independent Test**: Buka barcode blok berisi klasifikasi berbeda dan cocokkan dua label setiap baris terhadap sumber stok/katalog.

- [x] T003 [US1] Extend fungsi read-only `public_block_stock` dengan klasifikasi per stok dan agregasi per katalog/status/jenis di `supabase/migrations/20260921_public_block_material_labels.sql`
- [x] T004 [US1] Mirror kontrak fungsi terbaru di `supabase/schema.sql` dan invariant read-only di `supabase/verify_lokasi_public_qr.sql`
- [x] T005 [US1] Tampilkan badge Status dan Jenis dengan fallback kompatibel RPC lama di `src/components/ScanBlockPublicView.jsx`

## Phase 4: Verification & Release Gate

- [x] T006 Jalankan `tests/unit/qrBlok.test.mjs`, build, dan `git diff --check` sesuai `specs/018-barcode-block-material-labels/quickstart.md`
- [ ] T007 Setelah konfirmasi pengguna, apply migration dan jalankan verifier production dari `supabase/migrations/20260921_public_block_material_labels.sql` serta `supabase/verify_lokasi_public_qr.sql`
- [x] T008 Perbarui status ringkas dan riwayat shift di `HANDOFF.md` tanpa melebihi dua entri

## Dependencies & Execution Order

T001 sebelum T002-T005. T002 sebelum T003-T005. T003 sebelum T004. T003-T005 sebelum T006. T007 hanya setelah konfirmasi eksplisit pengguna. T008 mencatat status aktual terakhir.

## Parallel Opportunities

Setelah T002, T005 dapat dikerjakan paralel dengan T003-T004 karena file tidak tumpang tindih.

## Implementation Strategy

Selesaikan kontrak dan kode lokal lebih dulu. Jangan apply migration production sampai pengguna menyetujui proposal perubahan RPC. Tidak ada tabel, kolom, dependensi, atau mutasi data baru.
