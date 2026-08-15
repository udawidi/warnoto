# WARNOTO — Audit Responsif Mobile & Rencana Perbaikan

**Tanggal:** 2026-08-15 · **Auditor:** Claude (arsitek) · **Status:** audit selesai, implementasi BELUM dimulai (menunggu persetujuan user)

Cakupan: **seluruh 14 menu** + shell aplikasi + halaman publik. 67 file JSX (`App.jsx`, `src/components/*`, `src/hooks/*`), 3 file CSS (165 KB total).

---

## 0. Metode & batasannya

Audit dilakukan **statis** dengan scanner anti-pattern yang ditulis khusus, bukan tebakan atau sampel. Yang dideteksi: grid kolom-tetap, `minmax`/`minWidth` lebih lebar dari layar HP, font < 12 px, `whiteSpace:nowrap` tanpa `minWidth:0`, tabel tanpa fallback kartu, dan tap target < 44 px.

**Yang BELUM dilakukan:** verifikasi visual di browser/emulator HP. Semua temuan di bawah adalah cacat yang terbukti dari kode; seberapa parah tampak di mata masih perlu satu putaran screenshot. Itu masuk Fase 0 rencana.

---

## 1. Kesimpulan utama

Aplikasi ini **bukan** "belum dikerjakan mobile-nya" — justru sebaliknya: mobile sudah dikerjakan **berkali-kali dengan cara yang berbeda-beda**, tanpa pernah dibakukan. Itu sebabnya hasilnya terasa tidak konsisten.

Ada **empat sistem responsif paralel** yang hidup bersamaan:

| # | Sistem | Sebaran | Masalah |
|---|--------|---------|---------|
| 1 | Media query CSS manual | 24 blok, **7 breakpoint berbeda** (480/520/700/768/800/900/980 px) | Elemen bersebelahan patah di lebar berbeda → layout "loncat" |
| 2 | Prop `isMobile` (JS, `innerWidth<=768`) | 24 dari 63 komponen; 5 file memakai serius, sisanya 1–4 kali (tempelan) | Butuh prop-drilling; komponen yang tidak menerimanya mustahil responsif |
| 3 | Tailwind v4 | **0 penggunaan** `sm:`/`md:`/`lg:` di seluruh `src/` | Terpasang, dibayar di bundle, tidak dipakai |
| 4 | Class bespoke per-tabel | `.stock-card-table`, `.forecast-card-table`, `.attb-card-table`, `.catalog-card-table`, `.permission-matrix-table`, `.capacity-data-list`, `.dashboard-manager__table-scroll` | Tiap tabel butuh ±40 baris CSS tulis-tangan sendiri → tidak menskala, itu sebabnya berhenti di 4 tabel |

**Akar masalah teknis paling menentukan: 3.448 inline `style={{…}}`.** Inline style mengalahkan class CSS apa pun dan **buta total terhadap `@media`**. Selama layout hidup di inline style, tidak ada breakpoint — Tailwind maupun CSS — yang bisa menyentuhnya. Ini konsekuensi langsung dari keputusan lama "preflight OFF supaya inline style App.jsx tidak berubah" (`src/index.css` L1–3).

---

## 2. Temuan sistemik (angka penuh)

| Temuan | Jumlah | Dampak di HP |
|---|---|---|
| Inline `style={{…}}` | **3.448** | Kebal media query — akar semua masalah di bawah |
| Tabel `minWidth` 480–1200 px | **10 tabel** | Layar HP 360–390 px → scroll horizontal jauh, kolom terpotong |
| `whiteSpace:"nowrap"` tanpa `minWidth:0` | **98** | Teks tidak wrap → **tumpang tindih** persis seperti yang dikeluhkan |
| `fontSize` < 12 px | **43** (25 di antaranya layout cetak, sah) | Sisanya melanggar floor 12 px yang sudah jadi preferensi user |
| `minmax(≥260px, …)` di grid | **10** | Grid tidak pernah turun ke 1 kolom → melebar keluar layar |
| `repeat(N,1fr)` N>2 tanpa `isMobile` | **3** | Kolom gepeng tak terbaca |
| `maxWidth` px tetap ≥ 380 | **15 file** | Panel/modal lebih lebar dari layar |
| Tabel total vs punya fallback kartu | **33 vs 4** | **29 tabel** masih tabel mentah di HP |

