# Claude Handoff WARNOTO

Dokumen ini adalah pintu masuk singkat saat project WARNOTO dipindahkan/dilanjutkan
di sesi Claude yang berbeda (termasuk Claude Code CLI di terminal). Baca ini duluan.

**Handoff terakhir diperbarui: 2026-07-06** (menggantikan versi 5 Juli 2026 — ada 3
commit signifikan tanggal 6 Juli yang belum terangkum, lihat bagian 4 di bawah).

---

## 1. Baca Berurutan

1. `docs/SYSTEM_OVERVIEW.md` (peta besar: tujuan sistem, modul utama, hubungan antar fitur, aturan global)
2. Dokumen ini (`docs/CLAUDE_HANDOFF.md`)
3. `README.md`
4. `docs/WARNOTO_DOCS.md`
5. `App.jsx` (single-file React, ~14.500 baris — jangan baca penuh sekaligus, cari section relevan)
6. `supabase/schema.sql`
7. Spec fitur yang sedang dikerjakan (lihat tabel section 2)

Kalau konteks terbatas, cukup baca section 4 di dokumen ini dulu (ringkasan status
terkini) sebelum membuka `App.jsx`.

---

## 2. File Project Utama

| File | Fungsi |
| --- | --- |
| `App.jsx` | Aplikasi WARNOTO utama, single-file React (Vite). |
| `docs/SYSTEM_OVERVIEW.md` | Peta besar sistem: tujuan, modul utama, hubungan antar fitur, aturan global, link ke tiap spec fitur. |
| `docs/WARNOTO_DOCS.md` | Dokumentasi status/roadmap/keputusan lintas sesi (historis, section-based). |
| `supabase/schema.sql` | Skema Supabase lengkap — master data, katalog/stok, forecast ML, RAG, bot WA/Telegram, Material Cadang Health Index, Kapasitas Gudang, Alat Berat. **Jalankan ulang file ini di Supabase SQL Editor setiap kali ada perubahan skema** (idempotent, aman diulang). |
| `docs/MATERIAL_CADANG_SPEC.md` | Spec fitur Material Cadang + addendum Health Index/AI Insight (**pindah ke `docs/`** sejak 2026-07-06, sebelumnya di `handoff-health-index-material-cadang/`). |
| `docs/TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx` | Template upload Material Cadang. |
| `docs/WA_AI_AGENT_SPEC.md` | Spec awal integrasi AI Agent ke WhatsApp Cloud API (sebagian sudah tidak relevan — WA Bot terblokir Meta, lihat section 4). |
| `docs/GUDANG_CAPACITY_SPEC.md` | Spec fitur Kapasitas Gudang. |
| `docs/archive/` | Snapshot dokumentasi basi (2026-06-30) — cuma referensi historis, jangan dijadikan acuan status terkini. |
| `scripts/bulk_create_users.mjs` + `scripts/users.template.csv` | Daftarkan banyak akun user sekaligus (Supabase Auth + profil) dari 1 CSV. |
| `scripts/nightly_sync.mjs` | Cron malam hari, sync knowledge base bot WA/Telegram (GitHub Actions). |
| `scripts/gen_form_telegram.py` | Generator PDF form pendaftaran whitelist Telegram Bot. |
| `migration-tools/*.mjs` `*.py` | Tools user sendiri untuk bersihkan/backup histori data (di luar alur Migrasi Data bawaan app). |
| `supabase/functions/telegram-webhook/index.ts` | Edge Function bot Telegram — **channel utama AI Agent yang AKTIF berfungsi**. |
| `supabase/functions/whatsapp-webhook/index.ts` | Edge Function bot WA — kode selesai, **tapi terblokir Meta Business Verification** (lihat section 4). |

---

## 3. File Referensi Eksternal (Hidden Cataloger)

Lokasi: `D:\CLAUDE\WARNOTO data\tester`

| File | Fungsi |
| --- | --- |
| `CATALOG MASTER.xlsx` | Referensi standar naming/terminology/classification PLN. |
| `Katalog MARA (01-2026).xlsx` | Referensi SAP MARA — **sudah diimport ke tabel Supabase `mara_catalog` (~42.703 baris)**, bukan lagi cuma file referensi statis. |
| `KAPASITAS GUDANG UIT JBM.xlsx` | Laporan kapasitas gudang UIT JBM (sumber fitur Kapasitas Gudang). |
| `ABC ANALISIS 2020-2022 Signed.pdf`, `Buku Perhitungan Standard Jumlah Mat Cadang Trans.pdf` | Referensi konsep/rumus Material Cadang. |

Jangan auto-import seluruh isi MARA ke Master Katalog WARNOTO tanpa alur Migrasi
Data terkontrol (lihat section 4).

---

## 4. STATUS TERKINI (2026-07-05) — baca ini sebelum ubah apa pun

### ✅ SELESAI — Bug KRITIS: submit Stock Opname ke Asman hilang diam-diam (race condition, 2026-07-07)
Lanjutan investigasi "tidak masuk ke approval Asman" — setelah section Approval terpusat ditambah
(lihat entri di bawah), user tetap lapor tidak muncul. Dicek langsung ke Supabase (`stock_opname`
table via MCP): sesi yang ada statusnya **DRAFT** (`submittedAt: null`), padahal SEMUA 217 item
qty fisik-nya sudah lengkap terisi (`belum_isi_qty: 0`) — jadi bukan soal validasi belum lengkap.
- **Akar masalah sebenarnya**: tombol "Submit ke Asman" (App.jsx, `StockOpnameTab`) memanggil
  `saveOpname(activeOpname)` lalu `submitOpname(activeOpname)` **beruntun tanpa `await`** di
  antara keduanya. Dua-duanya fungsi async yang sync ke Supabase (`syncMasterTable("stock_opname",
  ...)`) untuk baris DB yang SAMA — `saveOpname` menulis versi dengan status DRAFT, `submitOpname`
  menulis versi dengan status PENDING_ASMAN. Karena keduanya jalan PARALEL (network request, bukan
  lagi localStorage yang instan sejak fix sync Supabase sebelumnya), race condition: kalau upsert
  DRAFT dari `saveOpname` selesai LEBIH BELAKANGAN daripada upsert PENDING_ASMAN dari
  `submitOpname`, hasil akhir di database balik jadi DRAFT lagi — diam-diam, toast "Opname
  disubmit!" tetap muncul (dari `submitOpname` yang sempat jalan), user pindah ke halaman list,
  tidak sadar submit-nya "kalah" oleh race.
