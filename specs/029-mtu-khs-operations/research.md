# Research: Operasional MTU KHS

## Keputusan

- Gunakan RPC security-definer dan RLS; client tidak mendapat direct update tabel.
- Gunakan katalog canonical dan snapshot triad master; tidak ada input Code Catalog bebas.
- Gunakan `pg_trgm` serta normalized token ranking karena pencarian sekarang hanya satu `ILIKE` haystack.
- Gunakan private bucket baru dan tabel evidence; satu active row per record/kind, riwayat tidak dihapus.
- Gunakan transfer request khusus. Partial transfer split record, full transfer mempertahankan record ID.
- Batasi saldo transferable dengan ikatan receipt, approved TUG usage, dan stock links.
- Jangan sync fitur baru ke Google Sheet; Sheet tetap sumber import.

## Alternatif Ditolak

- Memakai change-request legacy: tidak cukup untuk lineage, target scope, dan audit dua UPT.
- Menyimpan foto di JSON record: tidak aman untuk active/history dan signed access.
- Client-side fuzzy search: merusak pagination dan facet server.
- Memindahkan `stocks` bersama MTU: melanggar domain TUG dan risiko saldo ganda.
