# Rencana Implementasi

- Hapus guard wajib foto dari `saveStock`; kontrol Edit Data Stok tetap opsional.
- Tambah validasi foto per-item pada TUG-3, pertahankan validasi TUG-10, dan blokir submit bila upload mandatory gagal.
- Pakai ID transaksi stabil untuk path `tug-photos/<txnId>/item<index>-<field>.jpg`.
- Pada approval final reguler, overwrite `fotoKeseluruhan` dan `img` dengan foto terbaru.
- Ganti body RPC `mtu_khs_apply_tug3_receipt(text,text)` melalui migration idempoten; signature, role, scope, dan idempotency key tetap.
- Tambah guard legacy pada approval TL/TUG-4/Asman agar transaksi lama tanpa foto tidak lolos.