**Yang sudah benar dan JANGAN dirusak** (hasil kerja sesi-sesi lalu, terbukti di `src/index.css` ~L2054):
- Tap target 44 px dipaksa global untuk semua `button`/`input`/`select` di `.app-content` pada ≤768 px.
- `font-size: max(16px,1em)` pada input → mencegah auto-zoom iOS.
- Checkbox/radio diperbesar ke 44 px.
- Sidebar jadi `position:fixed` + overlay di ≤768 px.

Catatan penting: aturan `min-width:44px !important` global itu, saat bertemu baris tombol padat + `nowrap`, **justru ikut menyebabkan overflow**. Jadi dua perbaikan lama saling bertabrakan.

---

## 3. Audit per menu (14 menu, satu per satu)

Skor = bobot cacat (grid×3 + minmax×2 + minWidth×3 + font×1 + nowrap×1 + tabel-tanpa-kartu×4). Makin tinggi makin parah.

### 🔴 Prioritas 1 — rusak nyata di HP

**1. ATTB / Penghapusan Aset** — `AttbTab.jsx` · skor **30** (tertinggi)
- 3 tabel: `minWidth:820` (L358), `760` (L430), `480` (L802). Hanya **satu** yang dapat perlakuan kartu (`attb-card-table`).
- **21 `nowrap`** — terbanyak di seluruh aplikasi. Baris L375–L379 (Qty, No Seri, No Asset, TUG-10, Tanggal) semuanya `nowrap` berturut-turut → sederet kolom yang menolak wrap dalam satu baris sempit.
- Chip status (L485–488) `nowrap` + `maxWidth:120` → teks terpotong di tengah kata.

**2. Material Cadang** — `MaterialCadangTab.jsx` · skor **26**
- Tabel `minWidth:1200` (L785) — **terlebar di aplikasi**, ±3,3× lebar layar HP. Tanpa fallback kartu sama sekali.
- Grid `minmax(0,1.2fr) minmax(280px,.8fr)` → kolom kanan mengunci 280 px, tidak pernah turun ke 1 kolom.
- Grid metode `repeat(auto-fit,minmax(260px,1fr))`.

**3. Kartu Gantung (cetak)** — `KartuGantungModal.jsx` · skor **29**
- 17 `fontSize` < 12 px (9,5–11 px) dan 3 tabel.
- ⚠️ **Ini layout CETAK, bukan layar.** Font kecil di sini **disengaja dan benar**. Yang salah adalah modal pratinjaunya dipakai apa adanya di HP. Perbaikannya: pisahkan gaya `@media print` dari gaya layar — **jangan** naikkan font-nya, itu akan merusak hasil cetak kartu gantung.

**4. TUG-15 / Mutasi** — `TUG15Tab.jsx` · skor **20**
- Tabel `minWidth:1050` (L222) tanpa fallback kartu.
- 6 `nowrap` + 7 font < 12 px. Kolom deskripsi & keterangan pakai `ellipsis`+`nowrap` → di HP praktis hanya terlihat 2–3 huruf.

**5. Master Data** — `MasterDataTab.jsx` · skor **20**
- 2 tabel `minWidth:720` (L159, L750). Baru **1** yang jadi `catalog-card-table`; tabel kedua masih mentah.
- Grid kartu `minmax(260px,1fr)` dan `minmax(320px,1fr)` → yang 320 px sudah lebih lebar dari sebagian HP.
- 9 `nowrap`.

### 🟠 Prioritas 2 — cacat jelas, dampak sedang

**6. Maturity** — `MaturityAuditSystem.jsx` (1.789 baris) · skor **19** — 2 tabel tanpa kartu, 2 grid `minmax` lebar, 7 `nowrap`. Positifnya: 40 pemakaian `isMobile`, jadi sebagian sudah sadar mobile.

**7. Migrasi Data** — `MigrasiDataTab.jsx` · skor **19** — 3 tabel, satu `minWidth:760`, **nol** `isMobile`.

**8. Inspeksi Material** — `InspeksiMaterialCadangTab.jsx` · skor **18** — `repeat(3,1fr)` kaku, `minmax(320px,1fr)`, 8 font < 12 px. Ini form checklist lapangan yang **justru paling sering dipakai di HP** — bobot kepentingannya lebih tinggi dari skornya.

**9. Stock Opname** — `StockCountTab.jsx` skor **12** + `StockOpnameTab.jsx` skor 6 — `repeat(3,minmax(0,1fr))` (L175) untuk 3 KPI, 4 `nowrap` di kolom selisih.

