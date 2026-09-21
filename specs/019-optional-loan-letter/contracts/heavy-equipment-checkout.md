# Contract: Heavy Equipment Checkout

## RPC yang dipertahankan

- `checkout_heavy_equipment_batch(text[], jsonb, jsonb, text)`
- `checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text)`

Parameter terakhir tetap bernama `p_pickup_evidence_path` untuk kompatibilitas.

## Perilaku

- `borrowerType = HAR_UIT` dan path `NULL`/kosong: diterima.
- `borrowerType = HAR_UIT` dan path terisi: wajib berprefix `<ownerUptId>/`.
- Selain `HAR_UIT`: aturan evidence existing tetap berlaku.
- Respons `batchId`, `loans`, dan `equipment` tidak berubah.
- Metadata `pickupEvidencePath` tetap digunakan; nilainya dapat `null` pada pengajuan HAR UIT baru.

## Keamanan

- Actor HAR UIT hanya dapat meminjam alat dari UPT dalam UIT-nya.
- Path lintas UPT ditolak.
- Storage policy existing tetap digunakan.
- Bukti pengembalian tetap wajib.
