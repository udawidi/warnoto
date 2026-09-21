# Freeze Removal Contract

## Save/update Stock Opname

- Input valid harus dapat disimpan tanpa pemeriksaan freeze.
- Tidak boleh memanggil RPC, trigger, guard, atau helper yang khusus freeze.
- Perubahan tetap memperbarui `updated_at` sesuai perilaku existing.

## Compatibility

- Realtime `stock_opname` tetap aktif.
- Nilai legacy `freeze` tidak dihapus atau diubah massal.

## Migration contract

- Migration drop hanya menargetkan database object khusus freeze.
- Migration tidak boleh drop `stock_opname`, Realtime publication, atau `updated_at`.
- Migration tidak melakukan mass-update legacy rows.

## Regression contract

- ADMIN/Fajar dan TUG dapat save/edit tanpa 403 freeze.
- Bootstrap non-TL/ADMIN tidak mencoba seed `heavy_equipment`; fallback write hanya boleh dilakukan TL.
- GI dan QR/Barcode tetap lulus smoke test.