- **Kenapa baru ketahuan sekarang**: sebelum Stock Opname disinkron ke Supabase (fix sesi ini
  juga), `saveToCloud` cuma menulis ke `CLOUD.set` (localStorage, SINKRON/instan) — urutan
  panggilan tidak masalah karena tidak ada jeda network yang bisa dibalik urutannya. Begitu
  ditambah sync Supabase (network, async, waktu tempuh tidak pasti), race condition ini baru
  benar-benar bisa muncul.
- **Perbaikan**: hapus panggilan `saveOpname(activeOpname)` yang redundan di tombol Submit —
  `submitOpname` sudah men-spread SELURUH object `opn` (semua edit qty/keterangan yang sudah ada
  di `activeOpname`) + set status/submittedAt, jadi `saveOpname` sebelumnya memang tidak perlu
  dipanggil terpisah. Sekarang cuma `await submitOpname(activeOpname)` lalu pindah halaman.
- Sudah dicek: tidak ada pemanggilan `saveOpname`/fungsi approve lain yang punya pola race serupa
  di tempat lain (`approveOpname_Asman`/`approveOpname_Manager`/`rejectOpname` masing-masing
  dipanggil sendirian, tidak digabung dengan fungsi persist lain).
- **⏳ PENDING — data yang sudah terlanjur nyangkut**: sesi `OPN-1783364605873` (217 item, semua
  qty sudah terisi) masih berstatus DRAFT di Supabase. TIDAK diubah langsung lewat SQL (sengaja
  dibiarkan lewat alur normal aplikasi) — user cukup buka lagi sesi itu di menu Stock Opname
  (datanya utuh, semua qty masih tersimpan) dan klik "Submit ke Asman" sekali lagi, sekarang sudah
  aman dari race condition.
- Sudah `npm run build` sukses. Sudah di-push (`d5a9579`).

### ✅ SELESAI — Stock Opname tidak masuk ke halaman Approval terpusat Asman/Manager (2026-07-07)
User lapor: submit Stock Opname ke Asman, tapi "tidak masuk ke approval Asman".
- **Akar masalah**: sesi Opname yang di-submit MEMANG berhasil pindah status ke `PENDING_ASMAN`
  (`submitOpname` bekerja normal), TAPI approval-nya cuma bisa dilihat/diproses lewat menu "Stock
  Opname & Count" sendiri (card `pendingForMe` di `StockOpnameTab`) — **tidak pernah muncul** di
  halaman "✅ Approval" terpusat yang dipakai Asman/Manager untuk semua jenis approval lain (TUG,
  Alat Berat, Kapasitas Gudang, dll). Badge notifikasi juga tidak menghitungnya sama sekali. Jadi
  kalau Asman terbiasa cuma cek menu "✅ Approval", sesi Opname yang menunggu akan terlewat/tidak
  kelihatan — bukan bug data, tapi gap UX/visibilitas.
- **Perbaikan**: tambah section "📋 Stock Opname" di halaman Approval terpusat (App.jsx, sesudah
  section "Peminjaman Alat Berat", sebelum "Riwayat Approval") — pola & styling identik dengan
  section Alat Berat yang sudah ada (list + tombol ✓ Setuju/✕ Tolak, paginasi). Juga: chip filter
  baru "Stock Opname" di dropdown jenis approval, badge count di sidebar nav "✅ Approval" dan di
  prop `opnamePendingCount` (dipakai `ApprovalTab` supaya pesan "✅ Semua sudah diproses" tidak
  salah tampil kalau sebenarnya ada Opname yang masih pending — pola yang sama sudah dipakai untuk
  Alat Berat sebelumnya).
- Menu "Stock Opname & Count" sendiri TIDAK diubah — approval dari sana tetap berfungsi seperti
  biasa, cuma sekarang ADA JALUR TAMBAHAN lewat halaman Approval terpusat juga.
- **⏳ PENDING (belum dikerjakan, gap serupa)**: Stock Count (bukan Stock Opname) approval per-item
  (`approveStockCountItem`) kemungkinan punya gap visibilitas yang sama — belum diverifikasi/
  diperbaiki di sesi ini, scope-nya beda (approval per-item di dalam sesi, bukan per-sesi).
- Sudah `npm run build` sukses. Belum dites manual di browser.

### ✅ SELESAI — Stock Opname: 1 tombol Simpan/Submit, pilihan jumlah baris, foto per item (2026-07-07)
- **Tombol Simpan Draft/Submit ke Asman dobel** (sempat ada di header ATAS dan bawah tabel sekaligus
  setelah perbaikan sebelumnya) — user minta disederhanakan jadi 1. Sekarang HANYA ada di bawah
  tabel (setelah paginasi), header cuma navigasi + judul (+ tombol Download Berita Acara kalau
  status Selesai).
- **Pilihan jumlah baris per halaman**: `PAGE_SIZE` yang dulu hardcode 10 sekarang jadi pilihan
  10/20/50 (tombol toggle di atas tabel, sebelah kiri tombol Scan QR). Mengurangi kebutuhan
  gonta-ganti halaman untuk sesi opname dengan banyak item.
- **Foto per material** (fitur baru): kolom "📷 Foto" di tabel item — 2 slot per baris, **Foto
  Keseluruhan** (🖼️) dan **Foto Nameplate** (🏷️), pola sama persis dengan foto Data Stok yang sudah
  ada (`fotoKeseluruhan`/`fotoNameplate`, `capture="environment"` supaya langsung buka kamera di
  HP). Disimpan sebagai base64 di item (ikut tersimpan otomatis lewat sync `stock_opname` yang
  sudah ada — TIDAK perlu perubahan skema). **Belum wajib diisi** (tidak ada validasi blocking) —
  cuma capability upload, alur hitung tetap 1 material 1 kali difoto sambil dihitung.
- **⏳ PENDING (scope masa depan, disepakati BUKAN dikerjakan sekarang)**: user berencana foto-foto
  ini nantinya dipindah/disimpan ke folder Google Drive terpisah per semester, dengan format nama
  file `Catalog_Tanggal_Status` per item. Saat ini foto masih base64 inline di `data` JSONB
  Supabase (sama seperti foto Data Stok) — belum ada integrasi Google Drive. Kalau nanti dikerjakan,
  perlu: OAuth/service account Google Drive, upload per-foto ke folder semester yang sesuai, ganti
  field foto dari base64 jadi URL Drive, dan strategi migrasi foto lama yang sudah kadung base64.
- Sudah `npm run build` sukses. Belum dites manual di browser.

