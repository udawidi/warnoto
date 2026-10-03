# Photo Scope Contract

- Upload data URL tanpa `uptId` ditolak.
- Storage path: `<upt-id-lower>/<katalog>/<jenis>-<uuid>.jpg`.
- Upload memakai `upsert:false`.
- Result visual search selalu membawa `upt_id`; UI mencocokkan `(upt_id,katalog)`.
- `match_stock_photos_scoped` hanya mengembalikan UPT yang lolos `can_access_upt`.
- Service role adalah satu-satunya writer embedding.
