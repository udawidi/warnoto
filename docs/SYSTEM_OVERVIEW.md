# WARNOTO — System Overview

Peta besar sistem WARNOTO: kenapa aplikasi ini ada, modul apa saja yang membentuknya,
bagaimana modul-modul itu saling terhubung, dan aturan global yang berlaku lintas
fitur. Dokumen ini **tidak** menggantikan spec per-fitur — tujuannya supaya sesi
Claude baru (atau kolaborator baru) dapat orientasi cepat sebelum masuk ke detail.

Baca ini **sebelum** `docs/CLAUDE_HANDOFF.md` (yang isinya status sesi terkini, bukan
arsitektur keseluruhan).

---

## 1. Tujuan Sistem

WARNOTO (**War**ehouse Intelligent Co**nt**rol for Transmission **O**peration) adalah
aplikasi digitalisasi gudang untuk PT PLN (Persero) — awalnya dibangun untuk Gudang
Ketintang, UPT Surabaya, lalu berkembang mendukung alur lintas UPT/UIT/ULTG.

Masalah yang diselesaikan:
- Menggantikan pencatatan manual stok material transmisi (kabel, isolator, dll) dan
  dokumen TUG (Tata Usaha Gudang) kertas dengan alur digital yang auditable.
- Menyatukan proses penerimaan, pemakaian, pengembalian, dan mutasi stok ke satu
  sumber data (Supabase), bukan tersebar di Excel per-orang.
- Memberi visibilitas: stok kritis, kapasitas gudang, kondisi alat berat, forecast
  kebutuhan, dan status approval — tanpa harus tanya manual ke Admin Gudang.
- Menjaga jejak approval (siapa mengajukan, siapa menyetujui, kapan) untuk tiap
  perubahan data yang berdampak ke stok fisik.

## 2. Arsitektur Teknis Singkat

- **Frontend**: single-file React (`App.jsx`, ~14.500 baris), build dengan Vite.
- **Backend/Data**: Supabase (Postgres + Auth + Storage + Edge Functions). Lihat
  `supabase/schema.sql` untuk skema lengkap dan `App.jsx` fungsi `syncMasterTable`/
  `loadMasterTable` untuk pola sync generik (jsonb `data` column, upsert+delete-diff).
- **Login**: Supabase Auth (`auth.users` + tabel `profiles`), bukan password hardcoded.
- **Bot AI**: Edge Function Telegram (`supabase/functions/telegram-webhook`, aktif)
  dan WhatsApp (`whatsapp-webhook`, kode selesai tapi terblokir Meta Business
  Verification). Keduanya baca knowledge base dari `rag_chunks` (di-generate nightly
  cron, `scripts/nightly_sync.mjs`).
- **Role dikenal**: `ADMIN, TL, ASMAN, MANAGER, ADMIN_UIT, MGR_LOGISTIK_UIT,
  ADMIN_ULTG, MGR_ULTG, PENGADAAN, VIEWER` — tiap role membatasi menu & aksi yang
  bisa dilakukan (lihat kode `navItems`/`ROLES` di `App.jsx`).

## 3. Modul Utama

| Modul (menu) | Fungsi Inti |
| --- | --- |
| **Dashboard** | Ringkasan stok kritis, nilai inventori, TUG pending, alat berat, dll — beda tampilan per role. |
| **Data Stok** | Master Katalog barang, Data Stok per Gudang/Blok, Master Gudang/Lokasi, Satpam, Tim Mutu, Migrasi Data SAP/Non-SAP, dan sub-modul **Material Cadang** (ABC/policy + Health Index + AI Insight). |
| **Master Data** | Struktur organisasi UIT/UPT/ULTG dan referensi master lain. |
| **TUG (Transaksi)** | Dokumen Tata Usaha Gudang: TUG-3/4 (penerimaan), TUG-5 (permintaan barang), TUG-7 (antar UIT), TUG-8 (pemakaian unit lain), TUG-9 (bon pemakaian), TUG-10 (bon pengembalian), TUG-15 (laporan mutasi/histori). |
| **Approval** | Titik kumpul semua approval lintas modul: TUG, Lokasi/Blok, Pemindahan/Edit/Hapus Data Stok, Kapasitas Gudang, Peminjaman Alat Berat — difilter per jenis + pagination (lihat section 4). |
| **Alat Berat & Peminjaman UPT** | Monitoring alat angkat/angkut, peminjaman antar-UPT dengan approval Asman pemilik, reminder overdue, histori. Sekarang auto-backup ke Supabase (`heavy_equipment`/`heavy_equipment_loans`). |
| **Stock Opname & Count** | Sesi hitung fisik stok, banding qty SAP vs Aplikasi, temuan selisih perlu approval Asman. |
| **Rencana Kedatangan** | Perencanaan barang yang akan datang (dipakai juga oleh role PENGADAAN). |
| **Kapasitas Gudang** | Import laporan kapasitas (m²) per UPT/Gudang/Sub Gudang, dashboard status kritis/waspada, auto-backup Supabase (`warehouse_capacity`/`_imports`). |
| **Forecast Stok** | 2 metode: heuristik (rata-rata pemakaian historis TUG-9/8) dan ML Prophet (butuh histori TUG-15 cukup). |
| **AI Agent** | Chat AI berbasis RAG (stok, histori, FAQ kurasi) — juga jadi basis bot Telegram/WA. |

