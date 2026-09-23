# Research: Persistensi Draft Seluruh TUG

## Decision 1: Jangan ubah tabel canonical

**Decision**: `tug_transactions` tetap khusus TUG-8/9 sesudah Ajukan.  
**Rationale**: Tabel mewajibkan nomor/sequence dan RPC create langsung memvalidasi stok. Draft tidak boleh memakai nomor atau stok.  
**Alternatives considered**: Membuat row canonical status DRAFT ditolak karena perlu melonggarkan kontrak kritis.

## Decision 2: Satu tabel workflow noncanonical

**Decision**: `tug_workflow_transactions` menyimpan TUG-5/TUG-7 sepanjang lifecycle dan draft TUG-8/TUG-9.  
**Rationale**: Empat jenis berbagi bentuk JSON dan kebutuhan version/scope; lebih kecil dari empat tabel.  
**Alternatives considered**: Tabel per TUG menambah kode dan migration tanpa manfaat.

## Decision 3: TUG-3/TUG-10 tetap dedicated

**Decision**: Pertahankan tabel existing, ubah simpan draft menjadi database-first dan nomor baru saat Ajukan.  
**Rationale**: Sudah aktif di production dan memiliki integrasi khusus MTU/retur.  
**Alternatives considered**: Memindahkan ke tabel workflow berisiko merusak FK dan lifecycle.

## Decision 4: RPC versioned, tanpa direct write

**Decision**: Load melalui RLS SELECT; upsert/delete/transisi melalui SECURITY DEFINER RPC dengan expected version.  
**Rationale**: Mencegah overwrite lintas perangkat dan memusatkan validasi scope/tahap.  
**Alternatives considered**: Upsert langsung lebih pendek tetapi tidak menjamin konflik dan role per tahap.

## Decision 5: Migrasi cache additive

**Decision**: Saat boot, upload baris lokal yang belum ada; DB menang untuk ID yang sama; cache tidak dihapus satu rilis.  
**Rationale**: Menjaga draft lama tanpa menimpa data server yang lebih baru.  
**Alternatives considered**: Reset cache berisiko kehilangan draft pengguna.

