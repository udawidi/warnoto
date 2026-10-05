# Contract: NIIMBOT Compact Print

## Input

Printer helper menerima satu objek katalog existing dan callback status opsional.

## Preconditions

- `navigator.bluetooth` tersedia.
- Pemanggilan dimulai dari user gesture.
- Perangkat dapat dihubungkan dan diidentifikasi.
- Model hasil identifikasi adalah M2-H dengan ID 4608.

## Output

- Tepat satu raster PNG 567×827 px dikirim dengan density 3 dan ukuran driver `{w_px: 567, h_px: 827}`.
- Raster memuat QR katalog, SATUAN, MATERIAL DESCRIPTION, dan NO. CATALOG.
- Promise selesai hanya setelah pekerjaan diterima tanpa error dari driver.

## Errors

Helper menghasilkan pesan pengguna untuk browser tidak didukung, dialog dibatalkan, Bluetooth/Lokasi tidak siap, model salah, disconnect, dan kegagalan cetak. Error setelah pengiriman dimulai memperingatkan bahwa label mungkin tercetak sebagian. Error tidak menutup atau mengubah alur A4.

## UI Contract

- Tombol direct print disabled selama proses.
- Status proses diumumkan dengan `aria-live`.
- Tombol preview compact terpisah dan tetap memakai HTML print preview.
- Tombol A4 existing tidak mengimpor atau memanggil helper NIIMBOT.
