# PERATURAN ROLE: FRONTEND DEVELOPER (KEVIN)

**Project:** WARNOTO — Warehouse Intelligent Control for Transmission Operation (PT PLN UPT Surabaya)  
**Developer:** Kevin Setiawan (`kevin`)  
**Role Scope:** Frontend / UI / UX Development Only  

---

## 1. Ringkasan & Tujuan Role

Dokumen ini mendefinisikan aturan dan batasan kerja bagi **Kevin Setiawan (`kevin`)** yang bertindak khusus sebagai **Frontend Developer**. 

Tujuan utama dari aturan ini adalah untuk memastikan bahwa setiap kali developer melakukan commit dan **merge langsung ke branch `main`** pada repositori GitHub WARNOTO, perubahan yang dimasukkan **hanya terbatas pada tampilan/antarmuka antarmuka pengguna (Frontend/UI)** dan tidak mengganggu atau mengubah logika backend, skema database Supabase, maupun fungsi server.

---

## 2. Batasan Hak Akses & Wilayah Kerja (Allowed Scope)

Developer **Kevin (`kevin`)** berhak dan diizinkan melakukan modifikasi, penambahan, dan refactoring pada komponen serta file tampilan berikut:

- **Komponen React UI:** `src/components/**` (Tabel, Modal, Form Tampilan, Button, Layout, Card, Navigasi, dsb.)
- **Styling & CSS:** `src/styles/**`, `index.css`, serta styling utility CSS (Tailwind).
- **Entry & Layout Tampilan:** `App.jsx` (**Khusus bagian visual layout, struktur JSX, dan komponen UI** — bukan query data Supabase/backend logic).
- **HTML & Asset:** `index.html`, gambar, ikon, serta file publik pada folder `public/**`.
- **Pengujian UI:** Script pengujian visual/E2E antarmuka di `tests/e2e/**` (khusus pengujian tampilan/responsivitas UI).

---

## 3. Batasan Ketat & Area Dilarang (Forbidden Scope / Backend Lock)

Saat bekerja dalam kapasitas role Frontend Developer dan melakukan merge ke branch `main`, **DILARANG KERAS** mengedit, menghapus, atau mengubah file/area berikut tanpa koordinasi dan persetujuan tertulis dari Backend Lead / Tim Arsitek:

1. **Skema & Database Supabase (`tadxodrzoquugnsyejld`):**
   - File migrasi SQL (`supabase/migrations/**` atau script query SQL).
   - Struktur tabel, relasi data, RLS (Row Level Security) policies, Triggers, atau RPC Functions di Supabase.
   - Dilarang melakukan perintah `DROP TABLE`, `ALTER TABLE`, atau manipulasi kolom data backend.
   - *Catatan:* Tabel `wa_sync_status` tetap wajib dipertahankan untuk bot Telegram.

2. **Backend Script & Integrasi Server:**
   - Tool migrasi backend (`migration-tools/**`, `scripts/**`, `ml/**`).
   - Bot Telegram dan script otomasi backend.

3. **Konfigurasi Kunci & Environment:**
   - File `.env`, `.env.example`, kredensial Supabase Service Role Key, atau API keys server.

4. **Kontrak Data & Payload API:**
   - Mengubah struktur payload/model data yang dikirim ke atau diterima dari Supabase tanpa penyesuaian backend resmi.

---

## 4. SOP Merge ke Branch `main` di GitHub

Karena push/merge ke branch `main` akan memicu **auto-deploy Vercel**, ikuti tata cara berikut sebelum dan saat melakukan merge:

1. **Pemeriksaan Diff Git (Pre-Merge Audit):**
   - Jalankan `git diff` atau periksa tab *Files Changed* pada Pull Request / Git client.
   - Pastikan **hanya file frontend** (`.jsx`, `.js` UI, `.css`, `.html`) yang terdaftar dalam perubahan.
   - Jika terdapat file `.sql`, `.env`, atau script backend yang tidak sengaja berubah, **batalkan staging** file tersebut sebelum merge.

2. **Pengujian Lokal Sebelum Push/Merge:**
   - Pastikan server dev lokal berjalan lancar via `npm run dev` pada port `3001`.
   - Pastikan tidak ada error kompilasi Vite atau broken JSX layout.

3. **Standar Format Pesan Commit / Merge:**
   Gunakan awalan commit yang menggambarkan perubahan UI, contoh:
   - `feat(ui): pembaruan tata letak dashboard master data`
   - `style(mobile): perbaikan responsivitas dan kontras warna tabel`
   - `fix(ui): penyesuaian posisi modal input material`

---

## 5. Checklist Verifikasi Sebelum Direct Merge

Sebelum menekan tombol Merge di GitHub atau melakukan push langsung ke `main`:

- [ ] Perubahan **100% murni tampilan/UI** (JSX, CSS, komponen visual).
- [ ] **Tidak ada** file SQL / migrasi Supabase yang tersentuh.
- [ ] **Tidak ada** file `.env` atau kunci rahasia yang terikut.
- [ ] Aplikasi lulus uji tampilan lokal pada `http://localhost:3001/`.
- [ ] Tampilan responsif di layar Desktop dan Mobile tanpa overflow.

---
*Peraturan ini berlaku efektif untuk seluruh commit dan merge yang dilakukan oleh Kevin Setiawan (`kevin`) pada repositori GitHub WARNOTO.*
