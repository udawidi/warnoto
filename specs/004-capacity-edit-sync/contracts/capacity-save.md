# Contract: Simpan Kapasitas

## Callback UI → App

`onSaveCapacityRow(updated)` bersifat asynchronous dan mengembalikan boolean.

Payload `updated` selalu membawa `luas_terpakai_m2`, `sisa_luas_m2`, `persentase_terpakai`, dan status yang diturunkan dari luas lahan serta lima komposisi. Form tidak menerima luas terpakai sebagai input terpisah.

- `true`: upsert DB berhasil; UI boleh memperbarui detail dan menawarkan sinkron Sheet.
- `false`: DB gagal; UI mempertahankan modal dan nilai input.

## Edge Function Sheet Existing

Request preview: `{ "rows": [row], "dryRun": true }`.

Request write setelah konfirmasi: `{ "rows": [row] }`.

Respons sukses preview berisi `toUpdate` dan `toInsert`. Respons write berisi `updated` dan `inserted`. Kegagalan Sheet tidak membatalkan DB; UI harus melaporkan status parsial.