### ✅ SELESAI — Fix bug lama: Stock Opname SAP salah tandai material terdaftar sebagai "material baru" (2026-07-07, bug KRITIS)
User lapor: banyak baris di Stock Opname SAP berstatus "🆕 Material baru", padahal nama materialnya
tidak ada baik di file yang diupload maupun di data aplikasi (nama tampil kosong/tidak masuk akal).
- **Akar masalah**: `buildItemsFromSAP` (`StockOpnameTab`, App.jsx ~10443) — loop "Items in SAP but
  not in sistem" memakai nama field yang **tidak pernah ada** di hasil `mapSAPRow`: `sr.katalogStripped`,
  `sr.namaBarangSAP`, `sr.satuanSAP`, `sr.qtySAP`. `mapSAPRow` sebenarnya mengembalikan `katalog`,
  `nama`, `satuan`, `qty`. Karena `sr.katalogStripped` selalu `undefined`, `katalogByNo[undefined]`
  selalu gagal ketemu → **SETIAP baris SAP yang diupload dianggap "tidak ada di sistem"**, walau
  materialnya sudah terdaftar di Master Katalog — hasilnya baris duplikat palsu dengan nama/no
  katalog/satuan kosong (`undefined`), persis yang dilaporkan user.
- **Ini bug LAMA** — ada sejak fungsi ini pertama dibuat (bukan regresi dari perubahan sesi ini),
  dikonfirmasi lewat `git log -p` (field mismatch sudah ada di commit paling awal fitur Stock
  Opname). Stock Count TIDAK terdampak — logika perbandingannya terpisah dan sudah memakai nama
  field yang benar (`r.katalog`/`r.qty`).
- **Perbaikan**: field disamakan jadi `sr.katalog`, `sr.nama`, `sr.satuan`, `sr.qty` (App.jsx ~10444-10448).
- Sudah `npm run build` sukses. Belum dites manual di browser — user perlu upload ulang file SAP
  yang sama di Stock Opname dan pastikan sekarang cuma material yang BENAR-BENAR baru (nama valid,
  tidak ada di uploaded file secara ganda) yang muncul sebagai "🆕 Material baru".
- **⚠️ Sesi Opname yang SUDAH dibuat sebelum fix ini** (kalau ada, berstatus DRAFT) kemungkinan
  masih mengandung baris phantom "material baru" berdasarkan snapshot lama — sarankan user buat
  ulang sesi (upload ulang SAP) daripada melanjutkan draft lama yang sudah datanya salah.

### ✅ SELESAI — Stock Opname/Stock Count disinkron ke Supabase (2026-07-07)
User lapor: widget persentase akurasi Stock Count tidak muncul di Dashboard padahal sesi sudah
disubmit lengkap.
- **Akar masalah**: `opnameList`/`stockCountList` cuma tersimpan lewat `CLOUD.set/get` lama, yang
  fallback ke `localStorage` polos di browser (bukan Supabase) — beda dengan `heavy_equipment`/
  `warehouse_capacity` yang sudah dibenahi sesi sebelumnya. Jadi data itu 100% cuma ada di browser
  tempat Stock Count dijalankan, tidak pernah nyampe device/browser lain (termasuk Dashboard kalau
  dibuka dari sesi/device berbeda).
- **Perbaikan**: tabel baru `stock_opname` & `stock_count` di `supabase/schema.sql` (pola sama
  persis `heavy_equipment`: id/data jsonb/created_at + RLS), plus `loadCloud()`/`saveToCloud` di
  `App.jsx` sekarang load-dari & sync-ke Supabase lewat `loadMasterTable`/`syncMasterTable` (pola
  yang sama dipakai domain lain yang sudah lebih dulu dipindah ke Supabase).
- **Migrasi otomatis satu-kali**: karena tabel Supabase baru dibuat (kosong), begitu app dibuka lagi
  di browser/device ASLI tempat Stock Count itu dijalankan, logika fallback akan otomatis push data
  lokal yang sudah ada ke Supabase (`if (cscRemote.length>0) pakai remote; else pakai lokal + push
  ke Supabase`). Setelah push sekali itu, sesi Stock Count akan tampil di Dashboard dari device mana
  pun.
- Migration `add_stock_opname_and_stock_count_tables` sudah diterapkan ke Supabase project
  `tadxodrzoquugnsyejld` lewat MCP, diverifikasi tabel `stock_opname`/`stock_count` sudah ada.
- Sudah `npm run build` sukses.
- **⏳ PENDING**: belum bisa jawab "berapa item selisih & berapa persen" dari sesi Stock Count user
  yang sudah ada — karena baru akan ter-push ke Supabase setelah user reload app di browser/device
  ASLI tempat sesi itu dijalankan. Setelah itu kejadian, bisa cek langsung lewat Supabase.

### ✅ SELESAI — Standarisasi parser titik/koma di SEMUA import file (2026-07-07, bug KRITIS)
User lapor: qty benar "103,5 meter" tercatat "1.035" di app (distorsi ~10x, data kuantitas fisik).
- **Akar masalah ditemukan** di `parseSAPMigration` (Migrasi Data): SELALU menghapus semua titik
  dulu sebelum konversi koma (`.replace(/\./g,"").replace(",",".")`) — kalau nilai asli pakai TITIK
  sebagai desimal (mis. "103.5", bukan ribuan), titiknya ikut terhapus jadi "1035". Bug ini
  memengaruhi qty, harga, Quality Inspection/Blocked/In Transit Stock di Migrasi Data.
- **Inkonsistensi lain ditemukan sekaligus**: `mapSAPRow` (dipakai Stock Opname & Stock Count)
  punya parser qty vs harga yang BEDA logika (qty polos tanpa penanganan ribuan sama sekali; harga
  sudah ada heuristik tapi cuma di situ) — potensi bug serupa kalau ada titik-ribuan di qty.
  Material Cadang AI import (populasi/failure/harga dll) juga masing-masing regex ad-hoc sendiri.
- **Perbaikan**: satu fungsi bersama baru `parseIndoNumber` (App.jsx, dekat `mapSAPRow`), dipakai
  SEKARANG di semua tempat: `mapSAPRow` (Stock Opname/Count), `parseSAPMigration` (Migrasi Data),
  parser Material Cadang AI import, dan `parseKapasitasGudangSheet` (delegasi ke fungsi yang sama).
- **Aturan SENGAJA tidak pernah menebak kalau ambigu** (revisi dari percobaan pertama yang sempat
  pakai heuristik "titik tunggal + 3 digit di belakang = ribuan" — ternyata berisiko salah tebak
  untuk qty/luas presisi bebas desimal): titik dianggap RIBUAN hanya kalau benar-benar tidak
  ambigu (titik lebih dari 1x, ATAU koma juga ada sekaligus). Titik tunggal tanpa koma SELALU
  dianggap desimal — never guess.
- Diverifikasi lewat skrip Node terpisah, 11 skenario (termasuk persis kasus bug user "103,5" dan
  "103.5" → keduanya 103.5, bukan 1035) — semua PASS.
