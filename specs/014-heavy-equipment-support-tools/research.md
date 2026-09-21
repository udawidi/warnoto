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

## Identitas Peminjam HAR UIT

- **Decision**: tambahkan typed nullable `requester_uit_id` pada loan; `requester_upt_id` tetap null dan snapshot requester memakai label `HAR UIT <nama/kode>`.
- **Rationale**: HAR_UIT adalah organisasi peminjam tanpa `upt_id`; typed foreign key diperlukan untuk RLS, audit, dan histori lintas perangkat.
- **Alternative**: menyimpan UIT hanya di JSONB ditolak karena dapat dipalsukan client dan tidak layak menjadi dasar otorisasi.

## Scope Baca HAR UIT

- **Decision**: HAR_UIT membaca registry dan seluruh loan yang owner UPT, requester UPT, atau requester UIT-nya berada dalam UIT akun.
- **Rationale**: kebutuhan operasional adalah visibilitas semua transaksi dalam UIT, bukan hanya transaksi yang dibuat akun tersebut.
- **Alternative**: hanya loan buatan aktor ditolak karena memecah histori organisasi.

## Checkout HAR UIT

- **Decision**: signature RPC existing dipertahankan. Server mengenali role HAR_UIT, memverifikasi `borrowerType=HAR_UIT`, menurunkan `requester_uit_id` dari profil, memastikan seluruh alat satu owner dalam UIT yang sama serta `is_cross_upt_borrowable=true`, lalu membuat status pending approval Asman owner.
- **Rationale**: diff minimum, client lama tetap kompatibel, dan payload tidak menjadi sumber otorisasi.
- **Alternative**: RPC khusus HAR ditolak karena menggandakan locking dan validasi checkout.

## Bukti dan Cache

- **Decision**: HAR_UIT boleh upload bukti hanya ke prefix UPT owner dalam UIT-nya, membaca bukti loan dalam scope UIT, dan menghapus hanya upload orphan yang belum direferensikan. Hasil server kosong untuk HAR_UIT tetap otoritatif.
- **Rationale**: mencegah bukti lintas-UIT bocor serta mencegah fallback cache menampilkan data scope lain.
- **Alternative**: fallback default/cache untuk hasil kosong ditolak karena mengaburkan kegagalan RLS dan berisiko kebocoran data.
