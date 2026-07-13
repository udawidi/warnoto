# Rencana Pemisahan App.jsx (Refactor / Split)

> Dokumen ini adalah **konsep + panduan eksekusi** untuk memecah `App.jsx` yang
> saat ini **± 19.085 baris / 1,2 MB** menjadi banyak file kecil yang rapi.
> Eksekusi dilakukan **bertahap** (per fase), tiap fase di-commit terpisah, dan
> setelah tiap fase **wajib** jalankan `npm run build` untuk memastikan tidak ada
> yang rusak.

---

## 0. Prinsip Utama (baca dulu sebelum eksekusi)

1. **Jangan ubah logika.** Refactor ini murni *memindahkan* kode, bukan menulis
   ulang. Perilaku aplikasi harus 100% sama sebelum & sesudah.
2. **Satu fase = satu commit.** Kalau build gagal, gampang di-rollback
   (`git reset --hard HEAD` atau `git revert`).
3. **Urut dari risiko terendah → tertinggi.** Fase 1–3 hampir tanpa risiko
   (kode "murni"). Fase 5 (pecah `PLNWarehouse`) paling berat → paling akhir.
4. **Setiap kode yang dipindah harus di-`export`**, lalu di file asal (App.jsx)
   diganti dengan `import`.
5. **Cek dependensi.** Sebelum memindah sebuah fungsi/komponen, pastikan semua
   variabel/fungsi/konstanta yang dipakainya ikut diekspor atau ikut dipindah.
6. **Verifikasi tiap fase:**
   - `npm run build` harus sukses (tidak ada error import/undefined).
   - Jalankan `npm run dev`, buka app, cek fitur yang terkait fase itu.
   - Baru `git add -A && git commit`.

---

## 1. Target Struktur Folder

