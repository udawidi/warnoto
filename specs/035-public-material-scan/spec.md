# Feature Specification: Public Material Scan per UPT

**Feature Branch**: `main`  
**Created**: 2026-10-22  
**Status**: Implemented, production migration applied  
**Input**: QR material UPT Probolinggo masih menampilkan identitas UPT Surabaya dan lokasi tidak tampil.

## User Stories

### US1 — Scan QR material per UPT (P1)

Petugas memindai kartu gantung dari UPT mana pun dan melihat identitas, saldo, lokasi, serta riwayat yang hanya berasal dari UPT pada QR.

**Acceptance scenarios**

1. QR baru dengan `scan=<katalogId>&upt=<uptId>` menampilkan nama UPT yang sesuai.
2. Material yang sama di dua UPT menampilkan saldo dan lokasi yang berbeda sesuai UPT QR.
3. UPT pada QR yang tidak memiliki stok material ditolak dengan pesan aman.
4. Lokasi kosong menampilkan `Lokasi belum diisi.` tanpa menebak dari riwayat.

### US2 — QR lama tetap terbaca (P1)

QR lama tanpa parameter UPT tetap dapat dipakai.

**Acceptance scenarios**

1. Satu UPT yang cocok dipilih otomatis.
2. Banyak UPT menampilkan pilihan UPT sebelum data scoped dibuka.
3. QR lama tidak mencampur stok atau riwayat lintas UPT.

## Requirements

- **FR-001**: RPC publik harus read-only, `SECURITY DEFINER`, `search_path=pg_catalog`, dan hanya mengembalikan payload terkurasi.
- **FR-002**: Stok harus memakai `coalesce(stocks.upt_id, gudang.upt_id)` dan membuang konflik explicit UPT dengan UPT gudang.
- **FR-003**: Opsi UPT harus tetap muncul untuk stok qty nol.
- **FR-004**: Lokasi hanya berasal dari stok live dengan gudang dan master lokasi yang valid serta qty positif.
- **FR-005**: Riwayat hanya boleh berasal dari `lokasi_id` yang gudangnya memiliki UPT terpilih; riwayat tanpa UPT tidak boleh ikut.
- **FR-006**: Payload harus memiliki status `READY`, `SELECT_UPT`, `INVALID_UPT`, atau `NOT_FOUND`.
- **FR-007**: Semua label A4, compact, NIIMBOT, dan bulk yang memiliki scope harus mengodekan UPT ID.
- **FR-008**: Production migration tidak dijalankan tanpa konfirmasi terpisah.

## Out of Scope

- Perubahan grant SELECT tabel publik lama.
- Backfill data production.
- Perubahan `HANDOFF.md` otomatis.

## Success Criteria

- QR UPT Probolinggo tidak lagi menampilkan Surabaya.
- Lokasi live tampil saat stok memiliki lokasi valid.
- Full unit test dan build lulus.
