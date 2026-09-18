# Verifikasi

1. Jalankan `npm run build` dan unit test terkait.
2. Jalankan E2E Stock Opname pada lebar 320/360 px dan desktop: riwayat tidak berada di bawah form; Batal tunggal; blok urut; deskripsi serta label SAP tidak bertumpuk.
3. Buka submenu Riwayat; pastikan draft dan sesi pending kedua jenis tampil dengan aksi lama. Kembali ke kerja tanpa kehilangan input aktif.
4. Pada database scratch yang menerapkan migrasi, cetak QR blok lama dan baru dari Master Gudang. Scan label melalui browser tanpa login dan Mode Lapangan. Periksa token salah/tidak ada tidak membocorkan data.
5. Setelah persetujuan migrasi self-host, ulangi smoke test pada blok uji berawalan `TEST-`.
