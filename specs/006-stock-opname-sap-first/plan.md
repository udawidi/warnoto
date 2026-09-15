# Rencana Implementasi

- Tambah helper alur untuk klasifikasi kategori SAP, progres hitungan, dan relasi sesi turunan tanpa perubahan skema.
- Batasi builder sesi SAP baru ke Cadang, Persediaan, dan Pre Memory; batasi builder Non-SAP berdasarkan gudang.
- Simpan `flowVersion`, `sourceSapOpnameId`, `gudangId`, dan `semester` pada JSON sesi baru.
- Tambah stage rail SAP ke Non-SAP, filter kategori, aksi kontekstual tunggal, label Legacy, dan mode lapangan yang lebih fokus.
- Revisi gaya Stock Opname memakai token PLN, radius konsisten, kontrol 40 piksel desktop dan 44 piksel mobile, tabel desktop serta kartu mobile.
- Tambah unit test dan Playwright untuk alur, deduplikasi, responsivitas, overflow, dan simetri tombol.

## Batasan

- Stock Count, approval, freeze, dokumen, route, role, RLS, dan skema database tidak berubah.
- Tidak menambah dependensi.
- Draft lama tidak diubah atau difilter ulang.

