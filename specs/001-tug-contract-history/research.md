# Research: Riwayat Sumber Kontrak TUG-8/9

## Decision: Snapshot informatif terpisah

`source_snapshot` berada di luar `tug_items.snapshot` agar backfill tidak mengubah hash dan bukti approval lama.

**Alternatives considered**: Menambah `kontrakRefs` ke snapshot signed ditolak karena memerlukan penandatanganan ulang histori; membaca stok hidup ditolak karena histori dapat berubah setelah transaksi.

## Decision: Derivasi server-side

RPC mengambil sumber dari baris `stocks`, bukan payload client. Signature RPC tetap.

**Alternatives considered**: Snapshot client ditolak karena bisa dipalsukan; tabel baru ditolak karena satu kolom JSON existing lebih kecil dan RLS `tug_items` sudah tersedia.

## Decision: Bukan FIFO

Semua kontrak yang tersedia pada waktu transaksi disimpan sebagai riwayat informatif. Tidak ada klaim batch mana yang benar-benar keluar.

## Decision: Backfill temporal dan idempoten

Kontrak TUG-3 dicocokkan dengan katalog canonical + lokasi + UPT. Histori item hanya mengambil kontrak yang waktunya tidak melewati waktu transaksi.
