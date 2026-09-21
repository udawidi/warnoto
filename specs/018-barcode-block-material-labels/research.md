# Research: Label Material Barcode Blok

## Decision 1: Sumber klasifikasi

**Decision**: Gunakan `stocks.data` pada baris stok sebagai override, lalu fallback ke `katalog.data`.

**Rationale**: Satu katalog dapat memiliki klasifikasi per stok yang berbeda. Barcode blok menampilkan stok fisik pada lokasi tertentu, sehingga nilai baris stok adalah sumber paling spesifik.

**Alternatives considered**: Hanya master katalog ditolak karena dapat salah melabeli override stok. Fetch katalog kedua dari browser ditolak karena menambah permintaan dan duplikasi logika.

## Decision 2: Bentuk status

**Decision**: RPC mengirim `sapLabel` final dengan istilah existing: `SAP — Persediaan`, `SAP — Cadang`, `SAP — Pre Memory`, atau `Non-SAP`.

**Rationale**: Browser tidak perlu menduplikasi aturan klasifikasi. Nilai konsisten dengan menu Data Stok dan Stock Opname.

**Alternatives considered**: Mengirim `sapStatus` mentah ditolak karena data legacy masih membutuhkan resolusi dari jenis dan nomor katalog.

## Decision 3: Grain agregasi

**Decision**: Jumlahkan kuantitas per `(katalog_id, sapLabel, jenisBarang)`.

**Rationale**: Dua stok berkatalog sama tetapi berbeda klasifikasi tidak boleh dilebur menjadi satu baris berlabel salah.

**Alternatives considered**: Agregasi lama per katalog ditolak karena kehilangan klasifikasi per stok.

## Decision 4: Keamanan dan kompatibilitas

**Decision**: Pertahankan token check, fungsi read-only, `SECURITY DEFINER`, `search_path=pg_catalog`, serta grant hanya `anon` dan `authenticated`. UI memberi fallback aman bila dua field belum tersedia.

**Rationale**: Fitur tidak membutuhkan hak baru dan frontend dapat tetap hidup selama urutan deploy.

**Alternatives considered**: Endpoint baru ditolak karena memperbesar permukaan keamanan tanpa manfaat.
