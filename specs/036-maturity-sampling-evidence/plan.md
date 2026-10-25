# Rencana teknis

## Stack dan batasan

React/Vite, Supabase self-host, Edge Function `maturity-drive`, Google Drive, dan bucket private `maturity-evidence`. Migrasi database production hanya dijalankan sesudah persetujuan pengguna. Tidak ada dependensi baru.

## Model dan alur

- Tambahkan metadata eksplisit pada konfigurasi aspek untuk kelompok sampel, minimum, dan slot yang berulang. Simpan identitas sampel stabil beserta label bebas di JSON audit. Gunakan kelompok bersama untuk poin yang merujuk sampel poin lain.
- Tambahkan tautan sampel pada metadata evidence dan folder Drive. Folder tambahan memakai penanda pelengkap, sehingga tidak masuk hitungan evidence wajib.
- Gunakan identitas gabungan sampel dan item untuk review tanpa mengganti alur persetujuan. Perhitungan kelengkapan, level otomatis, ekspor, dan tampilan harus membaca struktur yang sama.
- Jalur upload evidence audit tidak melakukan kompresi atau pemeriksaan ukuran hardcoded. Edge tetap memvalidasi format dan melakukan dual-write Drive lalu self-host; bila backup gagal, rollback berkas Drive dan jangan membuat metadata aktif.
- Tampilkan folder sampel, slot dokumen, status lengkap, dan folder tambahan dalam tampilan ringkas desktop dan mobile. Audit lama tanpa daftar sampel memakai UI lama.

## Risiko

Upload saat ini melewati Edge Function sebagai multipart dan dibaca penuh ke memori. Penghapusan batas aplikasi tidak menjamin setiap ukuran diterima oleh proxy, Drive, atau Storage. Upload resumable adalah pekerjaan lain. Nama sampel bebas harus divalidasi tidak kosong dan disimpan dengan ID stabil agar rename tidak memutus relasi evidence.

## Verifikasi

Unit/kontrak untuk kelompok sampel, batas kelengkapan, review per sampel, kompatibilitas audit lama, folder pelengkap, dan kegagalan dual-write. Build, test suite relevan, pemeriksaan migrasi pada database scratch, serta smoke localhost dengan akun yang sesuai.
