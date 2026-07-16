# PERINTAH KERJA — PERBAIKAN RESPONSIVE WEB WARNOTO

Lakukan audit dan perbaikan responsive menyeluruh pada aplikasi WARNOTO agar seluruh halaman tetap proporsional, rapi, profesional, mudah dipindai, dan dapat digunakan dengan nyaman pada desktop, tablet, dan HP.

## Sebelum bekerja

1. Baca HANDOFF.md dan ikuti seluruh keputusan arsitektur yang sudah ditetapkan.
2. Periksa git status dan git log terbaru.
3. Jangan mendesain ulang aplikasi, mengganti palet warna, atau mengubah struktur sistem tanpa persetujuan.
4. Lakukan perubahan secara bertahap dan terarah; hindari membaca atau merombak seluruh App.jsx tanpa kebutuhan jelas.

## Ruang lingkup

- Audit seluruh halaman, dashboard, navigasi, sidebar, tabel, kartu, banner KPI, form, modal, dropdown, upload foto, pagination, notifikasi, dan halaman Pak War.
- Perbaiki tampilan yang bertumpuk, terpotong, terlalu lebar, terlalu rapat, tidak sejajar, keluar layar, atau menghasilkan horizontal scroll yang tidak semestinya.
- Pastikan layout tetap nyaman pada portrait dan landscape.
- Pertahankan identitas visual serta gaya enterprise WARNOTO yang compact dan profesional.

## Ukuran layar wajib diuji

- 360×800
- 390×844
- 412×915
- 768×1024
- 820×1180
- 1024×768
- 1366×768

## Aturan responsive

- Tidak boleh ada horizontal scroll pada halaman utama.
- Pada HP, layout utama harus menjadi satu kolom.
- Pada tablet, gunakan satu atau dua kolom berdasarkan ruang yang tersedia.
- Sidebar desktop tetap mengikuti ukuran 260px saat terbuka dan 76px saat compact.
- Pada layar ≤768px, sidebar harus menjadi drawer dan tidak mengurangi lebar konten utama.
- Jangan mengecilkan seluruh tampilan desktop agar muat di HP.
- Hindari fixed width, fixed height, absolute positioning, margin manual, dan inline style yang hanya cocok untuk satu resolusi.
- Gunakan Flexbox/Grid, minmax(), clamp(), max-width, min-width: 0, overflow yang terkontrol, dan breakpoint yang konsisten.
- Ukuran teks tidak boleh kurang dari 12px; teks isi utama idealnya sekitar 14px.
- Tombol dan area sentuh penting minimal sekitar 44px.
- Judul, nama material, nomor aset, status, dan teks panjang harus dapat wrap tanpa merusak layout.
- Gambar menggunakan ukuran responsif dan object-fit yang sesuai.
- Tidak boleh ada tombol aksi yang keluar layar atau tertutup elemen lain.

## Tabel

- Pertahankan keterbacaan data.
- Jangan mengecilkan font secara berlebihan.
- Pada layar sempit, gunakan container scroll horizontal khusus tabel atau tampilan kartu jika struktur tabel memang tidak layak dipertahankan.
- Header, filter, pagination, dan tombol aksi harus tetap dapat digunakan.
- Scroll tabel tidak boleh membuat seluruh halaman ikut melebar.

## Form dan modal

- Form HP menggunakan susunan satu kolom.
- Label, input, select, textarea, tombol, dan pesan validasi tidak boleh bertabrakan.
- Modal menggunakan lebar fleksibel, jarak dari tepi layar, dan max-height sekitar 90dvh.
- Isi modal harus dapat di-scroll, sementara header dan tombol aksi tetap mudah dijangkau.
- Periksa penggunaan keyboard virtual pada HP agar input dan tombol simpan tidak tertutup.
- Dropdown dan date picker tidak boleh keluar viewport.

## Batasan

- Jangan mengubah logika bisnis, proses approval, role pengguna, Supabase schema, kontrak API, penyimpanan data, AI Pak War, atau alur transaksi.
- Jangan menambahkan dependency baru tanpa persetujuan.
- Jangan melakukan refactor besar atau memecah App.jsx sebagai pekerjaan sampingan.
- Jangan menghapus fitur untuk menyelesaikan masalah layout.
- Jangan melakukan perubahan global CSS tanpa memeriksa dampaknya pada seluruh halaman.
- Pertahankan seluruh fungsi desktop yang sudah berjalan.

## Urutan pengerjaan

1. Jalankan aplikasi dan dokumentasikan masalah responsive per halaman.
2. Prioritaskan masalah kritis: overlap, konten keluar layar, navigasi tidak dapat digunakan, modal terkunci, form tidak dapat disimpan, dan tombol tidak dapat ditekan.
3. Perbaiki komponen atau selector paling lokal terlebih dahulu.
4. Uji ulang desktop, tablet, dan HP setelah setiap kelompok perubahan.
5. Pastikan perbaikan satu halaman tidak merusak halaman lainnya.
6. Jalankan pemeriksaan akhir seluruh route dan role utama.

## Acceptance criteria

- Tidak ada overlap atau konten penting terpotong.
- Tidak ada horizontal scroll pada body halaman.
- Sidebar dan navigasi bekerja pada desktop, tablet, dan HP.
- Semua form, modal, tabel, tombol, filter, dropdown, dan pagination tetap berfungsi.
- Tampilan portrait dan landscape tetap proporsional.
- Tidak ada teks penting di bawah 12px.
- Tidak ada perubahan pada logika bisnis dan data.
- Tidak ada error console baru.
- npm run build berhasil.
- git diff --check berhasil.
- git status hanya menunjukkan file yang memang termasuk scope perbaikan.

## Verifikasi akhir

- Jalankan npm run build.
- Jalankan git diff --check.
- Uji seluruh ukuran viewport wajib.
- Lakukan smoke test route utama dan role utama.
- Bandingkan tampilan sebelum dan sesudah.
- Perbarui HANDOFF.md dengan halaman yang diperbaiki, hasil verifikasi, masalah yang masih tersisa, dan langkah berikutnya.

Jangan menyatakan pekerjaan selesai hanya karena build berhasil. Pekerjaan selesai setelah seluruh viewport wajib diperiksa dan tidak ditemukan kerusakan layout atau fungsi utama.
