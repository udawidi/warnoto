# Foto Penerimaan sebagai Foto Data Stok

## Tujuan

- Edit Data Stok dapat disimpan tanpa foto nameplate maupun foto keseluruhan.
- Setiap item TUG-3 dan TUG-10 wajib memiliki foto barang sebelum diajukan.
- Foto penerimaan terbaru menjadi `fotoKeseluruhan` dan `img` saat approval final.
- Jalur MTU menerapkan qty dan foto secara atomik serta idempoten.

## Acceptance criteria

- Draft TUG-3/TUG-10 boleh tanpa foto; status non-draft tidak boleh.
- Gagal upload foto wajib tidak membuat transaksi `PENDING` atau menyimpan base64 ke DB.
- Lampiran opsional tetap boleh pending-sync.
- TUG-10 ATTB tetap mewajibkan foto nameplate.
- Transaksi lama wajib dilengkapi sebelum maju ke tahap berikutnya.
