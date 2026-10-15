# RPC Contract: Foto Data Stok

## `update_stock_photo(text, text, text) -> jsonb`

Input: stock ID, field (`fotoNameplate` atau `fotoKeseluruhan`), URL object.

Validasi: authenticated; role ADMIN/TL/SUPERADMIN; `can_access_upt`; row ada; URL/object valid dan prefix UPT cocok.

Efek: row lock, ganti satu foto, append riwayat bila perlu, set `updatedAt`, reset OCR untuk nameplate. Field lain tetap.

Output: stock canonical (`data` + `id`, `katalogId`, `lokasiId`, `uptId`).

## `update_stock_nameplate_ocr(text, text, text) -> jsonb`

Input: stock ID, URL nameplate yang di-OCR, teks OCR.

Validasi role/scope sama. Bila URL server berbeda, tidak menulis dan mengembalikan `updated:false`, `reason:"STALE_PHOTO"`.

Output sukses: `updated:true` dan stock canonical.