- Sudah `npm run build` sukses.
- **⚠️ PENTING — ini cuma memperbaiki import BARU ke depan, TIDAK memperbaiki data yang SUDAH
  terlanjur salah tersimpan dari import lama** (mis. qty material "meter" yang sudah kadung ke-input
  10x lebih besar). Perlu AUDIT MANUAL terpisah: cek Data Stok untuk item bersatuan desimal (meter,
  kg, dll — terutama hasil Migrasi Data lama) yang qty-nya kelihatan janggal/kelipatan 10-1000x dari
  yang seharusnya, lalu koreksi manual satu-satu. Belum ada tools otomatis untuk audit ini.

### ✅ SELESAI — Review Draft Stock Count: tabel + status "Tidak terdaftar" tegas (2026-07-07)
- Konfirmasi fix multi-sheet sebelumnya berhasil (219 item terbaca, naik dari 151).
- **Review Draft Stock Count** (`StockCountTab`) diubah dari daftar teks 1-baris-per-item jadi
  **tabel** dengan kolom eksplisit: Nama Barang, No. Katalog, Qty SAP, Qty Aplikasi, Selisih,
  Status, Rekomendasi — plus 4 KPI ringkasan di atas (Total/Akurat/Selisih/Belum Terdaftar).
- **Material belum terdaftar di Master Katalog**: dulu qty aplikasinya tampil angka "0" yang
  ambigu (kelihatan seperti "stoknya 0" padahal maksudnya "materialnya belum ada sama sekali").
  Sekarang tampil teks tegas "Tidak terdaftar" (ungu, italic) menggantikan angka 0 — diterapkan di
  tabel Review Draft maupun kartu approval sesi tersimpan (Asman), supaya konsisten di kedua
  tempat.
- Sudah `npm run build` sukses. Belum dites manual di browser.

### ✅ SELESAI — Upload SAP: tombol seragam + baca semua sheet ber-kolom Material (2026-07-07)
- **Tombol upload Stock Opname disamakan** dengan Stock Count (dulu `<input type="file">` polos
  tanpa styling di Opname, sekarang tombol berstyle sama persis "📂 Upload CSV/XLSX SAP").
- **`parseSAPRowsFromXLSX`** (dipakai bersama Stock Opname & Stock Count — cuma 2 pemakai ini di
  seluruh project) dulu cuma baca `wb.Sheets[wb.SheetNames[0]]` (sheet pertama saja). Sekarang baca
  SEMUA sheet — 2 sheet terbaca 2, 3 sheet terbaca 3, dst.
- **Percobaan pertama** (exact-match SELURUH nama kolom antar sheet) **ternyata terlalu ketat** —
  user lapor upload 2 sheet tapi hasil cuma 151 item (harusnya lebih kalau digabung). Kemungkinan
  besar penyebabnya kolom tambahan/beda dikit di salah satu sheet (umum di file Excel nyata) bikin
  exact-match gagal, sheet ke-2 ke-skip diam-diam. **Diperbaiki**: kriteria diperlonggar jadi cukup
  ada kolom `Material` (kolom WAJIB — tanpa ini baris otomatis tidak valid lewat `mapSAPRow` juga),
  tidak peduli kolom lain beda apa pun. Sheet non-SAP (mis. "Ringkasan" tanpa kolom Material) tetap
  otomatis terlewati.
- Diverifikasi 2x pakai skrip Node terpisah (library `xlsx` yang sama): (1) 2 sheet header identik
  + 1 beda → baca 2, lewati yang beda; (2) skenario kolom ekstra/beda dikit di salah satu sheet
  (mensimulasikan kasus nyata yang dilaporkan user) → tetap terbaca semua.
- Sudah `npm run build` sukses. **Belum dites ulang dengan file asli user** yang tadinya cuma
  kebaca 151 item — mohon dicoba lagi upload file yang sama, harusnya sekarang jumlahnya lebih dari
  151 kalau kedua sheet memang beda datanya.

### ✅ SELESAI — Stock Opname: material baru dari SAP ikut approval sesi + scan QR bantu navigasi (2026-07-07)
Direncanakan lewat `/plan-warnoto` (plan-only, ada di `C:\Users\PLN\.claude\plans\cosmic-skipping-balloon.md`), user setuju sebelum eksekusi.
- **Gap ditutup**: `approveOpname_Manager` (App.jsx) dulu diam-diam SKIP baris `TIDAK_ADA_DI_SISTEM`
  (material ada di SAP, belum ada di Master Katalog) — opname bisa selesai penuh tanpa material
  barunya pernah benar-benar masuk Data Stok. Sekarang: kalau qty fisik terisi (>0) saat Manager
  approve, otomatis buat Master Katalog (no. katalog dari SAP, Jenis Barang dari
  `getSAPStatus`-style deteksi 10/7-8 digit) + Data Stok baru (qty = hasil hitung fisik, lokasi
  kosong — tidak ditebak). Qty fisik 0/kosong = diabaikan total (dianggap belum sempat dihitung).
- **Tidak ada approval TL terpisah** (keputusan sengaja, supaya tidak 2 alur approval yang
  membingungkan) — material baru ikut alur Asman→Manager yang sudah ada.
- **Konflik no. katalog** (SAP kebetulan pakai nomor yang sudah dipakai katalog lain) — diblokir
  per-baris (tidak menimpa diam-diam), Manager diberi toast peringatan jelas.
- **Scan QR** (tombol "📷 Scan QR untuk cari baris", pakai `openScanner` yang sudah ada, sekarang
  mendukung target generik `{onDetect: fn}` untuk komponen anak) — cuma bantu lompat & fokus ke
  baris yang benar di tabel, TIDAK mengisi qty otomatis (qty fisik tetap wajib diketik manual).
- **Stock Count** — ditinjau ulang lengkap, TIDAK ADA PERUBAHAN (sudah sesuai: banding-saja,
  toleransi 5% tetap, tidak pernah mengubah data, dashboard akurasi % sudah ada).
- **Bug pra-eksisting ditemukan (belum diperbaiki, di luar scope sesi ini)**: tombol "📄 Download
  Berita Acara" (`downloadBeritaAcara`) memanggil `buildBeritaAcaraHTML` yang **tidak pernah
  didefinisikan/di-import di mana pun** di project — akan error kalau diklik. Perlu sesi terpisah
  untuk membangun fungsi ini dari nol (belum pernah ada, bukan regresi dari perubahan manapun).
- Sudah `npm run build` sukses. **Belum dites manual di browser** — mohon dicek: buat sesi Opname
  SAP dengan minimal 1 baris material baru, isi qty fisik, submit → Asman approve → Manager approve
  → cek Master Katalog & Data Stok baru muncul benar; coba juga tombol scan QR (perlu kamera/HP).

