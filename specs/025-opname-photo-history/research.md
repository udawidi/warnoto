# Research

- Data Stok disimpan sebagai row `stocks` dengan payload JSONB yang dipetakan ke object frontend.
- Sesi disimpan pada `stock_opname`; foto item berada di `data.items[*]`.
- Upload existing memakai bucket `stock-photos`; helper upload mendukung opsi `upsert`.
- Approval existing memakai RPC `approve_stock_opname_asman`; frontend mengirim changed stock rows.
- Modal detail sudah memakai `operations-segments` dan tab `Detail`/`Riwayat`.
- Embedding existing memakai tabel `stock_photo_embeddings` dan RPC global `match_stock_photos`.
- Keputusan: tambahkan helper pure agar approval, UI, dan backfill memakai aturan UPT yang sama.
