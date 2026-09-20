# Research: Pool Kuantitas Alat Bantu

## Keputusan

- Satu pool per UPT, lokasi, dan spesifikasi; aset unik tetap mode `UNIT`.
- History return disimpan append-only pada `loan.data.returnEvents`; tabel baru tidak diperlukan.
- Kolom kuantitas typed dipakai untuk constraint, locking, dan perhitungan saldo.
- Checkout v2 menerima item `{equipmentId, quantity}`; RPC lama dipertahankan.
- Approval existing dibuat quantity-aware; return kuantitas memakai RPC terpisah.
- Saldo dihitung dari total immutable, reservasi aktif/pending, rusak, dan hilang.

## Alasan

Model ini menghindari input puluhan aset, mendukung loan paralel, mencegah saldo negatif, dan menjaga history detail dengan perubahan minimum pada struktur live.

## Alternatif yang Ditolak

- Satu baris per plat: lambat dan tidak diperlukan tanpa nomor fisik unik.
- Satu pool per lokasi tanpa spesifikasi: mencampur barang berbeda.
- Tabel return event baru: belum diperlukan karena event hanya dibaca bersama satu loan.

