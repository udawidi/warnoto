# Research Decisions

## Scope UPT

- **Decision**: typed `upt_id` menjadi satu-satunya kunci keamanan; nama UPT tetap snapshot display.
- **Rationale**: perbandingan nama rentan drift dan tidak layak untuk RLS.
- **Alternative**: JSONB-only ditolak karena sulit diindeks dan divalidasi.

## Penyimpanan Foto

- **Decision**: bucket private self-host khusus dengan folder pertama `owner_upt_id`.
- **Rationale**: bucket `tug-photos` public akan membocorkan bukti peminjaman.
- **Alternative**: URL public ditolak.

## Transaksi Batch

- **Decision**: satu loan row per aset dengan `loanBatchId` bersama; RPC mengunci aset terurut.
- **Rationale**: reuse model existing, mendukung partial return, dan mencegah double-book.
- **Alternative**: satu row berisi array aset ditolak karena merusak lifecycle existing.

## UI

- **Decision**: targeted evolution pada komponen existing.
- **Rationale**: menjaga muscle memory dan mencegah redesign luas.
