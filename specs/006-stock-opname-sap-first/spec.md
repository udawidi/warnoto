# Stock Opname SAP-First

## Tujuan

- Petugas menyelesaikan Stock Opname SAP per gudang sebelum melanjutkan ke Non-SAP gudang yang sama.
- Sesi SAP baru hanya memuat kategori Cadang, Persediaan, dan Pre Memory.
- Pengisian tetap cepat pada desktop dan ponsel tanpa horizontal overflow.
- Draft lama tetap dapat dibuka tanpa perubahan data.

## Acceptance criteria

- Sesi SAP baru tidak memuat stok Non-SAP dan dapat difilter per kategori SAP.
- Tombol lanjut Non-SAP hanya aktif ketika seluruh hitungan fisik SAP pada gudang itu terisi.
- Klik berulang membuka sesi Non-SAP turunan yang sama, bukan membuat duplikat.
- Sesi turunan Non-SAP hanya memuat stok dari gudang sumber dan menyimpan relasi di JSON yang sudah ada.
- Sesi lama diberi label Legacy dan tidak dimigrasikan otomatis.
- UI responsif pada 360, 390, 412, 768, 1024, dan 1440 piksel; tombol berpasangan simetris.

