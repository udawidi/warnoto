# Kontrak Foto Penerimaan

- `fotoBarang`: wajib per item TUG-3 ketika status keluar dari DRAFT.
- `fotoBarangRetur`: wajib per item TUG-10 ketika status keluar dari DRAFT.
- Nilai tersimpan harus berupa URL bucket `tug-photos` dengan path transaksi/item yang sesuai.
- Approval final menulis nilai tersebut ke `stocks.data.fotoKeseluruhan` dan `stocks.data.img`.
- RPC MTU tetap bernama `mtu_khs_apply_tug3_receipt(text,text)`.
