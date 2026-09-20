# Implementation Plan: Pool Kuantitas Alat Bantu

## Technical Context

- React 18, Vite, Supabase PostgreSQL self-host.
- Extend tabel dan pola RPC/RLS/storage yang sudah live.
- Tidak menambah dependency.

## Architecture

- Migration additive menambah kolom typed, constraint, immutability trigger, checkout v2, return quantity RPC, dan storage read policy untuk nested return events.
- Loader dan normalizer membawa mode/kuantitas typed; state hanya berubah setelah RPC sukses.
- UI memakai desain Operations existing. `design-taste-frontend` tidak diterapkan karena skill tersebut mengecualikan dashboard/admin panel; responsive-design dipakai untuk mobile-first, target sentuh 44 px, dan tanpa overflow.
- Existing unit flow dan RPC lama tidak dihapus.

## Rollout

- Migration kompatibel diterapkan setelah backup, lalu frontend deploy.
- Aset produksi `PLAT BESI TRAFO` dikonversi oleh TL setelah jumlah aktual diisi; migration tidak menebak jumlah.

## Constitution Check

Constitution project masih template. Kontrak project yang berlaku: self-host canonical, review-first, `upt_id` boundary, schema approval gate, PONYTAIL, dan verifikasi keamanan.