```
warnoto-project/
├─ App.jsx                     ← akhirnya HANYA berisi PLNWarehouse (state + routing tab)
└─ src/
   ├─ constants.js             ← COMPANY, UIT, UPT, WAREHOUSE, DOC_CODE, APP_VERSION, KAPASITAS_LABEL
   ├─ supabaseClient.js        ← createClient + usernameToAuthEmail + AUTH_EMAIL_DOMAIN
   ├─ data/
   │   ├─ masterUit.js         ← MASTER UIT
   │   ├─ masterUpt.js         ← MASTER UPT
   │   ├─ masterGudang.js      ← MASTER GUDANG
   │   ├─ masterTimMutu.js     ← MASTER TIM MUTU
   │   ├─ masterKatalog.js     ← MASTER KATALOG BARANG
   │   ├─ masterLokasi.js      ← MASTER LOKASI GUDANG
   │   ├─ stokSapDefault.js    ← DATA STOK dari SAP PEMAT
   │   └─ blokCoords.js        ← KONFIGURASI KOORDINAT BLOK
   ├─ lib/
   │   ├─ openLocationCode.js  ← (sudah ada)
   │   ├─ ragShared.mjs        ← (sudah ada)
   │   ├─ rag.js               ← blok RAG (knowledge base AI Agent)
   │   ├─ storage.js           ← CLOUD STORAGE auto-detect (sudah ada file src/storage.js — cek dulu)
   │   ├─ utils.js             ← UTILITIES, ENRICHMENT, DOC NUMBER GENERATOR, MIGRATION legacy
   │   ├─ sap.js               ← SAP STATUS DETECTION + PENCARIAN MATERIAL
   │   ├─ attb.js              ← ATTB pipeline + Import Excel ATTB
   │   ├─ forecast.js          ← FORECAST helper
   │   └─ docBuilders/
   │       ├─ tug9.js          ← TUG-9 (Surat Jalan + Bon + Lampiran Foto)
   │       ├─ tug10.js         ← TUG-10 (Bon Pengembalian)
   │       ├─ tug3tug4.js      ← TUG-3 / TUG-4
   │       ├─ tug5.js          ← TUG-5 + TUG-5 (ULTG)
   │       ├─ tug7.js          ← TUG-7
   │       ├─ alatBerat.js     ← Peminjaman Alat Berat
   │       └─ stockOpname.js   ← Berita Acara Stock Opname
   ├─ sync/
   │   └─ supabaseSync.js      ← sync TUG-15, stock_current, foto material
   └─ components/
       ├─ SearchableSelect.jsx
       ├─ Sparkline.jsx
       ├─ BarcodeScanner.jsx
       ├─ GudangCoordConfigPanel.jsx
       ├─ ScanPublicView.jsx
       ├─ AIFaqPanel.jsx
       ├─ TelegramWhitelistPanel.jsx
       ├─ dashboards/
       │   ├─ KPISaldoCards.jsx
       │   ├─ PendingWidget.jsx
       │   ├─ RencanaWidget.jsx
       │   ├─ HeavyEquipmentDashboardSummary.jsx
       │   ├─ AttbDashboardSummary.jsx
       │   ├─ CollapsibleSection.jsx
       │   ├─ ExecOverview.jsx
       │   ├─ DashboardDefault.jsx
       │   ├─ DashboardAsman.jsx
       │   ├─ DashboardManager.jsx
       │   └─ DashboardAnalitikSection.jsx
       └─ tabs/
           ├─ AIAgentPage.jsx
           ├─ ForecastStokPage.jsx
           ├─ StockOpnameTab.jsx
           ├─ StockCountTab.jsx
           ├─ RencanaKedatanganTab.jsx
           ├─ TUG15Tab.jsx
           ├─ HeavyEquipmentTabV2.jsx
           ├─ AttbTab.jsx
           ├─ PetaGudangTab.jsx
           ├─ UsulanKatalogTab.jsx
           ├─ MaterialCadangTab.jsx
           ├─ KapasitasGudangImportTab.jsx
           ├─ KapasitasGudangTab.jsx
           ├─ MigrasiDataTab.jsx
           ├─ BarcodePrintModal.jsx
           ├─ KartuGantungModal.jsx
           ├─ TUG5Tab.jsx
           ├─ TUG3Tab.jsx
           └─ ApprovalTab.jsx
```

> Catatan: sudah ada `src/storage.js` — jangan ditimpa; cek dulu apakah blok
> "CLOUD STORAGE" di App.jsx sama dengan isi file itu. Kalau sama, tinggal impor.

---

## 2. Peta Isi App.jsx Saat Ini (referensi baris)

> Nomor baris bisa bergeser setelah tiap fase. Selalu cari ulang dengan penanda
> `// ─── NAMA ───` sebelum memotong.