**10. Kapasitas Gudang** — `KapasitasGudangTab.jsx` (tabel `minWidth:900`) + `KapasitasGudangImportTab.jsx` (`minWidth:1050`) · skor 8+8 — punya `data-label` (10 buah) tapi belum disambungkan ke pola kartu; sebagian ditangani `.capacity-data-list` di CSS.

**11. Data Stok** — `DataStokTab.jsx` · skor **10** — ✅ **contoh terbaik di aplikasi**: `stock-card-table` lengkap. Sisa cacat kecil: `minWidth:640` pada tabel dasar, 7 `nowrap`.

**12. Master/Admin pendukung** — `PermMatrixPage.jsx` skor 10 (4 font 11 px, header sticky `nowrap`), `AuditLogPage.jsx` skor 6, `TugFinalReviewModal.jsx` skor 8 (2 tabel, nol `isMobile`), `PetaGudangTab.jsx` skor 6.

### 🟢 Prioritas 3 — ringan / sudah baik

- **Forecast Stok** (`ForecastStokPage.jsx`, skor 3) — ✅ 3 tabel, semua punya `forecast-card-table`. Rujukan pola yang benar.
- **Dashboard** (skor 0–4 tersebar di 12 komponen) — sebagian besar sudah lewat CSS `.dashboard-*`; `DashboardManager` punya `.dashboard-manager__table-scroll`.
- **Approval** (`ApprovalHubTab` 0, `ApprovalTab` 4) — sudah ditangani media query `@900px`/`@520px` yang cukup rapi.
- **Alat Berat** (`HeavyEquipmentTabV2`, skor 5) — 2 `minmax` lebar, sisanya bersih.
- **Transaksi TUG-3/TUG-5**, **Rencana Kedatangan**, **AI**, semua modal (`AkunModals`, `MasterOrgModals`, `StockModals`, `PindahBlokModal`, dll) — skor 0–1.
- **Halaman publik scan** (`ScanPublicView`, skor 2) — halaman yang **paling pasti dibuka dari HP**; kondisinya justru relatif bersih.

---

## 4. Blocker yang harus diputuskan sebelum eksekusi

Rekomendasi "pakai Tailwind responsive prefix" yang sudah disetujui **tidak bisa langsung ditempel**, karena:

> Inline `style={{…}}` selalu menang atas class Tailwind. `<div style={{gridTemplateColumns:"repeat(4,1fr)"}} className="md:grid-cols-1">` → Tailwind **kalah**, layout tetap 4 kolom di HP.

Jadi tiap tempat yang mau di-Tailwind-kan **wajib** properti layout-nya dicabut dulu dari inline style. Ini yang membuat pekerjaan ini besar dan bertahap — bukan sekadar tambah prefix.

Ada dua jalan, dan rekomendasiku **B**:

- **A. Cabut semua 3.448 inline style → Tailwind.** Paling bersih, tapi menyentuh hampir setiap file, risiko regresi visual sangat tinggi, dan tidak mungkin diverifikasi tanpa tes visual masif. **Tidak disarankan.**
- **B. ✅ Cabut hanya properti *layout* (≈300–400 lokasi), warna/spacing dibiarkan inline.** Yang dicabut cuma: `gridTemplateColumns`, `flexDirection`, `minWidth`/`maxWidth`/`width`, `whiteSpace`, `fontSize` di titik bermasalah. Diff jauh lebih kecil, cacat yang dikeluhkan (tumpang tindih, melebar, font timpang) semuanya ada di kelompok properti ini. Warna dan padding tidak disentuh → risiko regresi visual rendah.

---

## 5. Rencana penuh

Prinsip: **satu breakpoint, satu pola tabel, satu skala font.** Setiap fase berdiri sendiri, bisa di-review dan di-commit terpisah, dan tidak ada fase yang mengubah desktop.

### Fase 0 — Garis dasar & pagar pengaman *(prasyarat, ½ sesi)*
1. Screenshot semua 14 menu di 360 px, 390 px, 768 px → simpan sebagai pembanding "sebelum".
2. Sepakati skala font tunggal (usul: 12 / 13 / 14 / 16 / 18 / 24 px, floor 12 px sesuai preferensi user, kecuali layout cetak).
3. Sepakati **2 breakpoint saja**: `sm` 640 px (HP) dan `lg` 1024 px (desktop). Pensiunkan 7 breakpoint lama.
4. Tetapkan `isMobile` tetap ada untuk logic (mis. render komponen berbeda), tapi **dilarang** dipakai untuk styling — styling pindah ke CSS/Tailwind.

