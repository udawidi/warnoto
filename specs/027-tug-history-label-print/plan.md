# Implementation Plan: Cetak Label dari History TUG

## Ringkasan

Gunakan ulang `printCompactLabelM2h` untuk tombol per item di dua tampilan History. State cetak bersama ditempatkan di `TransactionHubTab` agar hanya satu pekerjaan aktif. Renderer compact diperketat pada fungsi wrapping yang sudah ada.

## Perubahan

1. Tambahkan resolver katalog murni di domain NIIMBOT: ID lebih dahulu, lalu nomor katalog kanonis.
2. Tambahkan state dan handler cetak bersama di `TransactionHubTab`.
3. Sambungkan aksi ke item approved TUG-3/4 dan TUG-10 dengan target sentuh minimal 44 px dan status inline.
4. Perbaiki wrapping renderer: pecah token panjang, font adaptif, maksimal lima baris, elipsis, clip panel, dan `fillText` dengan `maxWidth`.
5. Tambahkan unit test resolusi dan batas layout, lalu jalankan test serta build.

## Risiko

- Data transaksi katalog baru tidak menyimpan ID master: mitigasi dengan fallback nomor katalog kanonis.
- Nama ekstrem tetap terlalu panjang: mitigasi berlapis melalui wrapping, font adaptif, elipsis, clip, dan batas native canvas.
- Cetak ganda akibat tap berulang: mitigasi dengan ref lock sinkron dan disable global.

## Acceptance Criteria

- Cetak tersedia hanya untuk item transaksi approved yang sudah tersambung ke master katalog.
- Tidak ada dua proses cetak berjalan bersamaan.
- UI tetap ringkas pada ponsel/tablet.
- Deskripsi tidak dapat menyeberang ke area barcode.
- Test dan build lulus.