| Baris  | Bagian                              | Tujuan fase |
|--------|-------------------------------------|-------------|
| 17     | CONSTANTS                           | Fase 1 |
| 28     | SUPABASE CLIENT                     | Fase 1 |
| 41     | RAG                                 | Fase 3 |
| 300    | CLOUD STORAGE                       | Fase 3 |
| 363    | ATTB pipeline                       | Fase 3 |
| 509    | Import Excel ATTB                   | Fase 3 |
| 624    | MASTER DATA TABLES (header)         | Fase 2 |
| 744    | DEFAULT DATA                        | Fase 2 |
| 749    | MASTER UIT                          | Fase 2 |
| 754    | MASTER UPT                          | Fase 2 |
| 764    | MASTER GUDANG                       | Fase 2 |
| 793    | MASTER TIM MUTU                     | Fase 2 |
| 799    | MASTER KATALOG BARANG               | Fase 2 |
| 947    | MASTER LOKASI GUDANG                | Fase 2 |
| 958    | DATA STOK SAP PEMAT                 | Fase 2 |
| 1107   | MIGRATION legacy flat-stock         | Fase 3 |
| 1171   | DOC NUMBER GENERATOR                | Fase 3 |
| 1191   | UTILITIES                           | Fase 3 |
| 1435   | ENRICHMENT (join stok+katalog)      | Fase 3 |
| 1480   | PENCARIAN MATERIAL                  | Fase 3 |
| 1706   | SAP STATUS DETECTION                | Fase 3 |
| 1793   | KONFIGURASI KOORDINAT BLOK          | Fase 2 |
| 1802   | `GudangCoordConfigPanel` (komponen) | Fase 4 |
| 1885   | `SearchableSelect` (komponen)       | Fase 4 |
| 1932   | `Sparkline` (komponen)              | Fase 4 |
| 1939   | FORECAST                            | Fase 3 |
| 1959   | TUG-9 DOC BUILDER                   | Fase 3 |
| 2139   | TUG-10 DOC BUILDER                  | Fase 3 |
| 2286   | TUG-3 / TUG-4 DOC BUILDER           | Fase 3 |
| 2289   | TUG-5 DOC BUILDER                   | Fase 3 |
| 2369   | TUG-5 (ULTG) DOC BUILDER            | Fase 3 |
| 2428   | TUG-7 DOC BUILDER                   | Fase 3 |
| 2500   | PEMINJAMAN ALAT BERAT DOC BUILDER   | Fase 3 |
| 2556   | BERITA ACARA STOCK OPNAME BUILDER   | Fase 3 |
| 2824   | AI AGENT                            | Fase 3 |
| 2855   | `BarcodeScanner` (komponen)         | Fase 4 |
| 2919   | `PLNWarehouse` (KOMPONEN UTAMA)     | Fase 5 |
| 10147  | ANALYTICS HELPER FUNCTIONS          | Fase 3 |
| 10362  | SUPABASE SYNC (TUG-15)              | Fase 3 |
| 10439  | SUPABASE SYNC (stock_current)       | Fase 3 |
| 10485  | SUPABASE SYNC (Foto Material)       | Fase 3 |
| 10678  | `ScanPublicView` (komponen)         | Fase 4 |
| 10878+ | Dashboard & widget (11 komponen)    | Fase 4 |
| 12411+ | Tab-tab (StockOpnameTab, dst.)      | Fase 4 |

Daftar 38 komponen (nama + baris kira-kira) ada di bagian bawah dokumen ini.

---

## 3. Urutan Fase Eksekusi

### FASE 1 — Konstanta & Supabase client (paling aman)
- Buat `src/constants.js`, pindahkan blok CONSTANTS. `export` tiap konstanta.
- Buat `src/supabaseClient.js`, pindahkan blok SUPABASE CLIENT +
  `usernameToAuthEmail`. `export const supabase`, `export function usernameToAuthEmail`.
- Di App.jsx ganti dengan `import`.
- **Build → commit** ("refactor: extract constants & supabase client").

### FASE 2 — Master data & data statis
- Pindahkan semua MASTER * dan DATA STOK SAP + KONFIGURASI KOORDINAT BLOK ke
  `src/data/*.js`. Ini array/objek statis → paling aman.
- **Build → commit**.

### FASE 3 — Fungsi murni (utils, doc builder, sync, RAG, ATTB, forecast, SAP)
- Pindahkan fungsi-fungsi yang **tidak** pakai React state/hook: UTILITIES,
  ENRICHMENT, DOC NUMBER GENERATOR, MIGRATION, PENCARIAN MATERIAL, SAP STATUS,
  FORECAST, semua DOC BUILDER, ANALYTICS HELPER, SUPABASE SYNC, RAG, ATTB.
- Perhatikan: doc builder sering pakai konstanta (COMPANY, dll) & PLN_LOGO —
  impor dari `src/constants.js` / assets.
- Pecah per sub-langkah (mis. 3a utils, 3b docBuilders, 3c sync) supaya
  commit kecil-kecil.
- **Build → commit tiap sub-langkah**.