### Fase 1 — Bakukan pola tabel→kartu *(dampak terbesar, 1–2 sesi)*
Ganti 7 class tabel bespoke dengan **satu** utility generik `.mobile-card-table` yang bekerja hanya bermodal atribut `data-label` di `<td>` — tanpa CSS tulis-tangan per tabel.
- Konversi **29 tabel** yang belum punya fallback, prioritas: Material Cadang (1200 px) → TUG-15 (1050) → Kapasitas Import (1050) → Kapasitas (900) → ATTB ×2 (820/760) → Migrasi (760) → Master Data ke-2 (720) → sisanya.
- Hapus `minWidth` tabel pada breakpoint HP (biarkan berlaku di desktop).
- **Kriteria selesai:** tidak ada satu pun halaman yang butuh scroll horizontal di lebar 360 px.

### Fase 2 — Basmi tumpang-tindih teks *(1 sesi)*
- 98 `whiteSpace:"nowrap"`: cabut dari inline, ganti `sm:whitespace-normal` + wajib `min-width:0` pada induk flex/grid.
- Perbaiki tabrakan aturan `min-width:44px !important` vs baris tombol padat: batasi paksaan 44 px ke **tinggi** saja (`min-height`), lebar diserahkan ke konten + `flex-wrap`.
- **Kriteria selesai:** nol teks bertumpuk di 360 px pada 14 menu.

### Fase 3 — Grid & lebar *(1 sesi)*
- 3 `repeat(N,1fr)` kaku dan 10 `minmax(≥260px)` → `repeat(auto-fit,minmax(min(100%,240px),1fr))` (pola ini otomatis turun ke 1 kolom, tidak perlu breakpoint).
- 15 file dengan `maxWidth` px tetap ≥380 → `min(<px>, 100%)`.
- **Kriteria selesai:** tidak ada elemen yang lebih lebar dari viewport di 360 px.

### Fase 4 — Skala font *(½ sesi)*
- 18 `fontSize` < 12 px non-cetak → naikkan ke floor 12 px.
- Isolasi `KartuGantungModal` + `BarcodePrintModal` ke `@media print` supaya font cetak kecilnya aman.
- **Kriteria selesai:** hanya blok cetak yang boleh < 12 px.

### Fase 5 — Bersih-bersih breakpoint *(½ sesi)*
- Gabungkan 24 media query 7-breakpoint jadi 2 breakpoint.
- Hapus styling berbasis `isMobile` yang sudah tergantikan CSS.

### Fase 6 — Verifikasi *(½ sesi)*
- Screenshot ulang 14 menu × 3 lebar, bandingkan dengan garis dasar Fase 0.
- `npm run build` hijau, lalu review-first sebelum push.

**Estimasi total: 5–7 sesi kerja.** Fase 1 + 2 saja sudah menyelesaikan mayoritas keluhan ("tumpang tindih", "melebar tidak jelas").

---

## 6. Soal Figma

**Rekomendasi: tidak perlu untuk pekerjaan ini.** Alasannya bukan biaya, tapi kecocokan: masalah WARNOTO adalah **inkonsistensi implementasi**, bukan ketiadaan desain. Figma memecahkan "belum tahu mau tampil seperti apa"; di sini sudah tahu — `DataStokTab` dan `ForecastStokPage` sudah membuktikan pola yang benar. Menggambar ulang 14 menu di Figma menambah 2–3 sesi tanpa menyentuh satu pun dari 98 `nowrap` itu.

Figma baru layak kalau nanti desainnya mau **diubah**, bukan sekadar dirapikan responsifnya — misalnya merombak navigasi mobile jadi bottom-tab-bar, atau merancang ulang kartu Inspeksi Material untuk penggunaan satu tangan di lapangan. Kalau itu yang diinginkan, tahap desainnya disusun terpisah.

---

## 7. Keputusan yang ditunggu

1. Setuju **Jalan B** (cabut properti layout saja, ±300–400 lokasi)?
2. Setuju 2 breakpoint (640 / 1024)?
3. Mulai dari Fase 1 (tabel) — atau ada menu yang paling menyiksa dan mau didahulukan?