### ✅ SELESAI — Alat Berat & Peminjaman UPT: 1 halaman + scoping UPT Surabaya (2026-07-06)
Direncanakan lewat plan mode (`C:\Users\PLN\.claude\plans\cosmic-skipping-balloon.md`), user setuju.
- **`HeavyEquipmentTabV2`** digabung dari 2 sub-tab ("List Alat"/"Peminjaman & Histori") jadi
  **1 halaman tunggal**: Ringkasan KPI → Overdue → Daftar Alat Berat → Ajukan Peminjaman →
  Peminjaman & Histori, semua di 1 scroll.
- **`canApproveHeavyEquipmentLoan`** (App.jsx ~225) diperketat — dulu `requesterUpt` kosong/rusak
  otomatis dianggap "boleh siapa saja approve" (`!requesterUpt || ...`), sekarang WAJIB match UPT
  user (`!!requesterUpt && userUpt===requesterUpt`, deny-by-default).
- **Panel "Alat Berat Overdue"** dan **`unifiedLoans`** (Peminjaman & Histori) sekarang discope ke
  `effectiveUptFilter` (owner ATAU requester match) — sebelumnya TIDAK difilter UPT sama sekali,
  jadi peminjaman antar 2 UPT lain (sama sekali tidak melibatkan Surabaya) ikut tampil ke
  Admin/TL/Asman Surabaya (termasuk tombol "Tandai Kembali" yang bisa dipakai untuk alat yang
  bukan urusan Surabaya).
- **Form Ajukan Peminjaman**: untuk role selain MSB/Manager UIT, dropdown alat sekarang cuma
  menampilkan alat **di luar UPT sendiri** (`borrowableEquipment`, Surabaya selalu jadi peminjam,
  tidak masuk akal "pinjam alat sendiri"), field "UPT Peminjam" jadi teks statis (bukan pilihan)
  karena sudah pasti UPT sendiri.
- **MSB/Manager UIT** (role yang mengelola banyak UPT) TETAP tidak dibatasi — dropdown "Filter UPT"
  masih bisa pilih "Semua UPT" atau fokus ke 1 UPT tertentu, mempengaruhi semua section sekaligus.
- Sudah `npm run build` sukses. **Belum dites manual di browser** (tidak ada tool browser di sesi
  ini) — mohon dicek: (1) role non-MSB (ADMIN/TL/ASMAN Surabaya) cuma lihat alat & peminjaman
  Surabaya di semua section; (2) kalau ada data peminjaman antar 2 UPT lain, pastikan benar-benar
  tidak muncul di mana pun untuk role Surabaya; (3) MSB/Manager UIT tetap bisa lihat semua UPT.

### ✅ SELESAI — Perbaikan logika Gudang/Sub Gudang/Blok + simplifikasi UI (2026-07-06)
Direncanakan lewat plan mode (`C:\Users\PLN\.claude\plans\cosmic-skipping-balloon.md`), user setuju sebelum eksekusi.
- **Aturan baru (inti perubahan)**: dot koordinat Blok baru HANYA boleh dikonfigurasi di peta
  Gudang keseluruhan kalau Gudang itu **tidak** punya Sub Gudang. Kalau Gudang **punya** Sub
  Gudang, tombol "⚙️ Konfigurasi Koordinat Blok" di level Gudang disembunyikan total — diganti
  catatan yang mengarahkan ke peta Sub Gudang masing-masing. Sebelumnya bisa dikonfigurasi di
  kedua level tanpa aturan ini.
- **Komponen `GudangCoordConfigPanel`** (baru, dekat `SearchableSelect`) — menggabungkan 2 salinan
  JSX yang tadinya nyaris identik (panel Gudang & Sub Gudang), dan kedua opsi ("assign koordinat
  ke blok existing" vs "mode tambah blok baru") sekarang langsung kelihatan begitu panel dibuka
  (dulu opsi kedua disembunyikan di balik toggle terpisah — "klik di dalam klik").
- Tombol duplikat "⚙️ Konfigurasi Koordinat Blok (pakai denah Gudang)" di grup "Umum" **dihapus**.
  Kalau Gudang punya Sub Gudang tapi ada blok legacy tanpa `subGudangId`, sekarang tampil sebagai
  peringatan "⚠️ belum dikelompokkan" + arahan pakai ✏️ Edit (bukan tombol konfigurasi koordinat).
- **Reorder halaman**: "📍 Daftar Blok Lokasi" sekarang tampil duluan (info utama) di tiap grup,
  upload-denah + preview + panel koordinat dipindah ke toggle collapsed-by-default "🛠️ Kelola
  Denah & Koordinat" (state `showGudangDenahTools` level Gudang, `expandedSubGudangToolsIds` Set
  per Sub Gudang).
- **Update lanjutan (sesi sama)**: klik Gudang yang punya Sub Gudang sekarang cuma menampilkan
  MENU Sub Gudang (nama + jumlah blok), belum langsung Daftar Blok Lokasi — klik salah satu Sub
  Gudang baru tampil detailnya (`selectedSubGudangId`, reset tiap ganti Gudang). Kalau Gudang tidak
  punya Sub Gudang sama sekali, langsung tampil daftar blok tanpa menu (tidak ada yang perlu
  dipilih). Blok "tidak terdaftar" (grup Umum, di Gudang yang punya Sub Gudang) sekarang tidak
  dikasih tombol "+ Tambah Blok" — cuma bisa di-assign ke Sub Gudang lewat ✏️ Edit.