## 4. Hubungan Antar Fitur

- **Master Katalog × Lokasi → Data Stok**: satu baris Data Stok adalah junction
  katalog+lokasi. Semua modul lain (TUG, Opname, Forecast, Material Cadang)
  merujuk ke Data Stok/Master Katalog, bukan menyimpan salinan sendiri.
- **TUG → Data Stok**: tiap approval TUG-9/8/10/3/4 mengubah qty di Data Stok
  (TUG-9/8 keluar, TUG-10 masuk, TUG-3/4 masuk dari SAP). TUG-15 adalah *log*
  read-only dari histori mutasi, dipakai juga sebagai basis training Forecast ML.
- **Approval adalah agregator, bukan pemilik data**: halaman Approval hanya
  menampilkan & menindaklanjuti antrian pending yang datanya tetap dimiliki modul
  asal (stok, lokasi, TUG, kapasitas gudang, alat berat). Menghapus/mengubah logic
  approval di satu tempat harus dicek dampaknya ke badge sidebar + hitungan total
  ApprovalTab + empty-state — riwayat bug ini sudah terjadi berkali-kali (lihat
  `docs/CLAUDE_HANDOFF.md` bagian 4-5).
- **Migrasi Data (SAP/Non-SAP) → Master Katalog/Data Stok**: jalur masuk data
  massal, tapi tidak pernah langsung commit — baris baru masuk antrian
  `migrasiPendingReview`, baris match yang beda qty butuh keputusan eksplisit.
- **Material Cadang → Master Katalog + TUG-15 + hidden MARA reference**: Health
  Index/AI Insight dihitung dari data yang sama dipakai modul lain; AI cuma kasih
  narasi, tidak pernah mengubah angka resmi (health index/qty/approval).
- **Alat Berat**: independen dari Data Stok material (aset alat, bukan barang
  consumable), tapi approval peminjamannya masuk ke halaman Approval yang sama.
- **AI Agent (WA/Telegram)**: read-only terhadap Data Stok/TUG-15/FAQ kurasi lewat
  RAG snapshot nightly — tidak pernah menulis balik ke data inti.
- **Forecast Stok**: konsumen TUG-15 + Data Stok, tidak pernah dipakai sebagai
  sumber kebenaran qty (cuma prediksi kebutuhan).

## 5. Aturan Global (berlaku lintas semua modul)

1. **Approval selalu per-item**, tidak pernah bulk kecuali ada tombol eksplisit
   "Setujui Semua"/"Kosongkan Semua" yang diminta & dikonfirmasi user.
2. **Tidak boleh ada duplikat kode/nama** dalam satu scope (katalog, blok dalam
   satu gudang, dst).
3. **Plan dulu, jangan langsung eksekusi** untuk perubahan struktural (reorganisasi
   menu, migrasi data massal, refactor besar).
4. **Data existing tidak pernah ditimpa langsung** — selalu merge-safe dari state
   existing (`Map` keyed by id), khususnya di alur Migrasi Data & approve/reject.
5. **Jangan menebak lokasi (Gudang/Blok)** untuk baris stok baru — biarkan kosong
   sampai eksplisit diisi user; jangan default ke elemen pertama array manapun,
   urutan hasil query Supabase tidak dijamin stabil tanpa `.order()` eksplisit.
6. **Kalau user lapor bug/blank page, minta console error (F12) dulu** sebelum
   menebak fix — analisis statis di file 14 ribu baris sering salah tebak.
7. **`npm run build` wajib setelah tiap edit `App.jsx`**, dan test di browser untuk
   perubahan yang menyentuh alur approval/permission per-role sebelum commit.
8. **AI (Groq/Claude) di fitur manapun cuma kasih insight/narasi** — tidak pernah
   mengubah angka resmi (stok, qty, health index, approval) yang harus tetap
   deterministic dan auditable.

## 6. Link ke Dokumen Per-Fitur

| Dokumen | Isi |
| --- | --- |
| `docs/CLAUDE_HANDOFF.md` | Status sesi terkini, pending items, aturan kerja detail — **baca sebelum ubah kode apa pun**. |
| `docs/WARNOTO_DOCS.md` | Dokumentasi historis section-based (planning awal → implementasi), roadmap. |
| `docs/MATERIAL_CADANG_SPEC.md` | Spec fitur Material Cadang (ABC/policy, Health Index, AI Insight). |
| `docs/WA_AI_AGENT_SPEC.md` | Spec integrasi AI Agent ke WhatsApp Cloud API. |
| `docs/GUDANG_CAPACITY_SPEC.md` | Spec fitur Monitoring Kapasitas Gudang. |
| `supabase/schema.sql` | Skema Supabase lengkap, sumber kebenaran struktur tabel. |
| `docs/archive/` | Snapshot dokumentasi basi (2026-06-30) — referensi historis saja. |

---

*Dokumen ini dibuat 2026-07-06 saat perapian struktur folder dokumentasi (semua spec
dipindah ke `docs/`). Perbarui bagian 3-5 kalau ada modul baru atau aturan global
baru yang disepakati — jangan biarkan dokumen ini basi seperti `WARNOTO_DOCS.md`
sempat basi sebelumnya.*
