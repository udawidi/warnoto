# Implementation Plan: Riwayat dan QR Blok

1. Tambah subtab Riwayat dengan dua daftar sesi. Jaga sesi Opname aktif saat berpindah subtab; pindahkan aksi lama bersama daftar. Stock Count kerja tetap berisi unggah dan review draft.
2. Rapikan Opname: satu tombol Batal di bawah, urut gudang/blok alami, dan tata nama material serta label SAP di baris terpisah. Terapkan urutan yang sama di Mode Lapangan.
3. Tambah migrasi token dan RPC publik terbatas. Token diambil langsung dari tabel `lokasi` hanya saat Master Gudang mencetak satu/semua label. Pakai label QR yang sudah ada.
4. Tangani `?loc=` sebelum login untuk halaman blok publik. Bagian fragment `#t=` hanya dipakai browser saat memanggil RPC. Mode Lapangan tetap membaca ID lokasi dari QR yang sama.
5. Verifikasi UI, kontrak anon, kompatibilitas QR Mode Lapangan, build, dan hasil cetak. Migrasi production hanya diterapkan setelah persetujuan pengguna.

Tidak ada dependensi baru. Perubahan sesi Opname/Stock Count maupun RLS tabel sumber tidak diperlukan.
