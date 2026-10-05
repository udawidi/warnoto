# Research

## Keputusan

- Gunakan service NIIMBOT yang sudah ada; tidak menambah jalur cetak atau dependency.
- Resolver memakai `katalogId`, lalu `canonicalKatalogCode(katalogBaru)` untuk item baru hasil approval.
- Lock memakai ref dan state agar tap ganda tertahan sebelum render berikutnya.
- Canvas `measureText` menjadi sumber kebenaran pembungkus teks; `clip()` dan argumen `maxWidth` menjadi pagar terakhir.
- Tombol memakai ikon dan teks, tinggi minimal 44 px, jarak antarkontrol minimal 8 px, serta status tidak bergantung pada warna.
