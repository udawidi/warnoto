# Feature Specification: Remove Stock Opname Freeze

**Branch**: `020-remove-opname-freeze`  **Date**: 2026-09-21  **Status**: Draft for implementation

## User Scenarios & Testing

### US1 — ADMIN dapat menyimpan Stock Opname (P1)

ADMIN/Fajar mengubah dan menyimpan Stock Opname tanpa ditolak aturan freeze.

**Acceptance**: save dan edit berhasil; tidak ada error 403/guard freeze; `updated_at` berubah.

### US2 — TUG dapat memproses transaksi saat sesi aktif (P2)

Pengguna TUG memproses transaksi Stock Opname saat sesi opname aktif tanpa guard freeze.

**Acceptance**: transaksi TUG berhasil diproses tanpa pemeriksaan freeze dan Realtime tetap menerima perubahan.

### US3 — Bootstrap heavy equipment hanya oleh TL (P3)

Bootstrap non-TL/ADMIN tidak mencoba menulis seed `heavy_equipment`; hanya TL boleh menulis fallback.

**Acceptance**: non-TL/ADMIN melewati seed tanpa RLS 403; fallback write hanya dilakukan oleh TL.

## Edge Cases

- Record lama dengan `freeze` terisi tetap dapat dibaca dan diedit; nilainya tidak dimass-update.
- Koneksi Realtime terputus tidak boleh diubah menjadi freeze atau guard baru.
- GI dan QR/Barcode hanya diverifikasi; perilakunya tidak diubah.
- RPC/trigger freeze yang sudah tidak dipakai tidak boleh dipanggil oleh alur save.

## Functional Requirements

- **FR-001**: Hapus UI, RPC, trigger, guard, helper, dan test khusus freeze.
- **FR-002**: Save/edit Stock Opname tidak boleh memeriksa `freeze`.
- **FR-003**: Pertahankan Realtime `stock_opname` dan pembaruan `updated_at`.
- **FR-004**: Drop objek database yang khusus freeze melalui migration terkontrol.
- **FR-005**: Jangan menghapus atau mass-update data legacy `freeze`; jadikan inert.
- **FR-006**: Verifikasi GI, QR/Barcode, dan pembatasan heavy-equipment seed: non-TL/ADMIN tidak seed, fallback write hanya TL.

## Key Entities

- `stock_opname`: transaksi utama; Realtime dan `updated_at` dipertahankan.
- `freeze`: atribut/legacy data; tidak lagi menjadi aturan.
- Freeze RPC/trigger/guard/helper: objek yang dihapus.
- Heavy-equipment seed: bootstrap role-gated; non-TL/ADMIN skip, fallback write hanya TL.

## Success Criteria

- 100% smoke test save/edit ADMIN dan TUG berhasil tanpa error freeze/403.
- 0 pemanggilan freeze UI/RPC/trigger/guard/helper tersisa pada jalur Stock Opname.
- 100% verifikasi Realtime dan `updated_at` tetap berhasil.
- 100% verifikasi GI, QR/Barcode, dan role-gated heavy seed lulus.

## Assumptions

- Migration dapat menghapus objek freeze tanpa menghapus tabel `stock_opname`.
- Penghapusan migration object tidak memerlukan mass-update legacy data.
- Tidak ada kebutuhan bisnis untuk mengaktifkan freeze kembali.

## Out of Scope

Perubahan alur GI/Barcode, perubahan role selain kebutuhan verifikasi TL, dan migrasi nilai legacy.