- **Approval**: ditambah heading section ("📄 Transaksi TUG" / "📐 Kapasitas Gudang" / "📍 Lokasi
  & Gudang") di `ApprovalTab` saat filter "Semua" dipilih — sebelumnya approval Tambah/Ubah/Hapus
  Blok tercampur tanpa pemisah visual dengan approval transaksi TUG.
- Sudah `npm run build` sukses. **Belum dites manual di browser** (perubahan besar, sentuh alur
  Gudang KETINTANG sebagai contoh) — mohon dicek: (1) Gudang dengan Sub Gudang → level Gudang cuma
  overview, tiap Sub Gudang punya panel sendiri; (2) Gudang tanpa Sub Gudang → konfigurasi
  Gudang-level masih normal; (3) Approval filter "Semua" → heading section kelihatan jelas.
- **Follow-up belum selesai**: verifikasi ke Supabase apakah blok Gudang KETINTANG sudah benar
  `subGudangId`-nya atau ada yang legacy kosong — MCP Supabase sempat error 502 (Cloudflare,
  transient) saat sesi ini, belum sempat dicek ulang.

### ✅ SELESAI — Perbaikan UI Master Gudang & Struktur Organisasi + konfirmasi Gudang baru (2026-07-06)
- **Migrasi Data**: tombol "Lanjut → Preview" dipindah ke dalam kotak upload, cuma muncul setelah file berhasil diupload (sebelumnya elemen terpisah, selalu tampil disabled).
- **Struktur Organisasi**: ditambah KPI ringkasan (Total UIT/UPT/ULTG), kotak pencarian, badge level UIT/UPT, dan UIT bisa di-collapse per item.
- **Master Gudang**: 
  - Tombol "+ Tambah Gudang Baru" ditambahkan (wizard 3 langkah sudah ada di kode sejak lama tapi tidak pernah disambung ke tombol manapun — celah ditemukan user 2026-07-06).
  - Banner info diperbaiki (sebelumnya kontradiktif: bilang "tidak ada input manual" tepat di atas tombol Import).
  - 2 tombol alat perbaikan (Sinkron Koordinat, Gabungkan Duplikat) disembunyikan di balik toggle "🔧 Alat Perbaikan Data Lanjutan" + penjelasan kapan dipakai — sebelumnya sejajar dengan tombol Import utama tanpa konteks.
  - **Pencocokan nama Gudang saat approve import Kapasitas Gudang diperketat** (`normalizeGudangName` — hilangkan tanda baca umum & spasi ganda, bukan cuma trim+uppercase persis) supaya variasi kecil penulisan tidak lagi bikin Gudang duplikat.
  - **Panel konfirmasi Admin baru** (`capacityReviewImportId`/`previewCapacityGudangMatch`/`startCapacityApproval`): kalau approve import Kapasitas Gudang mendeteksi nama Gudang yang tidak cocok apa pun yang sudah ada, Admin diminta konfirmasi dulu per baris — "ini Gudang baru" atau "ini sebenarnya Gudang X yang sudah ada" (dengan saran token-overlap) — SEBELUM `syncGudangCapacityToMasterGudang` benar-benar membuat entri baru. Kalau tidak ada kandidat baru sama sekali, approve tetap langsung jalan tanpa friksi tambahan.
- Semua sudah `npm run build` sukses. Item UI (Migrasi Data, Struktur Organisasi, banner/tombol Master Gudang) sudah dites manual di browser oleh user. **Panel konfirmasi Gudang baru belum sempat dites manual** (butuh skenario: import file Kapasitas Gudang dengan nama Gudang yang sedikit beda dari yang sudah ada) — coba dulu sebelum dianggap final.

### ✅ SELESAI — Pencarian material sinonim-aware PLN (2026-07-06)
- **Kamus istilah** `CATEGORY_SYNONYMS`/`QUERY_SYNONYMS` (`App.jsx`, sekitar baris 972) diperkaya dari sheet `PLN-Terminology` di `D:\CLAUDE\WARNOTO data\tester\CATALOG MASTER.xlsx` (~45 singkatan baru, mis. LA=lightning arrester/penangkal petir, GIS, OH/UG, dll). Sengaja **tidak** memasukkan singkatan 1 huruf atau 2 huruf yang ambigu (K/M/N/P/ST/PR/PB) untuk hindari salah cocok.
- Mesin pencarian (dulu `matchesStockSearch`, khusus Data Stok) digeneralisasi jadi `matchesMaterialSearch` + dipakai di beberapa tempat baru:
  - **Master Katalog Barang** — sebelumnya sama sekali tidak ada kotak pencarian, sekarang ada (`katalogSearch` state, `matchesKatalogSearch`).
  - **Pencarian MARA** di form Tambah/Edit Katalog Barang (`searchMaraCatalog`) — query Supabase `.ilike` diperkaya jadi multi-term via `expandQueryForIlikeSearch` (query "pemutus" ikut cari "cb").
  - **`SearchableSelect`** (komponen dropdown pilih material, dipakai di SEMUA form TUG-5/7/8/9/10 + Stock Opname untuk pilih Nama Barang/Barang dari Katalog) — sebelumnya substring polos, sekarang pakai `matchesMaterialSearch` juga.
- **AI Agent (Tanya AI, web)** — glosarium `CATEGORY_SYNONYMS` disuntikkan ke `systemPrompt` supaya AI paham istilah awam vs singkatan teknis saat menjawab.
- **Bot Telegram/WA (RAG)** — `scripts/nightly_sync.mjs` diperkaya: teks yang di-embed per katalog sekarang menyertakan padanan istilah (`expandNamaForEmbedding`, duplikat kamus yang sama karena `App.jsx` bukan modul Node). **Belum pernah dijalankan ulang** sejak perubahan ini (butuh secret `SUPABASE_SECRET_KEY`/`COHERE_API_KEY` yang tidak ada di `.env` lokal) — efeknya baru kepakai bot setelah nightly cron GitHub Actions jalan berikutnya, atau kalau dijalankan manual dengan secret yang benar.
- Sudah `npm run build` sukses **dan sudah dites manual di browser oleh user (2026-07-06) — konfirmasi berhasil** (Master Katalog + form TUG, pencarian istilah awam seperti "pemutus"/"penangkal petir" berhasil menemukan barangnya).

### ⏳ PENDING — update 2026-07-05 (lanjut nanti)
- **Prioritas:** data history TUG UPT Surabaya sebagai basis forecasting.
- File acuan: `outputs/warnoto-history-clean-upt-surabaya/WARNOTO_History_TUG_Clean_Import_UPT_Surabaya.xlsx` (701 baris `tug15_history_import`, sheet `mapping_material_review` 325 baris material: 147 `MATCH_OK`, 154 `REVIEW_NON_SAP`, 21 `HOLD_NON_SAP`, 3 `WARNING_REVIEW` — total 178 baris material butuh keputusan manual, mewakili 399 baris transaksi).
- **Sudah dibuatkan alat bantu review:** `outputs/warnoto-history-clean-upt-surabaya/USULAN_PENCOCOKAN_MARA_UPT_SURABAYA.xlsx` — 178 nama material di atas sudah dicocokkan otomatis (token overlap nama) ke 42.703 baris `mara_catalog` di Supabase: 98 baris skor kuat (≥2 kata kunci sama, ditandai hijau), 72 baris skor lemah (1 kata kunci, putih), 8 baris tanpa kandidat sama sekali (ditandai merah, kemungkinan barang non-SAP asli).
- **Update 2026-07-06:** kolom `keputusan_admin` & `catatan_review` sudah diisi **draft otomatis** untuk semua 178 baris (format `DRAFT-MATCH <kode> (perlu dicek)` untuk skor kuat, `DRAFT-MATCH <kode>? (perlu dicek teliti)` untuk skor lemah, `DRAFT-HOLD (perlu dicek)` untuk 8 baris tanpa kandidat) — **ini draf, bukan keputusan final**, tetap wajib dicek/dikoreksi Admin di Excel. Kolom `keputusan_tl` sengaja dibiarkan kosong, masih perlu sign-off TL setelah draf Admin dikoreksi. Backup sebelum diisi ada di `USULAN_PENCOCOKAN_MARA_UPT_SURABAYA.BACKUP_2026-07-06.xlsx` (folder sama).
- **Belum ada apa pun yang dieksekusi ke Supabase** untuk data ini — masih tahap review, jangan asumsikan sudah masuk `tug15_history`.
- **Keputusan (2026-07-06):** folder `WARNOTOV2-2757983` (hasil ekstrak zip AppSheet di `D:\CLAUDE\WARNOTO data\Appsheet\_extracted\data`, 349MB) **disimpan sebagai arsip, tidak dihapus** — isinya template dokumen (Berita Acara/Bon/Lampiran TUG) + foto bukti transaksi TUG 8/9/10/34 asli tanggal 2 November 2025, dinilai sebagai audit trail historis, bukan file sementara yang aman dihapus.

### ✅ SELESAI — fix kolom Gudang untuk role TL + approval-gate Asman (2026-07-06, sudah di-commit)
- Root cause kolom "Gudang" kosong ("—") di Data Stok Gudang untuk role TL: 217 baris `stocks` di Supabase memang semuanya belum punya `lokasi_id` (sisa migrasi SAP yang sengaja dikosongkan, lihat aturan "Migrasi Data" di bawah) — bukan bug tampilan.
- Fix di `App.jsx`: dropdown filter Gudang sekarang muncul untuk `["ADMIN","TL"]` (sebelumnya cuma ADMIN), supaya TL bisa pilih gudang mana yang mau diisi lokasinya. Commit `294eb50`.
- **Celah keamanan ditemukan dari fix di atas & sudah ditutup**: dropdown Blok baru membuka jalur TL memindahkan stok yang sudah punya lokasi ke Gudang lain tanpa approval apa pun (padahal aksi sama oleh ADMIN wajib approval TL). Sekarang pemindahan lintas Gudang oleh TL masuk antrian `lokasiMovePending` dengan `lokasiMoveApprover:"ASMAN"`, select ter-disable selama menunggu, ada section approval baru khusus role ASMAN. Isi lokasi kosong / pindah blok dalam Gudang yang sama tetap langsung tanpa approval. Badge sidebar & hitungan `ApprovalTab` sudah diupdate konsisten untuk TL maupun ASMAN. Commit `84d2b0a`.
- Status: sudah `npm run build` sukses dan ter-commit. **Belum ada catatan hasil test manual login TL di browser** — kalau ada laporan bug terkait alur ini, minta console error dulu sebelum menebak fix (lihat section 5 aturan #4).

### ✅ SELESAI — Alat Berat sync Supabase + Approval filter/pagination (2026-07-06, commit `ab4d365`)
- `heavy_equipment`/`heavy_equipment_loans` sekarang auto-sync ke Supabase (sebelumnya localStorage/CLOUD-only, ditemukan saat audit tidak pernah disinkron) — load saat startup, auto-backup tiap perubahan via `syncMasterTable`, pola sama seperti katalog/stocks/warehouse_capacity. Skema: `supabase/schema.sql` section 21, sudah diterapkan ke Supabase project.
- Overdue counter badge sidebar "Alat Berat" sekarang discope ke UPT user (sebelumnya global tanpa filter). Tambah blok "Alat Berat Overdue" di menu Alat Berat & Peminjaman UPT dengan tombol Tandai Kembali langsung di situ.
- Halaman Approval: fix urutan render (judul halaman sempat tertimbun di bawah panel pending), tambah filter jenis approval (TUG/Alat Berat/Stok/Lokasi/Kapasitas Gudang) + pagination 10/20/50 per section termasuk Riwayat Approval (sebelumnya flat 80 baris tanpa pager).
- Dokumentasi: semua spec dipindah ke `docs/`, 17 file snapshot basi 2026-06-30 diarsipkan ke `docs/archive/`, tambah `docs/SYSTEM_OVERVIEW.md`.

### Login & User Management
- Login sudah pindah dari array password polos ke **Supabase Auth** (`auth.users` + tabel `profiles`), username disintesis jadi email lewat `usernameToAuthEmail()` (domain `@warnoto.pln.local`).
- Daftarkan banyak akun sekaligus: `scripts/bulk_create_users.mjs` (baca CSV, service_role key via env var, jangan pernah expose key ini ke browser/App.jsx).
- Role dikenal: `ADMIN, TL, ASMAN, MANAGER, ADMIN_UIT, MGR_LOGISTIK_UIT, ADMIN_ULTG, MGR_ULTG, PENGADAAN, VIEWER`.

### Bot AI (WA + Telegram)
- **Telegram Bot = channel utama yang aktif**, jauh lebih gampang setup daripada WA. WA Bot kodenya sudah jadi tapi **terblokir Meta Business Verification** (error 130497) — jangan buang waktu debug ini lagi sampai user selesaikan verifikasi bisnisnya sendiri di Meta.
- Ada sistem "loop belajar" — nightly cron (`scripts/nightly_sync.mjs`, GitHub Actions) sync `stocks_snapshot`/`ai_faq_curated`/`tug15_history` jadi RAG chunks (Cohere embed), plus panel Admin "Kelola FAQ Bot" untuk kurasi jawaban resmi dari histori chat yang jelek.
- Whitelist WA: **dibiarkan dulu** sampai verifikasi Meta selesai (permintaan eksplisit user, jangan bangun UI untuk ini duluan).
- Whitelist Telegram: dikelola manual oleh Admin lewat Supabase Dashboard, pakai form `scripts/gen_form_telegram.py` yang di-generate jadi PDF untuk disebar ke calon user.

### Migrasi Data SAP/Non-SAP (`MigrasiDataTab`) — ATURAN KEAMANAN PENTING
Setelah serangkaian bug data-loss yang ditemukan/diperbaiki, alur sekarang:
- Baris **Match WARNOTO** (kode sudah ada di Master Katalog): **TIDAK PERNAH ditimpa otomatis**. Ada kolom perbandingan Qty File vs Qty Aplikasi; kalau beda, kotak "Timpa" otomatis tercentang (Admin bisa un-check), kalau sama tidak perlu keputusan apa-apa.
- Baris **baru** (belum ada di katalog): **TIDAK langsung masuk** ke Master Katalog/Data Stok — masuk antrian `migrasiPendingReview`, Admin approve/reject satu-satu.
- **Jangan pernah** membuat fungsi baru yang langsung `setKatalogList`/`setStocks` dengan array yang cuma berisi data batch yang baru diproses — SELALU merge dari state existing (`Map` keyed by id/kode), pola ini sudah beberapa kali jadi sumber bug data-loss di sesi-sesi sebelumnya (`handleBackupAndApply`, `importFromSAP` yang sudah dihapus, `approveCapacityImport`).
- **Jangan** menebak lokasi (Gudang/Blok) untuk baris stok baru — biarkan `null`/"Belum diisi", JANGAN default ke `lokasiList[0]` (array Supabase tidak terjamin urutannya stabil antar reload — ini sumber 3 bug berturut-turut di sesi 2026-07-04).
- Ada panel "📍 Review Lokasi Otomatis" untuk bersihkan data lama yang sempat kena bug lokasi (tombol per-baris + "Kosongkan Semua").

### Kapasitas Gudang
- Sekarang **auto-backup ke Supabase** (`warehouse_capacity`/`warehouse_capacity_imports`, pola jsonb sama seperti katalog/stocks) — sebelumnya localStorage-only.
- `approveCapacityImport` sudah di-fix dari bug destructive-overwrite (merge per-`importBatchId`, bukan timpa total).

### Material Cadang — Health Index + AI Insight
- Fitur lengkap (helper deterministic `calculateMaterialCadangHealthIndex`/`enrichMaterialCadangHealthResults`/`buildMaterialCadangAiContext`/`generateMaterialCadangAiInsights`, UI 5-tab: Dashboard/Health Index/AI Insight/Import & Hitung/Apply Min Qty).
- AI (Groq, `VITE_GROQ_API_KEY`) **cuma kasih insight/diagnosis**, TIDAK PERNAH mengubah `healthIndex`/`recommendedQty`/`minQty`/stok/approval — semua angka resmi dihitung deterministic lokal, tetap jalan tanpa API key AI.
- Sekarang disambung ke 5 tabel Supabase (append-only audit trail lewat `syncMaterialCadangRows()`) — localStorage/CLOUD tetap sumber utama UI.
- Apply Min Qty tetap wajib approval Asman.

### Scan Barcode Multi-Device
- `ScanPublicView` (`?scan=<katalogId>`, tanpa login) — lihat qty + riwayat TUG-2 material. Sekarang mencatat tiap scan ke `stock_scan_log` (device_id acak per-browser) supaya banyak orang bisa scan barcode berbeda bersamaan tanpa bentrok.

### Approval Notifications
- Sempat ada bug: approval "Pemindahan Blok/Edit/Hapus Data Stok" (khusus role TL) tidak ikut terhitung di badge sidebar maupun ringkasan halaman Approval — sudah diperbaiki (2026-07-05). Kalau nambah jenis approval baru, **selalu cek 3 tempat**: badge sidebar (`navItems`), hitungan total di `ApprovalTab`, dan kondisi empty-state "Semua sudah diproses".

### Audit Bug Menyeluruh (2026-07-03)
Sempat dilakukan audit menyeluruh (6 subagent) menemukan & memperbaiki: destructive-overwrite di beberapa fungsi approve, kolom `katalog` basi di beberapa fungsi sync Supabase, silent-fail auto-sync, entropi ID rendah (`uid().slice()` diseragamkan ke `.slice(-6)`), dead code (`HeavyEquipmentTab` legacy dihapus — komponen aktif SEKARANG **`HeavyEquipmentTabV2`**), dan beberapa tabel Supabase yang orphan (sudah ditindaklanjuti satu-satu, lihat commit history).

---

## 5. Aturan Kerja yang Sudah Terbukti Penting (JANGAN diulang kesalahannya)

1. **Approval selalu per-item, tidak pernah bulk** (kecuali sudah ada tombol "Kosongkan Semua"/"Setujui Semua" yang eksplisit diminta user dengan konfirmasi).
2. **Tidak boleh ada duplikat kode/nama** dalam 1 scope (katalog, blok dalam 1 gudang, dst).
3. **Plan dulu, jangan langsung eksekusi** untuk perubahan struktural (reorganisasi menu, migrasi data massal, refactor). User berkali-kali menegaskan ini.
4. **Kalau user laporkan blank page/crash, minta console error (F12) dulu sebelum menebak fix.** Analisis statis di file 14rb baris sering salah tebak (kejadian nyata 2026-07-04: root cause sebenarnya cuma prop `setKatalogList` yang lupa diteruskan, bukan soal shape data seperti dugaan awal).
5. **Saat memperbaiki 1 edge case di fungsi merge/apply, cek ulang apakah guard baru itu diam-diam menelan edge case LAIN yang butuh perlakuan beda.** Kejadian nyata: fix "1 katalog >1 lokasi cuma 1 baris ke-update" sempat ikut men-skip kasus "katalog match tapi belum pernah punya stok sama sekali" yang seharusnya dibuatkan baris baru, bukan di-skip.
6. **Jangan asumsikan urutan hasil query Supabase stabil** kalau tidak ada `.order()` eksplisit — beberapa bug lahir dari asumsi `lokasiList[0]` selalu sama.
7. Selalu `npm run build` setelah edit `App.jsx`, dan kalau ada preview server jalan, reload + cek console sebelum lapor selesai ke user.

---

## 6. Command Verifikasi

```powershell
cd "D:\CLAUDE\WARNOTO CODE\warnoto-project"
npm run build
```

Untuk migrasi/perubahan skema Supabase, jalankan `supabase/schema.sql` lengkap di
Supabase SQL Editor (idempotent, aman diulang berkali-kali).

---

## 7. Kredensial & Environment

- `.env` (tidak ikut git) berisi `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` — kalau pindah komputer, salin manual, JANGAN commit.
- Supabase service_role key / Personal Access Token — HANYA dipakai lewat env var di script lokal (`scripts/*.mjs`) atau GitHub Secrets, TIDAK PERNAH di App.jsx/browser.
- Project Supabase: `tadxodrzoquugnsyejld.supabase.co`.

---

## 8. Prompt Pembuka untuk Sesi Claude Baru

```text
Baca docs/SYSTEM_OVERVIEW.md dulu (peta besar sistem), lalu docs/CLAUDE_HANDOFF.md
(section 4 = status terkini, section 5 = aturan kerja yang wajib diikuti). Project
WARNOTO: single-file React app di App.jsx (~14.500 baris), Vite + Supabase
(Postgres + Auth + Edge Functions untuk bot Telegram/WA).

Jangan refactor besar tanpa diminta. Jangan overwrite katalog/stok/data existing
tanpa merge-safe pattern (lihat section 4 "Migrasi Data" untuk aturan spesifik).
Kalau user lapor blank page/bug aneh, minta console error dulu sebelum menebak fix.

npm run build setelah tiap edit App.jsx.
```
