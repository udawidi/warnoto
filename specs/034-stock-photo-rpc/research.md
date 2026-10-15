# Research: Penyimpanan Foto Data Stok Aman

## Decision: RPC sempit, bukan pelonggaran trigger

**Rationale**: Error berasal dari full-row upsert stale yang menyentuh marker TUG-3. RPC mengubah JSON server-side di bawah row lock sehingga field terlindungi tetap utuh.

**Alternatives considered**: Refetch lalu merge ditolak karena masih memiliki race antara fetch dan upsert. Pelonggaran trigger ditolak karena membuka mutasi stok di luar approval RPC.

## Decision: RPC OCR terpisah

**Rationale**: Auto-OCR juga memakai full-row upsert. URL foto menjadi compare-and-set agar OCR foto lama tidak menimpa nameplate baru.

## Decision: Pakai helper validasi foto existing

**Rationale**: `stock_opname_photo_url_valid` sudah memvalidasi origin, prefix UPT, bucket, dan keberadaan object.
