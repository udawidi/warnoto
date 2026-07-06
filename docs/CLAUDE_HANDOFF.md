# Claude Handoff WARNOTO

Dokumen ini adalah pintu masuk singkat saat project WARNOTO dipindahkan/dilanjutkan
di sesi Claude yang berbeda (termasuk Claude Code CLI di terminal). Baca ini duluan.

**Handoff terakhir diperbarui: 2026-07-05** (menggantikan versi 30 Juni 2026 yang sudah
sangat basi — banyak fitur besar berubah sejak itu, lihat bagian 4 di bawah).

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

### ⏳ PENDING — update 2026-07-05 (lanjut nanti)
- **Prioritas:** data history TUG UPT Surabaya sebagai basis forecasting.
- File acuan: `outputs/warnoto-history-clean-upt-surabaya/WARNOTO_History_TUG_Clean_Import_UPT_Surabaya.xlsx` (701 baris `tug15_history_import`, sheet `mapping_material_review` 325 baris material: 147 `MATCH_OK`, 154 `REVIEW_NON_SAP`, 21 `HOLD_NON_SAP`, 3 `WARNING_REVIEW` — total 178 baris material butuh keputusan manual, mewakili 399 baris transaksi).
- **Sudah dibuatkan alat bantu review:** `outputs/warnoto-history-clean-upt-surabaya/USULAN_PENCOCOKAN_MARA_UPT_SURABAYA.xlsx` — 178 nama material di atas sudah dicocokkan otomatis (token overlap nama) ke 42.703 baris `mara_catalog` di Supabase: 98 baris skor kuat (≥2 kata kunci sama, ditandai hijau), 72 baris skor lemah (1 kata kunci, putih), 8 baris tanpa kandidat sama sekali (ditandai merah, kemungkinan barang non-SAP asli). Kolom `keputusan_admin`/`keputusan_tl`/`catatan_review` masih kosong, menunggu direview manual satu-satu oleh Admin/TL.
- **Belum ada apa pun yang dieksekusi ke Supabase** untuk data ini — masih tahap review, jangan asumsikan sudah masuk `tug15_history`.
- **Pending terpisah:** folder `WARNOTOV2-2757983` (hasil ekstrak zip AppSheet di `D:\CLAUDE\WARNOTO data\Appsheet\_extracted`) belum diputuskan mau dihapus atau disimpan.

### ⏳ PENDING — fix kolom Gudang untuk role TL (2026-07-05, belum di-commit)
- Ditemukan: kolom "Gudang" di halaman Data Stok Gudang untuk role TL selalu tampil kosong ("—"), padahal ini bukan bug tampilan — 217 baris `stocks` di Supabase memang semuanya belum punya `lokasi_id` (sisa migrasi SAP yang sengaja dikosongkan, lihat aturan "Migrasi Data" di bawah).
- Bug nyata yang ditemukan & sudah diperbaiki di `App.jsx` (~baris 5648): dropdown filter Gudang sebelumnya cuma muncul untuk role ADMIN, sekarang untuk `["ADMIN","TL"]` — supaya TL juga bisa pilih gudang mana yang mau diisi lokasinya (sebelumnya TL cuma bisa isi lokasi di gudang pertama dalam daftar).
- **Sudah `npm run build` sukses, tapi belum di-commit ke git** (staged, `git status` masih menunjukkan `App.jsx` modified). Perlu ditest dulu sebagai login TL di browser sebelum commit.

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