### FASE 4 — Komponen mandiri (yang sudah terima props)
- Pindahkan komponen yang sudah berdiri sendiri & menerima props: mulai dari
  yang kecil (`Sparkline`, `SearchableSelect`, `BarcodeScanner`), lalu dashboard
  & widget, lalu tab-tab besar (`PetaGudangTab`, `AttbTab`, `StockOpnameTab`, dst).
- Tiap komponen → satu file `.jsx`, tambahkan `import React hooks` + dependensi
  (konstanta, utils, doc builder) di atasnya.
- **Pecah per komponen atau per grup**, build + commit tiap kali. Ini yang
  memangkas ribuan baris dari App.jsx.

### FASE 5 — Pecah `PLNWarehouse` (paling hati-hati, opsional)
- Komponen utama ± 7.700 baris berisi banyak `useState` + handler + routing tab.
- Strategi: **jangan** langsung dibelah. Lakukan pelan:
  1. Ekstrak handler-handler yang tidak butuh banyak closure ke custom hooks
     (`src/hooks/useXxx.js`).
  2. Kelompokkan state per domain (auth, stok, txns, dll) ke custom hook.
  3. Baru pisahkan bagian render besar (kalau masih ada inline) ke komponen.
- **Ini fase terpisah** — boleh ditunda sampai Fase 1–4 stabil dulu.

---

## 4. Checklist Verifikasi per Fase

```
[ ] git status bersih sebelum mulai fase (atau commit dulu yang ada)
[ ] pindahkan kode + tambah export
[ ] ganti di App.jsx jadi import
[ ] grep sisa referensi lama yang belum ke-import
[ ] npm run build  → SUKSES, tanpa warning "is not defined"
[ ] npm run dev → buka app, cek fitur terkait fase ini
[ ] git add -A && git commit -m "refactor(fase-N): ..."
```

---

## 5. Perintah Bantu (PowerShell / Claude Code)

```powershell
# lihat penanda section terkini
Select-String -Path App.jsx -Pattern '^// ───' | Select-Object LineNumber, Line

# cari definisi komponen
Select-String -Path App.jsx -Pattern '^(export )?(default )?function [A-Z]'

# hitung baris
(Get-Content App.jsx | Measure-Object -Line).Lines

# build & dev
npm run build
npm run dev
```

---

## 6. Daftar 38 Komponen (untuk Fase 4)

Kecil/utility: `GudangCoordConfigPanel`, `SearchableSelect`, `Sparkline`,
`BarcodeScanner`, `ScanPublicView`, `CollapsibleSection`.

Dashboard/widget: `KPISaldoCards`, `PendingWidget`, `RencanaWidget`,
`HeavyEquipmentDashboardSummary`, `AttbDashboardSummary`, `ExecOverview`,
`DashboardDefault`, `DashboardAsman`, `DashboardManager`,
`DashboardAnalitikSection`, `AIFaqPanel`, `TelegramWhitelistPanel`.

Tab/page/modal: `AIAgentPage`, `ForecastStokPage`, `StockOpnameTab`,
`StockCountTab`, `RencanaKedatanganTab`, `TUG15Tab`, `HeavyEquipmentTabV2`,
`AttbTab`, `PetaGudangTab`, `UsulanKatalogTab`, `MaterialCadangTab`,
`KapasitasGudangImportTab`, `KapasitasGudangTab`, `MigrasiDataTab`,
`BarcodePrintModal`, `KartuGantungModal`, `TUG5Tab`, `TUG3Tab`, `ApprovalTab`.

Komponen utama (Fase 5): `PLNWarehouse` (export default).

---

## 7. Estimasi Hasil

Setelah Fase 1–4, `App.jsx` diperkirakan menyusut dari ~19.000 baris menjadi
**± 7.000–8.000 baris** (tinggal `PLNWarehouse`). Setelah Fase 5, App.jsx bisa
jadi < 1.000 baris (hanya kerangka state + routing).
