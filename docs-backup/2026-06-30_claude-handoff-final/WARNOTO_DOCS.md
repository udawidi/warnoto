# WARNOTO — PLN TUG Digital
## Dokumen Spesifikasi Teknis & Status Pengembangan

*Last updated: June 28, 2026 (malam — sesi dilanjutkan)*
*Active file: App.jsx (single-file, ~5000+ lines setelah sesi ini)*
*Working pattern: plan → confirm → execute → present*

---

### 1. Status Proyek

**Fase 1 — Single Instance UPT Surabaya: SELESAI ✅**

Semua fitur TUG Fase 1 sudah diimplementasikan di v19. Fase 2 (multi-UPT backend nyata) menunggu infrastruktur server.

---

### 2. Fitur yang Sudah Selesai (v19)

#### Role & Akun
| Role | Username | Hak Akses |
| :--- | :--- | :--- |
| ADMIN | admin.ketintang | Full access semua fitur |
| TL | tl.ketintang | Buat TUG, approve tahap TL |
| ASMAN | asman.ketintang | Approve TUG-3 Final, TUG-5 |
| MANAGER | manager.ketintang | Approve TUG-4, TUG-5 |
| ADMIN_UIT | admin.uit | Lengkapi TUG-7, pilih UPT Pengirim |
| MGR_LOGISTIK_UIT | mgrlog.uit | Approve TUG-7 |
| PENGADAAN | pengadaan.ketintang | Hanya Dashboard + Rencana Kedatangan |
| VIEWER | viewer | Read-only |

#### Master Data
- Katalog Barang (CRUD + auto-detect SAP/Non-SAP dari format nomor)
- Lokasi Gudang
- Satpam
- Tim Mutu (2 paket tetap: ≥300jt / <300jt)
- Master UIT (Unit Induk Transmisi)
- Master UPT (6 UPT dalam UIT-JBM)

#### TUG Dokumen (semua dengan builder HTML cetak)
| Dok | Nama | Alur |
| :--- | :--- | :--- |
| TUG-2 | Kartu Gantung Digital | Menempel di setiap card Data Stok |
| TUG-3/4 | Penerimaan Barang | TL approve → isi TUG-4 → Manager approve → lampiran → Asman approve → stok masuk |
| TUG-5 | Permintaan Barang | Asman → Manager → INTRACOMPANY: draft TUG-7 / INTERCOMPANY: draft TUG-5 UIT |
| TUG-7 | Perintah Penyerahan (UIT) | Admin UIT pilih UPT pengirim → Mgr Logistik UIT approve → draft TUG-8 |
| TUG-8 | Pemakaian Unit Lain | Approval berjenjang, bisa dari draft TUG-7 |
| TUG-9 | Pemakaian Sendiri | Approval berjenjang |
| TUG-10 | Pengembalian ke Gudang | 3 status material, stok masuk saat approve |
| TUG-15 | Laporan Mutasi Stok | Filter lengkap, download HTML + Excel (.xlsx) |

#### Klasifikasi SAP/Non-SAP
- Auto-detect dari nomor katalog: 10 digit = SAP Cadang, 7 digit = SAP Persediaan/Pre Memory, lainnya = Non-SAP
- Badge ditampilkan di Data Stok, Kartu Gantung, TUG-15

#### Dashboard
- 4 KPI card utama: Total Item, Nilai Inventory, Stok Kritis, Pending Approval
- 2 KPI card Saldo: Total Nilai Material Cadang + Total Nilai Material Persediaan (qty×harga)
- Widget Level Stok dengan progress bar
- Widget Butuh Tindakan (semua role, semua TUG type)
- Widget Rencana Kedatangan Barang (30 hari ke depan)
- Widget Transaksi Terbaru

#### Rencana Kedatangan Barang
- Upload PDF kontrak → AI (Claude API) ekstrak otomatis
- User review + edit sebelum simpan
- Multi-item per kontrak
- Tampil di Dashboard dengan alert Terlambat

#### Navigasi Sidebar
- TUG accordion: 📥 Penerimaan / 📤 Pengeluaran / 📋 Permintaan / 📊 Laporan
- Kartu Gantung menempel di Data Stok (bukan menu terpisah)
- Menu 📅 Rencana Kedatangan

#### Cloud Storage Keys
pln_stocks_v4, pln_katalog_v4, pln_lokasi_v4, pln_txns_v3, pln_docseq_v3, pln_satpam_v3, pln_timmutu_v1, pln_uit_v1, pln_upt_v1, pln_rencana_v1

---

### 3. Arsitektur Teknis

| Komponen | Detail |
| :--- | :--- |
| Framework | React single-file (.jsx), ~4,600 lines |
| Storage | window.storage (cloud, per-user) |
| AI Extract | Anthropic API claude-sonnet-4-6 (PDF kontrak → JSON) |
| Excel Export | SheetJS (XLSX) |
| Print/PDF | HTML builder → browser Print → Save as PDF |
| Deployment | Claude.ai Artifact |

---

### 4. Fase 2 — Multi-UPT (Deferred — butuh backend nyata)

Yang tidak bisa dilakukan dalam Fase 1 (artifact tanpa server publik):
- Login terpisah per UPT di device berbeda dengan data terisolasi
- Notifikasi real-time lintas device/akun
- Auto-create TUG-8 di sistem UPT lain yang terpisah
- Partisi Data Stok per UPT dengan sinkronisasi
- SAP API integration (Fase 3)

---

### 5. Quality Gates

Setiap versi wajib lolos balance check sebelum dipresentasikan:
```bash
node -e "const fs=require('fs');const code=fs.readFileSync('pln-warehouse-vXX.jsx','utf8');let b=0,p=0,k=0;for(const ch of code){if(ch==='{')b++;if(ch==='}')b--;if(ch==='(')p++;if(ch===')')p--;if(ch==='[')k++;if(ch===']')k--;}console.log(b,p,k);"
```
Target: `0 0 0`


---

### 6. Planning — Fitur Peta Lokasi Gudang
*Status: PLANNING ONLY — konsep final, belum dieksekusi*

#### 6.1 Konsep Umum

Setiap lokasi di Master Lokasi memiliki koordinat posisi (X%, Y%) di atas gambar denah gudang. Saat barang ditempatkan di suatu lokasi, titik merah otomatis muncul di posisi koordinat lokasi tersebut di peta. Koordinat diset di Master Lokasi (bukan per item barang) — semua barang di lokasi yang sama berbagi satu titik.

#### 6.2 Alur Setup (Admin, sekali per gudang)

```
1. Admin upload PDF denah gudang di halaman Master Lokasi
   → AI (Claude API) membaca teks di PDF
   → Ekstrak nama-nama lokasi/area yang terbaca (Rak A1, B2, dst)
   → Tampilkan hasil sebagai daftar untuk dikonfirmasi/diedit Admin

2. PDF dirender sebagai gambar background peta gudang
   (browser render PDF page → canvas/img)

3. Admin klik satu per satu di gambar denah
   → Klik di titik lokasi → pilih nama lokasi dari dropdown
   → Koordinat (xPct%, yPct%) disimpan ke Master Lokasi

4. Setiap Lokasi di Master Lokasi sekarang punya field tambahan:
   - mapX: number (0-100, persentase dari kiri)
   - mapY: number (0-100, persentase dari atas)
   - denahId: string (referensi ke denah gudang yang mana)
```

#### 6.3 Struktur Data Baru

**Master Lokasi (update field):**
```js
{
  id, kode, nama, kapasitas, keterangan,
  mapX: 45.2,      // koordinat X dalam % dari kiri gambar
  mapY: 30.8,      // koordinat Y dalam % dari atas gambar
  denahId: "DEN-001"  // referensi ke file denah
}
```

**Master Denah (baru):**
```js
{
  id: "DEN-001",
  namaGudang: "Gudang Ketintang",
  imageData: "base64...",  // PDF dirender ke PNG, simpan sebagai base64
  uploadedAt: timestamp,
  uploadedBy: userId
}
```

Cloud storage key baru: `pln_denah_v1`

#### 6.4 Akses Fitur dalam Aplikasi

**A. Halaman Peta Gudang (tersendiri):**
- Menu sidebar baru: `🗺️ Peta Gudang`
- Tampilkan gambar denah sebagai background
- Overlay titik merah di setiap lokasi yang sudah punya koordinat
- Klik titik → popup: nama lokasi + daftar barang yang ada di sini (nama, qty, satuan)
- Toggle: tampilkan semua lokasi / hanya lokasi yang ada barangnya
- Filter: per jenis barang (Cadang/Persediaan/dll)

**B. Dari Data Stok:**
- Setiap card Data Stok sudah punya badge lokasi
- Tambah tombol kecil "📍" di card → klik → modal peta muncul dengan titik merah di lokasi barang tersebut, lokasi lain di-dim/greyed out

#### 6.5 Mode Konfigurasi (Admin saja)

Di halaman Master Lokasi, Admin bisa masuk ke "Mode Konfigurasi Peta":
- Upload PDF denah → AI ekstrak nama lokasi → konfirmasi
- Klik di peta untuk assign koordinat ke setiap lokasi
- Preview: lihat hasil titik di peta sebelum simpan
- Bisa edit/reset koordinat per lokasi

#### 6.6 Implementasi Teknis

**PDF → Image:**
Browser tidak bisa render PDF langsung sebagai `<img>`. Pendekatan yang bisa dilakukan dalam artifact:
- Gunakan `pdf.js` (library tersedia via CDN: `cdnjs.cloudflare.com/ajax/libs/pdf.js/`)
- Render PDF page pertama ke `<canvas>`, convert ke base64 PNG
- Simpan base64 PNG sebagai background denah (bukan PDF aslinya)

**Koordinat sistem:**
- Simpan sebagai persentase (0-100%) bukan pixel, agar responsive di berbagai ukuran layar
- `mapX = (clickX / imageWidth) * 100`
- `mapY = (clickY / imageHeight) * 100`
- Render: `left: mapX + "%"`, `top: mapY + "%"` di atas `position:relative` container

**AI Extract nama lokasi:**
- Kirim PDF base64 ke Claude API (sama seperti Rencana Kedatangan)
- Prompt: ekstrak semua label/nama lokasi yang terbaca (rak, zona, area, nomor)
- Return JSON: `{ lokasi: ["Rak A1", "Rak A2", "Zona B", ...] }`
- User konfirmasi → match ke Master Lokasi yang sudah ada atau buat baru

#### 6.7 Urutan Eksekusi

1. Tambah field `mapX`, `mapY`, `denahId` ke struktur Master Lokasi
2. Buat state + cloud storage `pln_denah_v1` untuk simpan gambar denah (base64 PNG)
3. Buat komponen `PetaGudangTab` — full view peta dengan semua titik
4. Buat mode konfigurasi di Master Lokasi:
   a. Upload PDF → pdf.js render → simpan sebagai PNG base64
   b. AI ekstrak nama lokasi dari PDF
   c. Mode klik koordinat di atas gambar
5. Tambah tombol "📍" di card Data Stok → modal peta mini
6. Tambah menu `🗺️ Peta Gudang` di sidebar

#### 6.8 Catatan Penting

- Base64 PNG dari PDF bisa berukuran besar (2-5MB). Cloud storage `window.storage` punya limit 5MB per key — perlu kompresi atau resize sebelum simpan
- Jika PDF multi-halaman, hanya halaman pertama yang dirender (asumsi: denah di halaman 1)
- Setiap lokasi di Master Lokasi yang belum di-assign koordinat tetap bisa dipakai, hanya tidak muncul di peta
- PDF asli tidak disimpan, hanya PNG hasil render yang disimpan


---

### 7. Planning — Peta Lokasi Gudang (Revisi Final)
*Status: PLANNING ONLY — konsep final, belum dieksekusi*

#### 7.1 Hierarki Data (3 Level)

```
GUDANG (level atas — baru)
  ├── Blok A  ←─ Master Lokasi yang sudah ada (tambah gudangId + koordinat)
  ├── Blok B
  ├── Rak C1
  └── Zona Bongkaran
      └── Barang X, Barang Y, ... (Data Stok, referensi lokasiId ke Blok)
```

**Implikasi:** Master Lokasi yang sudah ada TIDAK diubah strukturnya secara breaking — cukup tambah 3 field baru:
- `gudangId` — referensi ke Gudang parent (nullable, blok lama tetap valid)
- `mapX` — koordinat X dalam % (0-100), default null
- `mapY` — koordinat Y dalam % (0-100), default null

#### 7.2 Master Data Baru: Gudang

```js
{
  id: "GDG-001",
  nama: "Gudang Ketintang",
  kode: "GTK",
  alamat: "Jl. Ketintang Baru No. 9 Surabaya",
  denahImageData: "base64PNG...",  // hasil render PDF page 1 via pdf.js
  denahUploadedAt: timestamp,
  createdAt: timestamp
}
```

Cloud storage key baru: `pln_gudang_v1`

#### 7.3 Alur Setup Denah (Admin, sekali per Gudang)

```
1. Admin buat entri Gudang baru di Master Data → Gudang
2. Admin upload PDF denah di halaman Gudang tersebut
   → pdf.js (CDN: cdnjs.cloudflare.com/ajax/libs/pdf.js/) render page 1 ke <canvas>
   → canvas.toDataURL("image/jpeg", 0.7) → base64 JPEG (kompresi 70% agar < 5MB)
   → Simpan sebagai denahImageData di Gudang

3. OPSIONAL: AI (Claude API) ekstrak nama blok dari teks PDF
   → Return JSON: { blok: ["Blok A", "Blok B", "Rak C1", ...] }
   → Admin konfirmasi → match/create di Master Lokasi dengan gudangId

4. Admin masuk "Mode Konfigurasi Koordinat":
   → Tampilkan gambar denah + semua Blok yang belum punya koordinat
   → Klik di gambar → dropdown pilih Blok → simpan mapX%, mapY%
   → Repeat per blok sampai semua ter-assign
   → Tombol "Selesai Konfigurasi"
```

#### 7.4 Halaman Peta Gudang (Menu Sidebar 🗺️)

**Layout halaman:**
```
┌─────────────────────────────────────────────┐
│ [Dropdown: Pilih Gudang ▼]  [Mode Konfigurasi] │
├─────────────────────────────────────────────┤
│                                             │
│  [Gambar Denah Gudang sebagai background]   │
│                                             │
│    🔴 Blok A      🔴 Rak C1                │
│         🔴 Blok B        🔴 Zona Bongkaran  │
│                                             │
│  (klik titik merah → popup list material)  │
└─────────────────────────────────────────────┘
```

**Fitur:**
- Dropdown pilih Gudang di atas peta
- Titik merah (●) di setiap Blok yang punya koordinat DAN ada barangnya
- Titik abu (○) di Blok yang punya koordinat tapi kosong (tidak ada barang)
- Blok tanpa koordinat tidak muncul di peta
- Klik titik → popup card: nama Blok + daftar material (nama, qty, satuan, jenis barang)
- Filter toggle: "Hanya blok berisi barang" / "Semua blok"

#### 7.5 Integrasi di Data Stok

Setiap card Data Stok:
- Tampilkan nama Blok + nama Gudang (sudah ada lewat lokasiId → Blok → Gudang)
- Tombol `📍` kecil di card → modal peta mini:
  - Background denah gudang (dari gudangId Blok barang tersebut)
  - Titik merah hanya di Blok barang ini, blok lain di-dim (opacity rendah)
  - Label nama blok di atas titik

#### 7.6 Urutan Eksekusi

1. Tambah Master Gudang (CRUD) di Master Data tab baru
2. Update Master Lokasi: tambah field `gudangId`, `mapX`, `mapY` (migration backward-compatible)
3. Update cloud storage: tambah key `pln_gudang_v1`, update `pln_lokasi_v4` → `pln_lokasi_v5`
4. Implementasi pdf.js render → base64 JPEG (dengan kompresi)
5. Mode Konfigurasi Koordinat (klik di gambar → assign blok)
6. Komponen `PetaGudangTab` — full view dengan titik interaktif
7. Modal peta mini di card Data Stok (tombol 📍)
8. Opsional: AI ekstrak nama blok dari PDF (bisa skip jika blok sudah ada di Master Lokasi)

#### 7.7 Batasan Teknis Penting

- **Ukuran storage:** Base64 JPEG kompresi 70% dari PDF A4 ≈ 500KB-2MB. Aman di bawah limit 5MB per key.
- **pdf.js via CDN:** Perlu internet. Render dilakukan sekali saat upload, hasilnya (JPEG) yang disimpan — bukan PDF.
- **Koordinat sistem:** Persentase (0-100%) bukan pixel, agar responsive di layar berbeda.
- **Satu gudang = satu denah (halaman 1 PDF).** Multi-halaman tidak didukung.
- **Blok tanpa gudangId** tetap bisa digunakan normal di TUG — fitur peta hanya fitur tambahan, tidak blocking.


---

### 8. Planning — Dashboard Analytics Widgets (3 Widget Baru)
*Status: PLANNING ONLY — konsep final, belum dieksekusi*

#### 8.1 Posisi di Dashboard

3 widget baru ditempatkan di **section terpisah di bawah dashboard yang sudah ada** — user scroll ke bawah untuk melihatnya. Judul section: "📊 Analitik Material". Layout: **3 kolom side by side** dalam satu row.

```
┌─────────────────────────────────────────────────────────────┐
│  [KPI Cards yang sudah ada]                                 │
│  [Saldo Cadang & Persediaan]                                │
│  [Widget Rencana Kedatangan + Butuh Tindakan + Transaksi]  │
├─────────────────────────────────────────────────────────────┤
│  📊 ANALITIK MATERIAL                                       │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐    │
│  │ 🔥 Paling     │ │ 📦 Stok       │ │ ⚠️ Akan       │   │
│  │    Sering     │ │    Terbanyak  │ │    Habis      │   │
│  │    Dipakai    │ │    di Gudang  │ │               │   │
│  └───────────────┘ └───────────────┘ └───────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

Semua 3 widget punya **dropdown jumlah** (5 / 10 / 20 item) yang ter-share dalam satu state `topN`.

#### 8.2 Widget 1 — 🔥 Material Paling Sering Dipakai

**Sumber data:** Transaksi TUG-9 dan TUG-8 yang berstatus APPROVED.

**Toggle mode (2 pilihan):**
- **Frekuensi** (default): hitung berapa kali material muncul di transaksi (jumlah bon)
- **Qty Keluar**: hitung total qty yang keluar dari semua transaksi

**Kalkulasi:**
```js
// Frekuensi: group by katalogId, hitung jumlah transaksi
txns.filter(t=>["TUG9","TUG8"].includes(t.docType) && t.status==="APPROVED")
    .flatMap(t=>t.stockItems)
    .groupBy(si => stocks.find(s=>s.id===si.stockId)?.katalogId)
    .sortDesc(group => group.length) // atau .sum(si=>si.qty) untuk mode qty

// Output per item: { namaBarang, noKatalog, value, satuan }
```

**Tampilan per baris:**
- Ranking (1, 2, 3...)
- Nama barang + no katalog
- Badge SAP status
- Nilai (jumlah bon atau total qty keluar) dengan bar progress relatif terhadap nilai tertinggi

#### 8.3 Widget 2 — 📦 Material Stok Terbanyak di Gudang

**Sumber data:** `enrichedStocks` — aggregasi qty per Master Katalog (karena satu katalog bisa ada di beberapa lokasi/blok).

**Kalkulasi:**
```js
// Aggregate qty per katalogId
katalogList.map(k => ({
  katalog: k,
  totalQty: stocks.filter(s=>s.katalogId===k.id).reduce((a,s)=>a+s.qty, 0),
  totalNilai: stocks.filter(s=>s.katalogId===k.id).reduce((a,s)=>a+(s.qty*s.price), 0)
}))
.filter(x=>x.totalQty>0)
.sortDesc(x=>x.totalQty)
.slice(0, topN)
```

**Tampilan per baris:**
- Ranking
- Nama barang + no katalog
- Badge SAP + Badge Jenis Barang
- Total qty + satuan
- Nilai rupiah (qty × harga)
- Bar progress relatif terhadap qty tertinggi

#### 8.4 Widget 3 — ⚠️ Material yang Akan Habis

**Dua kondisi untuk masuk daftar ini (ATAU salah satunya):**

**A. Stok di bawah minimum (kritis saat ini):**
- `totalQty <= minQty` yang sudah diset di Data Stok
- Label: 🔴 "Stok Kritis"

**B. Prediksi habis berdasarkan pemakaian:**
- Hitung rata-rata pemakaian per bulan dari **semua history TUG-9/TUG-8 APPROVED** (semua waktu)
- Estimasi sisa hari: `totalQty / (avgPerBulan / 30)`
- Tampilkan jika estimasi sisa < threshold

**Kalkulasi rata-rata pemakaian:**
```js
// Per katalogId: total qty keluar / jumlah bulan sejak transaksi pertama
function avgPakaiPerBulan(katalogId, txns, stocks) {
  const keluarItems = txns
    .filter(t=>["TUG9","TUG8"].includes(t.docType) && t.status==="APPROVED")
    .flatMap(t=>t.stockItems.map(si=>({...si, approvedAt:t.approvedAt||t.createdAt})))
    .filter(si=>stocks.find(s=>s.id===si.stockId)?.katalogId===katalogId);

  if (keluarItems.length===0) return 0;
  const totalQtyKeluar = keluarItems.reduce((a,si)=>a+si.qty, 0);
  const oldest = Math.min(...keluarItems.map(si=>si.approvedAt));
  const bulanBerjalan = Math.max(1, (Date.now()-oldest) / (30*24*60*60*1000));
  return totalQtyKeluar / bulanBerjalan;
}
```

**Tampilan per baris:**
- Nama barang + no katalog
- Stok saat ini vs min qty
- Rata-rata pakai/bulan
- Estimasi sisa: "~X hari" atau "~X bulan"
- Badge status: 🔴 Kritis (di bawah min) / 🟡 Perhatian (< 30 hari) / 🟠 Waspada (30-60 hari)

**Sorting:** Urutkan dari yang paling kritis (sisa hari paling sedikit), item tanpa history pemakaian tapi stok = 0 ditaruh paling atas.

#### 8.5 State yang Dibutuhkan

```js
const [topN, setTopN] = useState(10); // shared: 5 | 10 | 20
const [pemakaianMode, setPemakaianMode] = useState("frekuensi"); // "frekuensi" | "qty"
```

Tidak butuh state baru di cloud — semua dihitung secara derived dari `txns`, `stocks`, `katalogList` yang sudah ada.

#### 8.6 Urutan Eksekusi

1. Tambah state `topN` dan `pemakaianMode` di komponen utama
2. Buat helper functions: `getTopPemakaian()`, `getTopStokTerbanyak()`, `getMaterialAkanHabis()`
3. Buat komponen `DashboardAnalitikSection` yang menerima semua data dan render 3 widget
4. Sisipkan `<DashboardAnalitikSection>` di bagian bawah tab Dashboard


---

### 9. Planning — Dashboard Eksekutif (Manager/GM & Asman)
*Status: PLANNING ONLY — konsep final, belum dieksekusi*

#### 9.1 Konsep Diferensiasi Dashboard per Role

| Aspek | Dashboard Asman | Dashboard Manager (GM) |
| :--- | :--- | :--- |
| **Trigger** | Halaman Dashboard biasa saat Asman login | Otomatis saat Manager login (menggantikan Dashboard biasa) |
| **Scope data** | UPT Surabaya saja | Agregat semua UPT (Fase 1: Surabaya + placeholder) |
| **Fokus** | Operasional — material kritis, pending approval, pemakaian | Eksekutif — nilai aset, coverage, compliance, ringkasan per UPT |
| **Konten** | Sama dengan Dashboard Manager tapi scope UPT Surabaya | Sama dengan Asman tapi data multi-UPT |
| **Akses lain** | Bisa approve TUG, akses semua halaman | Read-only semua halaman |

#### 9.2 Navigasi

- **Manager** → login → otomatis landing di Dashboard Eksekutif (bukan Dashboard biasa)
- **Asman** → login → Dashboard biasa yang sudah ada, TAPI konten disesuaikan (lebih operasional)
- **Role lain** → Dashboard biasa seperti sekarang, tidak berubah

Implementasi: cek `currentUser.role` di render Dashboard, branch ke komponen berbeda:
```jsx
{tab==="dashboard" && currentUser.role==="MANAGER" && <DashboardManager .../>}
{tab==="dashboard" && currentUser.role==="ASMAN" && <DashboardAsman .../>}
{tab==="dashboard" && !["MANAGER","ASMAN"].includes(currentUser.role) && <DashboardDefault .../>}
```

#### 9.3 Konten Dashboard Manager (GM UIT) — Multi-UPT View

**Section A: Header Eksekutif**
- Tanggal & waktu real-time
- Label: "PT PLN (Persero) UIT-JBM — Dashboard Eksekutif Material"

**Section B: KPI Cards (agregat semua UPT)**
| KPI | Kalkulasi |
| :--- | :--- |
| Total Nilai Inventori | SUM(qty × harga) semua stok semua UPT |
| Saldo Material Cadang | SUM untuk jenisBarang = "Cadang" |
| Saldo Material Persediaan | SUM untuk jenisBarang = "Persediaan" |
| Material Stok Kritis | COUNT item dengan qty ≤ minQty |
| TUG Pending Approval | COUNT transaksi status PENDING |
| Rencana Kedatangan Terlambat | COUNT item lewat tanggal serah terima |

**Section C: Tabel Ringkasan per UPT**
Satu baris per UPT (6 UPT dalam UIT-JBM):

| UPT | Total Item | Nilai Stok | Stok Kritis | Aktivitas Bulan Ini | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| UPT Surabaya | 45 | Rp 2,1M | 3 | 12 TUG | 🟢 |
| UPT Malang | — | — | — | — | ⚪ Belum terhubung |
| UPT Madiun | — | — | — | — | ⚪ Belum terhubung |
| ... | | | | | |

**Section D: 3 Widget Analitik** (sama dengan Section 8 — Top Pemakaian, Stok Terbanyak, Akan Habis)

**Section E: Compliance & Kontrol**
- List TUG pending yang sudah > 2 hari belum diapprove (nama dokumen, sudah berapa hari)
- List rencana kedatangan yang terlambat (supplier, nama barang, berapa hari terlambat)

#### 9.4 Konten Dashboard Asman — Operasional UPT Surabaya

Sama persis dengan Dashboard Manager TAPI:
- Data hanya UPT Surabaya (tidak ada tabel per-UPT)
- Tidak ada Section C (tabel ringkasan per UPT)
- Section B scope UPT Surabaya saja
- Tambahan: Widget "Butuh Approval Saya" lebih prominent (karena Asman yang approve)

Pada dasarnya Dashboard Asman = Dashboard Manager tapi single-UPT view.

#### 9.5 Fase 1 — Placeholder Multi-UPT

Untuk Fase 1 (single instance UPT Surabaya), tabel per-UPT di Dashboard Manager menampilkan:
- UPT Surabaya → data real dari sistem
- UPT Malang, Madiun, Probolinggo, Bali, Gresik → baris dengan badge ⚪ "Belum terhubung"

Saat Fase 2 (backend multi-UPT) live, placeholder otomatis terisi tanpa perubahan UI.

#### 9.6 State Tambahan yang Dibutuhkan

Tidak ada state cloud baru. Semua data sudah tersedia:
- `stocks`, `txns`, `katalogList` → untuk KPI dan analitik
- `rencanaKedatanganList` → untuk compliance terlambat
- `uptList` → untuk tabel per-UPT (Fase 1: hanya UPT-SBY yang punya data)

State UI baru:
```js
const [topN, setTopN] = useState(10);          // shared untuk 3 widget analitik
const [pemakaianMode, setPemakaianMode] = useState("frekuensi"); // widget pemakaian
```

#### 9.7 Urutan Eksekusi

1. Buat komponen `DashboardManager` — layout eksekutif multi-UPT
2. Buat komponen `DashboardAsman` — layout operasional single-UPT
3. Update routing Dashboard utama: branch per role
4. Buat 3 helper functions untuk widget analitik (Section 8):
   - `getTopPemakaian(txns, stocks, katalogList, mode, n)`
   - `getTopStokTerbanyak(stocks, katalogList, n)`
   - `getMaterialAkanHabis(stocks, katalogList, txns, n)`
5. Buat komponen `DashboardAnalitikSection` (reusable untuk Manager & Asman)
6. Buat komponen `UPTSummaryTable` untuk tabel per-UPT di Dashboard Manager


---

### 10. Planning — Stock Opname
*Status: PLANNING ONLY — konsep final, menunggu contoh file Excel SAP sebelum eksekusi*

#### 10.1 Konsep Umum

Stock Opname dilakukan **1x per semester** — membandingkan qty di sistem WARNOTO dengan kondisi fisik di lapangan. Ada **2 alur berbeda** berdasarkan jenis material:

```
MATERIAL SAP (7-digit / 10-digit katalog):
  Admin upload Excel dari SAP → sistem parse & bandingkan → Admin review per item
  → Submit → Asman approve → Manager approve → Data Stok disesuaikan

MATERIAL NON-SAP (ATTB, Non-Stock, Bongkaran, Pre Memory belum SAP):
  Admin input qty fisik satu per satu langsung di form sistem
  → Sistem tampilkan perbandingan sistem vs fisik → Submit
  → Asman approve → Manager approve → Data Stok disesuaikan
```

#### 10.2 Scope per Sesi Opname

Bisa dilakukan **per kategori**, tidak harus sekaligus:
- Sesi 1: Opname Cadang (SAP)
- Sesi 2: Opname Persediaan (SAP)
- Sesi 3: Opname Non-SAP (ATTB, Bongkaran, dll)

Setiap sesi menghasilkan satu Berita Acara terpisah. Semua sesi dalam satu semester bisa digabung dalam satu laporan rekap akhir.

#### 10.3 Struktur Data Sesi Opname

```js
{
  id: "OPNAME-2026-S1-001",
  semester: "2026-S1",          // 2026-S1 atau 2026-S2
  kategori: "Cadang",           // kategori yang di-opname
  jenisAlur: "SAP",             // "SAP" | "NON_SAP"
  status: "DRAFT",              // DRAFT | PENDING_ASMAN | PENDING_MANAGER | SELESAI | DITOLAK
  items: [
    {
      katalogId: "...",
      namaBarang: "...",
      noKatalog: "...",
      satuan: "...",
      qtySistem: 10,            // dari Data Stok saat opname dimulai
      qtySAP: 10,               // dari upload Excel SAP (hanya alur SAP)
      qtiFisik: 9,              // input manual Admin
      selisih: -1,              // qtiFisik - qtySistem
      keterangan: "...",        // catatan Admin jika ada selisih
      statusItem: "SELISIH"     // "SESUAI" | "SELISIH" | "TIDAK_ADA_DI_SAP" | "TIDAK_ADA_DI_SISTEM"
    }
  ],
  dibuatOleh: userId,
  dibuatAt: timestamp,
  approvedByAsman: null,
  approvedAtAsman: null,
  approvedByManager: null,
  approvedAtManager: null,
  selesaiAt: null,
  catatanAsman: "",
  catatanManager: "",
}
```

Cloud storage key baru: `pln_opname_v1`

#### 10.4 Alur Detail — Material SAP

```
1. Admin klik "Mulai Opname SAP" → pilih kategori (Cadang/Persediaan/Pre Memory SAP)
   → Sistem generate daftar semua material SAP di kategori itu (dari Data Stok)
   → Status sesi: DRAFT

2. Admin upload file Excel dari SAP
   → Sistem parse Excel via SheetJS
   → Kolom yang dipetakan: [menunggu contoh file — akan diisi setelah file diterima]
   → Sistem auto-fill kolom "Qty SAP" dari Excel untuk setiap item yang cocok (match by No Katalog)
   → Item di Excel tapi tidak ada di sistem → ditandai "TIDAK_ADA_DI_SISTEM"
   → Item di sistem tapi tidak ada di Excel SAP → ditandai "TIDAK_ADA_DI_SAP"

3. Admin input qty fisik satu per satu di form
   → Sistem hitung selisih: qtsFisik - qtsSistem
   → Item dengan selisih ≠ 0 diberi highlight merah + wajib isi keterangan

4. Admin klik "Submit Opname" → status: PENDING_ASMAN
5. Asman review, bisa tambah catatan → approve → status: PENDING_MANAGER
6. Manager review → approve → status: SELESAI
   → Data Stok otomatis disesuaikan (qty diupdate ke qtsFisik untuk semua item)
   → Generate Berita Acara siap download
```

#### 10.5 Alur Detail — Material Non-SAP

```
1. Admin klik "Mulai Opname Non-SAP" → pilih kategori (ATTB/Non-Stock/Bongkaran/Pre Memory Non-SAP)
   → Sistem generate daftar material Non-SAP di kategori itu

2. Tidak ada upload Excel — Admin langsung input qty fisik satu per satu
   → Sistem tampilkan: Nama Barang | Qty Sistem | [Input Qty Fisik] | Selisih (auto-hitung)
   → Item dengan selisih wajib isi keterangan

3. Submit → approval chain sama: Asman → Manager → Data Stok disesuaikan
```

#### 10.6 Format Kolom Excel SAP

⚠️ **MENUNGGU CONTOH FILE** — bagian ini akan dilengkapi setelah file Excel SAP diterima.

Asumsi sementara berdasarkan standar SAP MM:
| Kolom SAP | Mapping ke sistem |
| :--- | :--- |
| Material | No Katalog (match key) |
| Material Description | Nama Barang |
| Unrestricted | Qty SAP |
| Unit | Satuan |
| Val. at price | Nilai/Harga |

*Kolom aktual akan dikonfirmasi setelah file contoh diterima.*

#### 10.7 Tampilan Form Opname

Tabel perbandingan per item dengan kolom:

| No | Nama Barang | No Katalog | Qty Sistem | Qty SAP | Qty Fisik | Selisih | Status | Keterangan |
| :- | :- | :- | :-: | :-: | :-: | :-: | :- | :- |
| 1 | Isolator 150KV | 3070213 | 10 | 10 | 9 | **-1** | 🔴 SELISIH | Rusak 1 pcs |
| 2 | Bushing CT | 1002010529 | 5 | 5 | 5 | 0 | ✅ SESUAI | |

- Baris SESUAI → latar hijau muda
- Baris SELISIH → latar merah muda + kolom keterangan wajib diisi
- Baris TIDAK_ADA_DI_SISTEM → latar kuning
- Baris TIDAK_ADA_DI_SAP → latar abu

**Filter di form:** Semua | Hanya Selisih | Hanya Sesuai

#### 10.8 Berita Acara Stock Opname (Output Dokumen)

Header: PT PLN (Persero) UPT Surabaya — Berita Acara Stock Opname
Isi:
- Periode semester, tanggal pelaksanaan, kategori material
- Tabel rekap: total item, jumlah sesuai, jumlah selisih, nilai selisih (rupiah)
- Tabel detail item dengan selisih (kolom lengkap)
- Tanda tangan: Admin Gudang + TL Logistik + Asman Konstruksi + Manager UPT
- Download sebagai HTML → Print → PDF

#### 10.9 Akses Menu

Menu baru di sidebar: `📋 Stock Opname`
- Bisa diakses oleh: ADMIN, TL, ASMAN, MANAGER
- ADMIN/TL: bisa buat sesi baru, input qty fisik, submit
- ASMAN: approve tahap 1
- MANAGER: approve tahap 2 (final)
- VIEWER: read-only, bisa lihat history opname sebelumnya

#### 10.10 Urutan Eksekusi (setelah file Excel SAP diterima)

1. Konfirmasi mapping kolom Excel SAP → update Section 10.6
2. Tambah state + cloud storage `pln_opname_v1`
3. Buat halaman Stock Opname: list sesi + tombol buat sesi baru
4. Buat form opname (tabel perbandingan + input qty fisik)
5. Implementasi parse Excel SAP via SheetJS (sudah tersedia)
6. Approval chain: Asman → Manager → auto-update Data Stok
7. Berita Acara HTML builder
8. Tambah menu sidebar `📋 Stock Opname`


#### 10.6b Format Kolom Excel SAP — CONFIRMED (dari file PEMAT_04062026.csv)

File SAP adalah format **CSV** (bukan .xlsx) dengan 20 kolom:

| Kolom SAP | Keterangan | Mapping ke WARNOTO |
| :--- | :--- | :--- |
| `Material` | Nomor material SAP — 15 digit dengan leading zeros (cth: `000000001060011`) | Strip leading zeros → cocokkan ke `katalog` di Master Katalog |
| `Material Description` | Nama material | Tampilkan sebagai referensi |
| `Base Unit of Measure` | Satuan (BH, SET, U, dll) | Referensi |
| `Unrestricted Use Stock` | **Qty stok SAP** — format: `1.000` (pakai titik sebagai ribuan) | **Kolom utama qty SAP** |
| `Valuation Type` | `NORMAL` / `PRE-MEMORY` / `BURSA` | Filter jenis material |
| `Harga Satuan` | Harga per satuan (tanpa desimal untuk harga besar) | Referensi nilai |
| `Total Harga` | Total nilai (Harga × Qty) | Referensi |
| `Valuation Description` | Kategori aset (HAR-Transformator, HAR-Switchgear, dll) | Info tambahan |
| `Storage Location Description` | Nama gudang di SAP (Gd UPT Surabaya) | Verifikasi lokasi |

**Distribusi Valuation Type dari sampel data:**
- `NORMAL`: 14 item (material Cadang aktif)
- `PRE-MEMORY`: 113 item (material Pre-Memory, mayoritas)
- `BURSA`: 18 item (material Bursa/pengadaan khusus)

**Parse logic untuk match ke sistem WARNOTO:**
```js
// Strip leading zeros dari nomor SAP untuk cocokkan ke Master Katalog
const stripMaterial = (m) => m.replace(/^0+/, "");
// Cth: "000000001060011" → "1060011" → match katalog "1060011" di Master Katalog

// Parse qty SAP (format "1.000" = 1, "2.000" = 2)
const parseQtySAP = (q) => parseFloat(q.replace(/\./g, "").replace(",",".")) || 0;
// Note: titik sebagai ribuan separator, bukan desimal
```


#### 10.11 Revisi Alur Stock Opname (Final)

**Perubahan dari implementasi v23:**

| Aspek | v23 (lama) | Konsep Final |
| :--- | :--- | :--- |
| Navigasi | Form inline | Tab baru dalam halaman Stock Opname yang sama |
| Foto material | Belum ada | Wajib per item, disimpan di server PLN (referensi saja di sistem) |
| UX pengisian | Scroll panjang satu halaman | Paginasi 10 item per halaman |
| Non-SAP | Input qty fisik vs sistem | Sama + foto wajib per item |

**Alur SAP (Revised):**
```
Klik "Stock Opname SAP"
→ Tab baru terbuka dalam halaman Stock Opname
→ Step 1: Upload CSV SAP (format PEMAT)
   → Sistem parse + match ke Master Katalog
   → Generate daftar item (10 per halaman)
→ Step 2: Per item, Admin isi:
   - Qty Fisik (input number)
   - Nama File Foto (text input — format: [Deskripsi Material]_[No Katalog])
     contoh: "ISOLATOR_AFOG_POLYMER_3070213.jpg"
   → Sistem hitung selisih otomatis (Qty Fisik - Qty Sistem)
→ Step 3: Review summary selisih
→ Step 4: Submit → Asman → Manager → Data Stok disesuaikan
```

**Alur Non-SAP (Revised):**
```
Klik "Stock Opname Non-SAP"
→ Tab baru terbuka
→ Daftar item Non-SAP dari Data Stok ditampilkan (10 per halaman)
→ Per item, Admin isi:
   - Qty Fisik (dibandingkan langsung dengan Qty Sistem yang tampil)
   - Nama File Foto (format: [Deskripsi Material]_[No Katalog])
→ Tidak perlu upload CSV SAP
→ Submit → approval chain sama
```

**Format Nama File Foto:**
- Convention: `[Deskripsi Material]_[No Katalog].jpg`
- Contoh: `TRF_ACC_NGR_70KV_1060011.jpg`
- Disimpan di server PLN oleh Admin secara manual
- Sistem hanya menyimpan string nama file sebagai referensi
- Di Berita Acara, nama file foto dicantumkan per item sebagai bukti dokumentasi

**UX Paginasi:**
- 10 item per halaman
- Navigasi: `← Sebelumnya | Halaman X dari Y | Berikutnya →`
- Progress bar: berapa item sudah diisi qty fisik + foto
- Item yang belum lengkap diberi highlight kuning
- Bisa loncat ke halaman tertentu via dropdown

**Validasi Submit:**
- Semua item harus terisi qty fisik (tidak boleh kosong/negatif)
- Semua item harus ada nama file foto
- Item selisih wajib ada keterangan
- Jika belum lengkap → tombol Submit disabled + pesan error


#### 10.12 Revisi Final — Foto Opname di Dalam Sistem

**Perubahan dari 10.11:**
- Foto TIDAK disimpan di server eksternal
- Foto DIUPLOAD ke sistem dan disimpan sebagai base64
- Foto opname DITAMBAHKAN ke history foto Data Stok (bukan menggantikan)

**Solusi teknis storage:**
- Foto dikompres otomatis ke max 50KB via canvas resize sebelum disimpan
- Foto per sesi opname disimpan di key terpisah: `pln_opname_foto_[opnameId]`
  sehingga tidak ada satu key yang melebihi 5MB
- 145 item × 50KB = ~7.25MB → dipecah ke 2 key:
  `pln_opname_foto_[id]_A` (item 1-70) + `pln_opname_foto_[id]_B` (item 71-145)
- Atau lebih simpel: foto disimpan langsung di object item dalam opname,
  dan opname besar dipecah ke beberapa key otomatis jika melebihi 4MB

**Struktur foto per item opname:**
```js
{
  katalogId: "...",
  // ...field lainnya...
  fotoMaterial: "data:image/jpeg;base64,...", // base64 compressed ~50KB
  fotoUploadedAt: timestamp,
}
```

**Integrasi dengan Data Stok:**
Setelah opname di-approve Manager:
- `fotoMaterial` dari setiap item opname ditambahkan ke history foto
  di Data Stok yang bersangkutan
- Data Stok menyimpan array `fotoHistory`:
  ```js
  { img: "base64...", uploadedAt: timestamp, source: "opname", opnameId: "..." }
  ```
- Di halaman Data Stok, card material menampilkan foto terbaru
  + tombol "Lihat History Foto" untuk melihat semua foto lama

**Kompresi foto otomatis:**
```js
function compressImage(file, maxKB=50, callback) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, Math.sqrt((maxKB*1024)/(file.size)));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      callback(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
```

**UX pengisian per item (final):**
Tiap baris item di tabel opname punya:
- Input qty fisik (number)
- Tombol "📷 Upload Foto" → file picker → auto-kompres → preview thumbnail kecil
- Input keterangan (wajib jika selisih)

**Validasi submit (final):**
- Semua item: qty fisik wajib diisi
- Semua item: foto wajib diupload (indikator progress: X/145 foto)
- Item selisih: keterangan wajib
- Progress bar di atas tabel: "✅ 45/145 item lengkap"


#### 10.13 Keputusan Final — Foto Stock Opname

**Fase 1 (implementasi sekarang):** Foto SKIP — tidak diimplementasikan.
Fokus pada alur inti: CSV SAP → compare → qty fisik → approval → Data Stok disesuaikan.

**Fase 2 (butuh infrastruktur server PLN):**
- Server PLN sediakan API endpoint: `POST /api/foto/upload` → return URL
- Aplikasi kirim file → server simpan → aplikasi simpan URL
- Foto tampil di aplikasi via `<img src="[URL dari server PLN]">`
- Foto ditambahkan ke history foto Data Stok per material
- Prerequisit: server PLN accessible dari browser + API endpoint ready

**Alur final Stock Opname Fase 1 yang akan diimplementasikan:**

```
SAP:
Klik "Opname SAP" → Tab baru
→ Upload CSV SAP (format PEMAT)
→ Sistem parse + match ke Master Katalog
→ Tabel perbandingan (10 item/halaman):
   | Nama Barang | No Katalog | Qty Sistem | Qty SAP | Qty Fisik [input] | Selisih | Keterangan |
→ Validasi: semua qty fisik terisi + keterangan wajib jika selisih
→ Submit → PENDING_ASMAN → PENDING_MANAGER → SELESAI
→ Data Stok disesuaikan otomatis
→ Download Berita Acara

NON-SAP:
Klik "Opname Non-SAP" → Tab baru
→ Daftar item Non-SAP dari Data Stok (10 item/halaman)
→ Tabel perbandingan:
   | Nama Barang | No Katalog | Qty Sistem | Qty Fisik [input] | Selisih | Keterangan |
→ Alur approval sama
```


---

### 11. Planning — AI Forecasting Stock & AI Agent Manajemen
*Status: PLANNING ONLY — konsep final, belum dieksekusi*

#### 11.1 Konsep Terintegrasi

AI Agent dan Forecasting TERINTEGRASI dalam satu halaman (menu 🤖 AI Agent yang sudah ada di sidebar). Struktur halaman:

```
🤖 AI AGENT & FORECASTING
├── Tab 1: 🔮 Forecast Stok   ← tampilan visual semua material + drill-down
└── Tab 2: 💬 Tanya AI        ← chat interface, bisa tanya forecast juga
```

AI Agent di tab chat bisa menjawab pertanyaan forecast maupun data stok/TUG — semua dalam satu interface.

#### 11.2 Tab Forecast Stok

**View A — Semua Material (Default):**
AI scan seluruh stok → identifikasi material yang perlu perhatian → tampilkan sebagai daftar prioritas dengan badge risiko.

Layout: grid card per material, diurutkan dari risiko tertinggi:
```
┌────────────────────────────────────────────┐
│ 🔴 KRITIS    Isolator 150KV  3070213       │
│ Stok: 2 SET • Avg pakai: 3/bulan          │
│ Estimasi habis: ~20 hari                  │
│ [Lihat Analisis Detail]                   │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│ 🟡 PERHATIAN  Bushing CT   1002010529      │
│ Stok: 5 BH • Avg pakai: 1/bulan          │
│ Estimasi habis: ~5 bulan                  │
│ [Lihat Analisis Detail]                   │
└────────────────────────────────────────────┘
```

Badge risiko:
- 🔴 KRITIS: stok < kebutuhan 1 bulan
- 🟡 PERHATIAN: stok cukup 1-3 bulan
- 🟠 WASPADA: stok cukup 3-6 bulan
- 🟢 AMAN: stok cukup > 6 bulan

**View B — Drill-down Per Material:**
User pilih material → klik "Lihat Analisis Detail" → AI (Claude API) analisis mendalam:

Input ke Claude API:
```json
{
  "material": "Isolator 150KV [3070213]",
  "stokSaatIni": 2,
  "satuan": "SET",
  "historyPemakaian": [
    {"bulan":"2026-01","qty":3},
    {"bulan":"2025-12","qty":2},
    ...
  ],
  "rencanaKedatangan": "15 SET dijadwalkan tiba 2026-08-10",
  "request": "Analisis dan forecast kebutuhan material ini"
}
```

Output AI (format terstruktur):
```
📊 DATA
• Stok saat ini: 2 SET
• Rata-rata pemakaian: 2.5 SET/bulan (6 bulan terakhir)
• Puncak tertinggi: Maret 2026 (5 SET — kemungkinan ada gangguan)

🔍 ANALISIS
Berdasarkan pola historis, stok saat ini hanya cukup untuk...
Tren pemakaian menunjukkan peningkatan di Q1 setiap tahun...

💡 REKOMENDASI
1. Segera proses pengadaan minimal X SET
2. Target lead time pengadaan rata-rata Y hari
3. Safety stock ideal: Z SET
```

#### 11.3 Tab Chat AI Agent

**Interface:** Chat box full-height dengan:
- Input field di bawah (kirim dengan Enter atau tombol Kirim)
- Riwayat chat di atas (scroll)
- Suggested questions (chip-chip) untuk user yang bingung mau tanya apa

**Suggested questions (ditampilkan saat chat kosong):**
- "Berapa stok Isolator 150KV sekarang?"
- "Material apa yang paling sering dipakai bulan ini?"
- "Ada berapa TUG yang pending approval?"
- "Forecast stok Bushing CT untuk 3 bulan ke depan"
- "Kapan terakhir kita terima material dari kontrak pengadaan?"
- "Material apa yang hampir habis?"

**Data Context yang dikirim ke Claude API:**
Setiap pertanyaan user, sistem otomatis menyertakan snapshot data sistem sebagai context:
```js
const systemContext = `
Kamu adalah AI Agent sistem manajemen gudang PLN (WARNOTO) untuk UPT Surabaya.
Jawab pertanyaan dalam format terstruktur: Data → Analisis → Rekomendasi.
Gunakan Bahasa Indonesia. Sertakan angka spesifik dari data berikut:

RINGKASAN STOK (${stocks.length} item):
${topStok.map(s=>`- ${s.nama} [${s.katalog}]: ${s.totalQty} ${s.satuan}`).join('\n')}

MATERIAL KRITIS (stok rendah):
${stokKritis.map(s=>`- ${s.name}: ${s.qty}/${s.minQty} ${s.unit}`).join('\n')}

TUG PENDING: ${pendingCount} transaksi menunggu approval
RENCANA KEDATANGAN: ${upcoming} item dalam 30 hari ke depan
TOTAL NILAI INVENTORI: ${fmtRp(totalNilai)}
`;
```

**Format jawaban AI (structured response):**
Setiap jawaban AI Agent selalu dalam format:
```
📊 DATA
[fakta & angka dari sistem]

🔍 ANALISIS
[interpretasi & konteks]

💡 REKOMENDASI
[tindakan yang disarankan]

Sumber: Data sistem WARNOTO per [tanggal hari ini]
```

#### 11.4 Implementasi Teknis

**API Call:**
- Model: `claude-sonnet-4-6` (sama dengan Rencana Kedatangan)
- Max tokens: 1500 (lebih besar dari Rencana Kedatangan karena jawaban lebih panjang)
- Temperature: default (0 tidak perlu di-set, API default sudah OK)

**Context window management:**
- Kirim hanya TOP 20 material berdasarkan nilai/aktivitas (bukan semua 145 item)
- Data TUG: hanya 3 bulan terakhir
- Rencana kedatangan: hanya 60 hari ke depan
- Tujuan: jaga context < 4000 token agar hemat biaya dan cepat

**Chat history:**
- Simpan max 10 pesan terakhir dalam state (tidak di cloud)
- Reset saat pindah halaman
- User bisa klik "Bersihkan Chat"

**Forecasting per material:**
- History pemakaian diambil dari txns TUG-9/TUG-8 APPROVED
- Group by bulan, hitung qty keluar per bulan per katalogId
- Kirim max 12 bulan terakhir ke Claude
- Claude analisis tren + prediksi + rekomendasi

#### 11.5 Urutan Eksekusi

1. Ubah halaman AI Agent yang sudah ada menjadi 2 tab (Forecast + Chat)
2. Implementasi View A Forecast (semua material — kalkulasi lokal, tidak perlu API)
3. Implementasi View B Forecast (drill-down per material — Claude API)
4. Implementasi Chat AI Agent dengan context injection otomatis
5. Tambah suggested questions chips
6. Connect Forecast drill-down dengan Chat (klik "Tanya AI tentang material ini" dari card forecast)


---

### 12. Planning — Roadmap AI/ML WARNOTO (Revised)
*Status: PLANNING ONLY — konsep final*

#### 12.1 Roadmap 3 Fase

```
FASE 1 — SELESAI ✅
WARNOTO aplikasi operasional penuh (TUG, Dashboard, Stock Opname, dll)
Data collection berjalan otomatis via TUG-15

FASE 2 — TARGET 1 BULAN (Hybrid Approach)
Week 1-2: Enhanced Claude API Forecasting
Week 3-4: True ML preparation (Python, model eksperimen lokal)

FASE 3 — TARGET 3-6 BULAN (True ML Production)
Python ML server live
Model terlatih dengan data WARNOTO
Integrasi API ke WARNOTO
```

#### 12.2 Fase 2 — Detail Eksekusi (1 Bulan)

**Week 1-2: Enhanced Claude API dalam WARNOTO**

Yang dikerjakan di aplikasi WARNOTO:
- Tab 🔮 Forecast: view semua material (kalkulasi lokal moving average)
- Tab 🔮 Forecast: drill-down per material → Claude API analisis history TUG-15
- Tab 💬 AI Agent: chat dengan context injection data sistem
- Format jawaban terstruktur: Data → Analisis → Rekomendasi
- Suggested questions chips

Context yang dikirim ke Claude per request:
- Top 20 material berdasarkan nilai/aktivitas (bukan semua)
- History pemakaian per material: 12 bulan terakhir (group by bulan)
- Stok saat ini, min qty, rencana kedatangan
- TUG pending count, nilai inventori total

**Week 3-4: True ML Preparation (Lokal, Paralel)**

Yang dikerjakan di luar WARNOTO (laptop/PC):
```
1. Setup environment Python:
   pip install pandas scikit-learn xgboost prophet matplotlib jupyter

2. Export data dari WARNOTO:
   - Download TUG-15 Excel → bersihkan di Python
   - Target: dataset bersih min 12 bulan history

3. Eksplorasi data (EDA):
   - Plot pola pemakaian per material
   - Identifikasi material dengan pola jelas vs random
   - Identifikasi outlier (bulan gangguan besar)

4. Training model pertama (sederhana):
   - Mulai dengan Linear Regression / Prophet
   - Evaluasi MAPE per material
   - Dokumentasi: material mana yang bisa diprediksi dengan baik

5. Deliverable Week 4:
   - Jupyter notebook dengan analisis + model pertama
   - Laporan: "X% material bisa diprediksi dengan akurasi > 80%"
   - Identifikasi bottleneck untuk Fase 3
```

#### 12.3 Fase 3 — True ML Production

**Prerequisites (harus terpenuhi sebelum mulai):**
- Minimal 18 bulan data history di WARNOTO
- Server dengan Python environment (sudah tersedia)
- API endpoint plan: URL, authentication, format request/response

**Komponen yang dibangun:**
```
1. ML Pipeline (Python):
   ├── Data ingestion: export otomatis dari WARNOTO
   ├── Feature engineering: bulan, kuartal, moving avg, flag gangguan
   ├── Model training: XGBoost per material
   ├── Model evaluation: MAPE, RMSE, coverage
   └── Model serving: FastAPI endpoint

2. API Endpoint:
   POST /api/forecast
   Body: { katalogId, horizon: 3 } // horizon dalam bulan
   Response: {
     prediksi: [{bulan:"2026-08", qty:3}, ...],
     confidence: "75%",
     rekomendasi: "Perlu pengadaan minimal X unit sebelum..."
   }

3. Integrasi WARNOTO:
   - Ganti kalkulasi lokal moving average → call ke ML API
   - Tampilkan confidence interval di chart forecast
   - Badge akurasi model di UI

4. Monitoring:
   - Dashboard akurasi model (actual vs prediksi per bulan)
   - Alert jika MAPE > 25% (model perlu retrain)
   - Retrain otomatis setiap bulan dengan data baru
```

#### 12.4 Data Requirements untuk ML

Kualitas data yang harus dijaga di WARNOTO mulai sekarang:

| Field | Wajib Ada | Keterangan |
| :--- | :--- | :--- |
| katalogId | ✅ | Primary key untuk grouping |
| tanggal transaksi | ✅ | Untuk time series |
| qty keluar | ✅ | Target variable |
| jenis transaksi | ✅ | TUG-9 vs TUG-8 |
| status APPROVED | ✅ | Filter hanya transaksi valid |
| noSPK/pekerjaan | ⬜ | Untuk identifikasi gangguan |

**Target minimum data:** 18 bulan × semua material aktif

#### 12.5 Perbandingan Fase 2 vs Fase 3

| Aspek | Fase 2 (Claude API) | Fase 3 (True ML) |
| :--- | :--- | :--- |
| Waktu implementasi | 1-2 minggu | 2-3 bulan |
| Akurasi prediksi | ~60-70% (estimasi) | ~80-90% (target) |
| Penjelasan naratif | ✅ Sangat baik (Claude) | ⬜ Perlu effort tambahan |
| Confidence interval | ❌ Tidak ada | ✅ Ada |
| Biaya API | Per request (Anthropic) | Server cost (satu kali) |
| Retrain otomatis | ❌ Tidak | ✅ Bisa otomatis |
| Offline capability | ❌ Butuh internet | ✅ Bisa offline |
| Resources dibutuhkan | Solo + AI tools | Solo + Python skills |

#### 12.6 Tools & Resources untuk Belajar ML (Paralel Fase 2)

Untuk mempersiapkan Fase 3 sambil mengerjakan Fase 2:
- **Platform belajar:** Kaggle (gratis, ada dataset latihan), Fast.ai
- **Library utama:** pandas, scikit-learn, xgboost, prophet, matplotlib
- **Referensi spesifik:** Time series forecasting dengan Python
- **Dataset latihan:** Gunakan TUG-15 export dari WARNOTO sendiri
- **Tools AI:** Gunakan Claude untuk debug kode Python + explain ML concepts


---

### 13. Planning — Pemisahan Kategori Persediaan (Konsep Final)
*Status: PLANNING DONE — siap eksekusi*

#### 13.1 Struktur Kategori Lengkap (Final)

```
JENIS_BARANG (7 kategori):
├── Cadang          → 10 digit katalog, semua Valuation Type
├── Persediaan      → 7-8 digit katalog, Valuation Type: NORMAL
├── Persediaan Bursa → 7-8 digit katalog, Valuation Type: BURSA  ← DIPISAH
├── Pre Memory      → 7-8 digit katalog, Valuation Type: PRE-MEMORY
├── ATTB            → Non-SAP
├── Non-Stock       → Non-SAP
└── Bongkaran       → Non-SAP
```

#### 13.2 Dampak Pemisahan di Semua Tempat

**A. JENIS_BARANG constant** ✅ sudah ada `Persediaan Bursa`

**B. Dashboard KPI Saldo:**
- Sekarang: 2 card (Cadang + Persediaan)
- Seharusnya: 4 card (Cadang + Persediaan + Persediaan Bursa + Pre Memory)
- `nilaiPersediaan` hanya filter `jenisBarang==="Persediaan"` (bukan include Bursa)
- Tambah `nilaiPersediaanBursa` dan `nilaiPreMemory`

**C. Filter Data Stok:**
- Dropdown filter jenisBarang sudah pakai `JENIS_BARANG` → otomatis include Persediaan Bursa ✅

**D. TUG-15 Laporan Mutasi:**
- Filter jenisBarang sudah dynamic → otomatis ✅

**E. Dashboard Asman & Manager KPI:**
- `nilaiPersediaan` perlu dipecah

**F. KPISaldoCards component:**
- Expand dari 2 card → 4 card

**G. `jenisBarangAccentColor`:**
- Tambah warna untuk `Persediaan Bursa`

**H. `getSAPLabel`:**
- Sudah generic "SAP — Persediaan" untuk semua 7-8 digit ✅

**I. TUG-3 receiving & TUG-10 return:**
- Default jenisBarang saat create stok baru dari penerimaan → perlu opsi Persediaan Bursa

#### 13.3 Perubahan KPI Card Dashboard

Dari 2 card:
```
[Saldo Cadang] [Saldo Persediaan]
```

Menjadi 4 card grid 2×2:
```
[Saldo Cadang] [Saldo Persediaan]
[Saldo Persediaan Bursa] [Saldo Pre Memory]
```

Warna per kategori:
- Cadang: merah (#dc2626)
- Persediaan: hijau (#16a34a)
- Persediaan Bursa: oranye (#ea580c)
- Pre Memory: biru (#1d4ed8)


---

### 14. Status Terkini — v31 (Final Update Juni 2026)

#### 14.1 File Aktif
- **Active file:** `/home/claude/pln-warehouse-v31.jsx` (7.052 baris, Balance 0 0 0)
- **Last presented:** `/mnt/user-data/outputs/pln-warehouse-tug9.jsx` = v31

#### 14.2 Semua Fitur yang Sudah Selesai (v31)

**Core System:**
- Role & akun (8 role): ADMIN, TL, ASMAN, MANAGER, ADMIN_UIT, MGR_LOGISTIK_UIT, PENGADAAN, VIEWER
- Cloud storage: `pln_stocks_v4`, `pln_katalog_v4`, `pln_lokasi_v4`, `pln_txns_v3`, `pln_docseq_v3`, `pln_satpam_v3`, `pln_timmutu_v1`, `pln_uit_v1`, `pln_upt_v1`, `pln_gudang_v1`, `pln_rencana_v1`, `pln_opname_v1`
- Export/Import JSON backup (tombol di sidebar, hanya ADMIN)
- Data SAP 145 material hardcoded sebagai DEFAULT (tidak hilang saat reload)

**Master Data:**
- Katalog Barang (CRUD + auto-detect SAP/Non-SAP)
- Lokasi/Blok Gudang
- Satpam, Tim Mutu, Master UIT, Master UPT
- Master Gudang (dengan upload PDF denah + konfigurasi koordinat blok)

**Jenis Barang (7 kategori):**
- Cadang (10 digit katalog)
- Persediaan (7-8 digit, Valuation Type NORMAL)
- Persediaan Bursa (7-8 digit, Valuation Type BURSA) ← dipisah v30
- Pre Memory (7-8 digit, Valuation Type PRE-MEMORY)
- ATTB, Non-Stock, Bongkaran

**TUG Dokumen (semua dengan HTML builder cetak):**
- TUG-2: Kartu Gantung Digital
- TUG-3/4: Penerimaan Barang (3 tahap approval)
- TUG-5: Permintaan Barang (Intracompany/Intercompany)
- TUG-7: Perintah Penyerahan UIT
- TUG-8: Pemakaian Unit Lain
- TUG-9: Pemakaian Sendiri
- TUG-10: Pengembalian ke Gudang
- TUG-15: Laporan Mutasi Stok (filter + download HTML + Excel .xlsx)

**Dashboard (3 versi per role):**
- Default (Admin/TL/Viewer): 4 KPI + 4 KPI Saldo (Cadang/Persediaan/Bursa/PreMemory) + analitik
- Asman (Operasional): 5 KPI + stok kritis + akan habis + analitik
- Manager (Eksekutif): header gradient + tabel per-UPT + compliance + analitik

**Dashboard Analitik (3 Widget):**
- 🔥 Paling Sering Dipakai (toggle Frekuensi/Qty, bar progress)
- 📦 Stok Terbanyak (agregat per katalog)
- ⚠️ Akan Habis (dual kondisi: stok≤minQty + estimasi hari)
- Dropdown topN shared: 5/10/20

**Peta Gudang (🗺️):**
- Master Gudang dengan upload PDF denah → pdf.js render → PNG background
- Mode Konfigurasi Koordinat: klik gambar → assign blok
- Full view peta: titik merah per blok, hover → popup list material
- Card Data Stok: tombol 📍 → modal peta mini dengan titik animasi pulse

**Rencana Kedatangan Barang (📅):**
- Upload PDF kontrak → Claude API ekstrak → user review → simpan
- Widget 30 hari di Dashboard dengan badge ⚠️ Terlambat
- Role PENGADAAN: hanya akses Dashboard + Rencana Kedatangan

**Stock Opname (📋):**
- Alur SAP: upload CSV/XLSX PEMAT → parse → tabel perbandingan (Qty Sistem vs SAP vs Fisik)
- Alur Non-SAP: input qty fisik langsung vs Data Stok
- Paginasi 10 item/halaman + progress bar completeness
- Approval: Asman → Manager → Data Stok otomatis disesuaikan
- Download Berita Acara HTML (4 tanda tangan)
- Foto: Fase 2 (menunggu server PLN + API endpoint)

**Import SAP (⬆️):**
- Support CSV dan XLSX (SheetJS)
- Handle BOM UTF-8 otomatis
- Preview 3-step: Upload → Preview (filter per jenis) → Done
- Logika jenis barang dari digit katalog + Valuation Type
- Lokasi diisi manual setelah import (quick-edit dropdown per card)

**AI Agent & Forecasting (🤖):**
- Tab 🔮 Forecast: grid semua material + badge risiko + drill-down per material → Claude API
- Tab 💬 Tanya AI: chat dengan context injection otomatis, format terstruktur Data/Analisis/Rekomendasi
- Suggested questions chips, history 8 pesan, tombol reset chat

**Approval Tab:**
- Handle semua TUG type: TUG-3/5/7/8/9/10
- Dynamic stage labels, warna border per tipe
- Modal TUG-7 lengkapi (Admin UIT) langsung dari Approval

#### 14.3 Bug yang Sudah Diperbaiki

| Bug | Fix di versi |
| :--- | :--- |
| `sapRows` duplikat deklarasi → error artifact | v29 |
| Filter Data Stok salah (jenisBarang tidak dari Master Katalog) | v30 |
| Import SAP tidak update jenisBarang katalog yang sudah ada | v30 |
| BOM UTF-8 menyebabkan semua kolom import kosong | v29 |
| Balance `jenisBarangAccentColor` ada sisa kode lama | v30 |
| Persediaan Bursa tidak muncul di filter dan KPI | v30 |

#### 14.4 Yang Belum Diimplementasikan (Deferred)

| Fitur | Alasan Defer | Target |
| :--- | :--- | :--- |
| Foto Stock Opname | Butuh server PLN + API endpoint | Fase 2 |
| Multi-UPT data terisolasi | Butuh backend nyata | Fase 2 |
| Material Cadang | Spesifikasi konsep, format import, hidden Catalog Master/MARA reference, dashboard manajemen, dan approval Asman untuk apply `minQty` sudah dipisah di `MATERIAL_CADANG_SPEC.md` | Fase 2 |
| WA AI Agent | Spesifikasi integrasi AI Agent ke WhatsApp Cloud API, read-only, whitelist nomor, server-side state, RAG sync harian, dan audit log sudah dipisah di `WA_AI_AGENT_SPEC.md` | Fase 2 |
| Migrasi Stok SAP/Non-SAP + TUG-15 | Planning cutover data, cleansing Non-SAP, staging review, histori migrasi `MIGRASI`, dan backup wajib terdokumentasi di bagian 20 | Fase 2 |
| True ML Forecasting (XGBoost) | Butuh Python server | Fase 3 |
| SAP API integration | Butuh middleware | Fase 3 |
| Retrain model otomatis | Butuh Fase 3 selesai | Fase 3 |

#### 14.5 Roadmap Selanjutnya

**Jangka pendek (dalam aplikasi):**
- Input stok Non-SAP (ATTB, Bongkaran) manual
- Assign lokasi/blok per material setelah import SAP
- Upload denah gudang PDF untuk Peta Gudang
- Review dan implementasi fitur Material Cadang berdasarkan `MATERIAL_CADANG_SPEC.md`
- Siapkan hidden SAP MARA reference untuk lookup/extend Master Katalog tanpa memenuhi Master Data utama
- Siapkan alur approval Asman untuk penerapan rekomendasi Material Cadang ke `minQty`
- Review dan implementasi WA AI Agent berdasarkan `WA_AI_AGENT_SPEC.md`
- Siapkan server-side state Supabase agar AI Agent WhatsApp bisa membaca konteks yang setara dengan AI Agent web
- Siapkan migrasi data stok SAP/Non-SAP dan histori TUG-15 berdasarkan planning bagian 20

**Fase 2 (1 bulan):**
- Enhanced Claude API forecasting (sudah ada di v31)
- Python ML preparation lokal (paralel)
- Foto opname saat server PLN tersedia

**Fase 3 (3-6 bulan):**
- Python FastAPI ML server
- XGBoost model per material
- Integrasi API ke WARNOTO
- Integrasi SAP


---

### 15. Revisi — Upload Denah Gudang (Final)

**Masalah:** pdf.js tidak bisa berjalan di Claude Artifact (sandboxed iframe memblokir dynamic import() dari CDN eksternal).

**Keputusan:** Ganti upload PDF → upload **gambar (PNG/JPG/JPEG)** langsung.

**Alur baru:**
```
User convert PDF denah ke gambar di luar sistem
(foto, screenshot, atau export dari PDF viewer)
        ↓
Upload PNG/JPG di Master Gudang
        ↓
Gambar langsung jadi background peta (tidak perlu konversi)
        ↓
Admin klik di gambar → assign koordinat blok
```

**Yang perlu diubah di kode:**
1. Input file: ganti `accept=".pdf"` → `accept="image/*"`
2. Hapus seluruh fungsi `renderPdfToImage()` dan `pdfjsLib` logic
3. Ganti dengan `FileReader.readAsDataURL()` langsung → base64 image
4. Update label UI: "Upload Denah Gudang (PNG/JPG)" bukan "(PDF)"
5. Kompresi: canvas resize jika gambar > 2MB agar tidak melebihi limit storage 5MB

**Format yang diterima:** PNG, JPG, JPEG, WebP

---

### 16. Planning — Unifikasi Master Gudang + Master Lokasi (Belum Dikerjakan)

**Status: KONSEP — belum diimplementasikan ke kode.**

#### 16.1 Latar Belakang

Saat ini Master Gudang dan Master Lokasi adalah 2 sub-tab terpisah di Master Data, padahal secara bisnis hierarkinya menyatu: 1 UPT punya beberapa Gudang, 1 Gudang punya beberapa Blok Lokasi. Pemisahan ini bikin admin harus pindah-pindah tab untuk kelola data yang sebenarnya satu kesatuan. Tujuan revisi: gabungkan jadi satu halaman per-Gudang yang menampilkan denah + daftar blok sekaligus.

#### 16.2 Struktur Sidebar (Final)

Master Data jadi accordion 1 level (pola sama seperti TUG — klik expand, sub-item navigasi), Master Gudang tetap **sub-item biasa di dalamnya**, TIDAK dibuat nested-dropdown sendiri:

```
🗂️ Master Data ▶
   ├─ 📑 Master Katalog
   ├─ 🛡️ Satpam
   ├─ 👥 Tim Mutu
   ├─ 🏢 Master UIT
   ├─ 📍 Master UPT
   └─ 🏭 Master Gudang        ← sub-item biasa (tidak expand lagi)
```

Pemilihan gudang mana yang sedang dilihat/dikelola dilakukan **di dalam halaman** (dropdown selector), bukan di pohon navigasi sidebar.

#### 16.3 Halaman "Master Gudang" (gabungan, satu tempat)

```
🏭 Master Gudang                    [Pilih Gudang ▾] Gudang Ketintang
                                     [+ Tambah Gudang Baru]

Alamat: ...                         [✏️ Edit Gudang] [🗑️ Hapus Gudang]

🗺️ Denah Gudang
[gambar denah + marker blok]
[Upload/Ganti Denah]  [⚙️ Konfigurasi Koordinat Blok]

📍 Daftar Blok Lokasi (7)            [+ Tambah Blok Baru]
- Rak A-1 — Area Transformator       [Edit][Hapus]
- Rak A-2 — ...  ⏳ Menunggu Approval [Edit][Hapus]
```

Tab "🗺️ Peta Gudang" di sidebar utama **tetap ada** sebagai pintu masuk lain ke halaman yang sama (shared component) — bukan duplikat tampilan, cuma 2 jalan menuju 1 tempat. Klik nama gudang dari mana pun (sidebar Master Data atau tab Peta Gudang) selalu menampilkan halaman gabungan ini dengan `selectedGudangId` yang sesuai.

Daftar gudang di UPT Surabaya saat ini (untuk referensi seed data):
1. Gudang Ketintang
2. Gudang Wonorejo Semi Terbuka 1
3. Gudang Wonorejo Semi Terbuka 2
4. Gudang Wonorejo Tertutup
5. Gudang Wonorejo Terbuka
6. Gudang Terbuka GI Buduran
7. Gudang Terbuka GI Surabaya Selatan

#### 16.4 Yang Dihapus / Dipindah

| Sebelumnya | Sesudahnya |
| :--- | :--- |
| Tab "Master Data → Master Gudang" (grid card) | Diganti halaman gabungan baru (16.3) |
| Tab "Master Data → Master Lokasi" | Dihapus total, isinya pindah jadi "Daftar Blok Lokasi" di halaman gabungan |
| "Master Data" sidebar (klik langsung ganti tab) | Jadi accordion expand/collapse seperti TUG |

#### 16.5 Fitur yang Tetap Dipakai (sudah dibangun di v terbaru, tidak berubah)

- **Approval TL**: semua tambah/edit/hapus Blok Lokasi oleh non-TL berstatus `PENDING` dulu, baru aktif setelah TL approve dari panel "🔔 Menunggu Approval Anda". TL yang input sendiri otomatis `APPROVED`.
- **Badge status pending**: marker abu-abu garis putus + label "⏳ Menunggu Approval" di peta untuk blok yang belum disetujui.
- **OCR pada gambar denah**: setelah upload PNG denah, `tesseract.js` membaca teks/label yang sudah tergambar di gambar dan menyimpannya sebagai `denahOcrWords` (teks + posisi % di gambar) per Gudang.

#### 16.6 Revisi Baru — Rekomendasi Blok Batch dari OCR (Editable & Hapus)

**Perubahan dari versi sebelumnya:** sebelumnya OCR cuma dipakai *reaktif* (1 saran kode saat admin klik 1 titik di peta). Revisi ini membuatnya *proaktif*: begitu admin upload PNG denah baru, sistem langsung **mengusulkan banyak blok sekaligus** berdasarkan semua label yang terbaca dari OCR, ditampilkan sebagai daftar usulan yang bisa diedit/dihapus sebelum dikonfirmasi.

**Alur:**
```
Admin upload PNG denah Gudang
        ↓
tesseract.js OCR baca semua teks di gambar
        ↓
Sistem kelompokkan tiap kata/label terbaca jadi "Usulan Blok":
  { kode: <teks terbaca>, xPct, yPct }
        ↓
Tampil panel "📋 Usulan Blok dari Denah (N ditemukan)"
  ┌─────────────────────────────────────────┐
  │ ☑ Blok A    (posisi: 12%, 34%)  [✏️][🗑️] │
  │ ☑ Blok B    (posisi: 45%, 20%)  [✏️][🗑️] │
  │ ☐ XYZ123    (posisi: 80%, 60%)  [✏️][🗑️] │  ← OCR salah baca, admin uncheck/hapus
  └─────────────────────────────────────────┘
  [Konfirmasi & Tambahkan Blok Terpilih]
        ↓
Setiap blok yang dicentang & dikonfirmasi → masuk ke lokasiList
sebagai pengajuan baru (status PENDING, kecuali yang input adalah TL)
        ↓
TL approve dari panel "🔔 Menunggu Approval Anda" (alur sama seperti 16.5)
```

**Kemampuan di panel usulan (sebelum konfirmasi):**
- ✏️ **Edit** — ubah teks kode yang terbaca OCR salah/kurang tepat, dan ubah posisi (drag ulang titik di gambar)
- 🗑️ **Hapus** — buang usulan yang salah deteksi (misalnya OCR membaca noise/watermark sebagai teks)
- ☑️ **Centang/uncentang** — pilih mana saja dari usulan yang mau benar-benar ditambahkan, tidak harus semua

**Penyesuaian struktur data:**
- Tidak ada perubahan skema `lokasiList` — usulan batch ini cuma state sementara di UI (`ocrSuggestions`, belum tersimpan) sebelum user klik "Konfirmasi & Tambahkan", baru di titik itu masing-masing baris yang tercentang diubah jadi entri baru di `lokasiList` (lewat fungsi `saveLokasi` yang sudah ada, otomatis kena alur approval TL di 16.5).
- Mode klik-1-titik yang sudah ada (opsi "➕ Blok Baru" di "Konfigurasi Koordinat Blok") tetap dipertahankan sebagai cara tambah manual/satuan, berdampingan dengan cara batch ini.

#### 16.7 Pertanyaan Terbuka (belum dijawab user, untuk didiskusikan saat implementasi)

- Threshold confidence OCR — kata dengan confidence rendah dari tesseract.js apakah tetap dimasukkan ke usulan (dengan warning) atau langsung disaring?
- Kapasitas default (`kapasitas: 50`) untuk blok hasil batch — disamakan semua atau diminta isi manual per baris sebelum konfirmasi?
- Apakah usulan OCR juga jalan ulang kalau denah gudang yang sama di-upload ulang (re-upload), dan bagaimana menghindari duplikat blok dengan kode yang sama persis?

---

### 17. Sesi 28 Juni 2026 — Ringkasan Pekerjaan (lanjut malam ini)

#### 17.1 Logo PLN di Dokumen Cetak
- Logo emoji ⚡ di TUG-9/TUG-10 (dan dokumen cetak lain) diganti logo asli PT PLN.
- File baru: `src/assets/Logo_PLN.png` (asli, dari user) + `src/assets/plnLogoBase64.js` (data URI base64, dipakai di HTML cetak karena dokumen di-generate sebagai Blob standalone, tidak punya akses ke server Vite saat dibuka).

#### 17.2 Pencarian Data Stok (search yang "mengerti" struktur penamaan)
- **Aturan keras (jangan dilanggar)**: struktur penamaan katalog `KATEGORI;SUBTIPE;SPEK...` **tidak boleh diubah** — yang diubah hanya proses pencarian.
- `CATEGORY_SYNONYMS` (luas, satu arah, hanya expand haystack) vs `QUERY_SYNONYMS` (sempit, dua arah, aman untuk expand kata yang diketik) — pemisahan ini WAJIB dipertahankan, jangan digabung lagi (riwayat bug: kalau digabung, query pendek seperti "pt"/"ct" jadi nyasar match ke "trf" karena sama-sama mengandung kata "trafo").
- Token ≤2 huruf wajib exact match, token ≥3 huruf pakai prefix match (riwayat bug: kalau semua pakai prefix, "cu" nyasar match "cub"/"current").
- `dedupeById()` jalan otomatis di `loadCloud()` untuk bersihkan id duplikat yang sudah lebih dulu tersimpan di localStorage user (perbaikan source code saja tidak cukup karena data lama sudah keburu tersimpan).

#### 17.3 Mobile UX Overhaul
- `isMobile` (lebar ≤768px) + `mobileMenuOpen` → sidebar jadi drawer fixed di HP, hamburger menu, overlay gelap saat terbuka.
- `sty.btn/input/select` semua membesar otomatis di HP (min-height 44px, font 16px biar HP tidak auto-zoom).
- `capture="environment"` di semua 14 input foto (langsung buka kamera HP), `inputMode="decimal"` di semua 16 input angka.
- `sty.stickyFooter` — tombol Batal/Simpan nempel di bawah modal panjang yang bisa di-scroll.

#### 17.4 Tampilan Tabel Horizontal (Data Stok & Master Katalog)
- Card-grid diganti `<table>` horizontal sesuai referensi (kolom: Foto, Nama, Kategori, Qty, dst) — **tanpa mengubah data sumber sedikit pun**, hanya cara render.
- Master Katalog: kolom "Total di Semua Lokasi" & "Lokasi" dihapus (sesuai permintaan, tidak relevan di Master Data); diganti kolom Jenis (Cadang/Persediaan/dst) + Status (SAP/Non-SAP). Kolom Kategori diisi otomatis dari potongan pertama `name` sebelum `;` (karena field `category` di data lama kosong/"Lainnya").
- Data Stok: kolom "Lokasi/Blok" dipecah jadi 2 kolom terpisah — **Gudang** (dropdown gudang) lalu **Blok** (dropdown blok, terfilter sesuai Gudang terpilih) — supaya tidak 1 dropdown raksasa gabungan semua blok se-UPT.

#### 17.5 Approval Pemindahan Blok Stok (1-per-1 oleh TL)
- Saat ADMIN ganti Blok stok di Data Stok → **tidak langsung tersimpan**, masuk status `lokasiMovePending` menunggu approval TL (field baru di stock: `pendingLokasiId`, `pendingLokasiKode`, `moveRequestedBy/At`, `moveApprovedBy/At`).
- Fungsi: `approveStockMove(id)` / `rejectStockMove(id)`.

#### 17.6 Konsolidasi Menu Approval
- Semua notifikasi approval (Lokasi/Blok, Pemindahan Stok, Transaksi TUG) dipindah ke satu menu **"✅ Approval"**, dipisah per-bagian dengan header jelas (📍 Lokasi/Blok, 📦 Pemindahan Stok, 🔄 TUG).
- **Riwayat Approval** baru — `approvalHistoryList` (state baru + storage key `pln_approval_history_v1`), dicatat lewat `logApprovalHistory()` setiap kali approve/reject Lokasi atau Pemindahan Stok. Riwayat TUG diturunkan langsung dari `txns` (tidak perlu storage tambahan, sudah ada `approvedBy/At` / `rejectedBy/At` di tiap txn).
- Panel approval lama yang dobel di Master Gudang (khusus Lokasi/Blok) **sudah dihapus** — sekarang cuma ada di menu Approval.

#### 17.7 Dashboard — 3 Fitur Baru (selalu di urutan PALING ATAS, sebelum KPI/chart lama)
1. **🗺️ Peta Wilayah Gudang UPT Surabaya** — peta interaktif Leaflet + OpenStreetMap (gratis, tanpa API key). Marker = ikon gudang merah 🏭 (divIcon custom, bukan pin biru default). Klik marker → popup ringkas: nama, alamat, jumlah baris stok, **Total Qty stok tersimpan**, Maturity Level terbaru.
   - Field baru di Master Gudang: `lat`, `lng` (number) — **tapi admin TIDAK isi manual**. Admin cukup isi field **Alamat** dengan format Google Maps Plus Code, cth: `MRR6+9M Wonorejo, Surabaya, East Java`. Koordinat di-decode **otomatis & offline** (tanpa internet/API key) lewat `src/lib/openLocationCode.js` — adaptasi algoritma resmi Google "Open Location Code" (Apache 2.0, source asli diambil dari github.com/google/open-location-code via curl, bukan dikira-kira).
   - `extractLatLngFromAddress(text)` di App.jsx: regex cari pola Plus Code di teks alamat → `recoverNearest()` (pakai titik tengah Surabaya, `SURABAYA_REF_LAT/LNG`, sebagai referensi buat decode kode pendek) → `decode()` → `{lat,lng}`. Dipanggil langsung di `onChange` field Alamat (tidak ada tombol terpisah, tidak ada input lat/lng manual lagi — sudah dihapus sesuai permintaan user).
   - **Perangkap yang sudah diperbaiki**: tab Dashboard di-unmount/mount ulang tiap pindah tab → `<div>` peta jadi node DOM baru tapi `petaWilayahMapRef.current` (instance Leaflet lama) masih nempel ke container lama yang sudah lepas dari DOM → marker tidak muncul lagi setelah pindah tab & balik. Fix: cek `map.getContainer() !== petaWilayahDivRef.current` di awal effect, kalau beda berarti container basi → `.remove()` instance lama, set ref null, baru bikin ulang.
2. **📊 Akurasi Material (SAP vs Aplikasi)** — baseline `sapBaselineQty`/`sapBaselineAt` disimpan otomatis di tiap katalog setiap kali Admin klik "Import dari SAP (PEMAT)". Dibandingkan dengan qty aplikasi saat ini (`totalQtyForKatalog`), toleransi selisih **5%** (item di atas itu masuk daftar "Selisih").
3. **🏆 Maturity Level Gudang** — skala Level 1-5 (`MATURITY_LEVELS`: 1=Basic, 2=Developing, 3=Defined, 4=Managed, 5=Excellent). Admin input manual lewat modal (`maturityModal` + `saveMaturityAssessment()`), riwayat lengkap tersimpan (`maturityAssessments`, storage key `pln_maturity_v1`), Dashboard selalu tampilkan yang terbaru + bisa expand riwayat sebelumnya.

#### 17.8 File/Storage Baru Sesi Ini
- `src/lib/openLocationCode.js` — decoder Plus Code offline (lihat 17.7).
- Storage key baru: `pln_approval_history_v1` (riwayat approval Lokasi/Stok), `pln_maturity_v1` (riwayat asesmen maturity).
- `index.html` — tambah `<link>`+`<script>` CDN Leaflet (`unpkg.com/leaflet@1.9.4`).

#### 17.9 Belum Dikerjakan / Pending dari Sesi Sebelumnya (masih nunggu "lanjutkan")
- **Fitur Foto Material** (foto nameplate + foto keseluruhan di tiap Data Stok, klik card → modal detail). Konsep sudah disetujui user (wajib diisi semua kecuali data lama disinkronkan saat import PEMAT nanti; upload hanya Admin+TL; klik di mana saja pada card untuk buka detail) — **belum mulai implementasi**, sempat ketunda karena ada permintaan tabel horizontal & fitur Dashboard menyusul.
- Backend HP-scan-barcode + shared DB lintas device masih **dipause**, menunggu riset user sendiri (lihat memory `warnoto_backend_decision_pending`).

### 18. Sesi 30 Juni 2026 — Planning Material Cadang & Hidden Reference

#### 18.1 Dokumen Khusus
- File baru: `MATERIAL_CADANG_SPEC.md`.
- File ini menjadi sumber detail untuk implementasi fitur Material Cadang di Claude.
- `WARNOTO_DOCS.md` hanya menyimpan ringkasan dan pointer agar dokumen utama tidak terlalu padat.

#### 18.2 Scope Material Cadang v1
- Fitur khusus untuk `jenisBarang === "Cadang"`.
- Import data Material Cadang menerima CSV/XLSX dengan grain `Material x Equipment Cluster`.
- Template upload awal sudah dibuat: `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx`.
- Sheet utama template: `Import Material Cadang`; sheet pendukung: `Contoh`, `Referensi`, `Petunjuk`.
- CSV tetap didukung selama header sama dengan template XLSX.
- ABC Analysis 5 kelas: `A1`, `A2`, `B1`, `B2`, `C`.
- Inventory policy:
  - `A1` -> Mandatory.
  - `A2` -> split Persediaan/Material Cadang berdasarkan lead time, time to failure, breakdown, emergency.
  - `B1/B2` -> Optimum & Economic.
  - `C` -> Persediaan/rutin, tidak apply sebagai Material Cadang v1.
- Perhitungan:
  - Mandatory = `ceil(2% x populasi)`.
  - Optimum = Poisson reliability-only.
  - Economic = `% history penggantian x populasi`.
  - B1/B2 memakai `max(poissonQty, economicQty)`.

#### 18.3 Approval Asman untuk Apply Min Qty
- Rekomendasi Material Cadang tidak langsung mengubah `minQty`.
- `ADMIN`/`TL` hanya mengajukan apply rekomendasi ke `minQty`.
- `ASMAN` approve/reject pengajuan.
- `minQty` baru berubah setelah approval Asman.
- `MANAGER` hanya melihat dashboard/ringkasan/histori.
- Apply tidak boleh mengubah `qty` stok dan tidak boleh mengubah histori TUG.

#### 18.4 Dashboard Manajemen Material Cadang
- Dashboard harus menampilkan ringkasan Material Cadang untuk manajemen:
  - total item dianalisis;
  - aman;
  - kurang;
  - kosong/critical;
  - total gap qty;
  - estimasi nilai gap.
- Dashboard juga menampilkan distribusi kelas ABC, policy, dan tabel prioritas maksimal 10 item.
- Empty state wajib jelas: "Material Cadang belum dianalisis", jangan tampilkan angka 0 seolah-olah aman.

#### 18.5 Hidden Catalog Master PLN Reference
- File referensi: `CATALOG MASTER.xlsx`.
- Fungsi: hidden cataloger reference, bukan Master Katalog utama.
- Dipakai untuk standar naming cataloger PLN, search global, alias equipment, dan warning pola nama katalog.
- Alias penting:
  - PMT = CB / Circuit Breaker.
  - PMS = DS / Disconnecting Switch.
  - PT/CVT, CT, LA, Cable Joint, Bushing, OLTC dipakai sebagai cluster/equipment penting Material Cadang.
- Tidak boleh auto-rename katalog existing tanpa review user.

#### 18.6 Hidden SAP MARA Reference
- File referensi: `Katalog MARA (01-2026).xlsx`.
- Fungsi: hidden SAP reference, bukan Master Katalog utama.
- Sheet `Sheet1` menjadi sumber utama katalog SAP.
- Sheet `Katalog Unblock` hanya menjadi flag `isUnblocked`, bukan data kedua.
- Sheet `Formula Nama Katalog` menjadi referensi naming.
- Struktur reference disarankan memakai storage key `pln_sap_mara_reference_v1`.
- Jangan auto-import 42 ribu material MARA ke Master Katalog.
- Extend ke Master Data hanya untuk material yang dipilih user.
- Jika MARA berbeda dengan WARNOTO existing, WARNOTO tetap authority operasional; MARA memberi warning/review.

#### 18.7 Instruksi Migrasi ke Claude
- Saat implementasi di Claude, upload:
  - `App.jsx`;
  - `WARNOTO_DOCS.md`;
  - `MATERIAL_CADANG_SPEC.md`;
  - `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx`;
  - `CATALOG MASTER.xlsx`;
  - `Katalog MARA (01-2026).xlsx`;
  - contoh file import Material Cadang/populasi-failure jika sudah tersedia.
- Prompt pembuka dan urutan kerja detail sudah tertulis di `MATERIAL_CADANG_SPEC.md` bagian "Instruksi Saat Update/Migrasi di Claude".

#### 18.8 Catatan Teknis Lintas Sesi
- Selalu cek `preview_console_logs` setelah edit JSX besar — beberapa kali sesi ini kena bug JSX tag tidak seimbang (`</div>` dobel) yang baru kelihatan dari error Babel `[plugin:vite:react-babel] Adjacent JSX elements must be wrapped...`, bukan dari console log HMR yang kadang ambigu (lihat 17.6 & catatan debugging "table tidak muncul" — root cause-nya 1 `</div>` ekstra di baris penutup tabel Data Stok).
- Setelah HMR gagal beberapa kali, kadang perlu **hard reload** (`location.reload()`) + login ulang manual via `preview_eval` (native value setter + dispatch `input`/`change` event, BUKAN cuma set `.value` langsung — React tidak mendeteksi perubahan tanpa native setter + event).
- localStorage browser testing ini **sudah punya data lama** dari sesi-sesi sebelumnya (termasuk Gudang Ketintang tanpa `lat/lng` sebelum fitur Peta Wilayah ada) — kalau fitur baru "kelihatan tidak jalan" di preview, cek dulu apakah memang datanya belum di-migrasi/isi, bukan otomatis berarti bug kode.
### 19. Sesi 30 Juni 2026 — Planning WA AI Agent

#### 19.1 Dokumen Khusus
- File baru: `WA_AI_AGENT_SPEC.md`.
- File ini menjadi sumber detail untuk implementasi integrasi AI Agent WARNOTO ke WhatsApp.
- `WARNOTO_DOCS.md` hanya menyimpan ringkasan dan pointer agar dokumen utama tidak terlalu padat.

#### 19.2 Scope WA AI Agent v1
- Platform resmi: WhatsApp Cloud API.
- Runtime webhook: Supabase Edge Function existing `supabase/functions/whatsapp-webhook/index.ts`.
- WA Agent v1 bersifat read-only.
- Pesan masuk yang didukung v1 hanya teks.
- Command dasar:
  - `help`;
  - `menu`;
  - `status sinkron`.
- WA tidak boleh approve/reject, membuat TUG, mengubah stok, mengubah Master Katalog, mengubah lokasi, mengubah `minQty`, atau apply rekomendasi Material Cadang.

#### 19.3 Akses, Data, dan Audit
- Akses memakai whitelist nomor WhatsApp.
- Semua nomor whitelist mendapat akses baca yang sama; role boleh disimpan untuk audit tetapi tidak menjadi filter jawaban v1.
- Karena Edge Function tidak bisa membaca localStorage/browser state, AI Agent WA membutuhkan server-side state di Supabase.
- Storage awal yang disarankan: `warnoto_state` berbasis JSONB per domain.
- Domain state awal: `stocks`, `katalogList`, `txns`, `rencanaKedatanganList`, `lokasiList`, `approvalHistoryList`, `opnameList`, `stockCountList`, dan `materialCadangAnalysis`.
- RAG/Knowledge Base ditargetkan sync otomatis harian.
- Audit log WA menyimpan metadata + ringkasan, bukan seluruh jawaban panjang secara default.

#### 19.4 Supabase dan Secrets
- Tabel baru yang direncanakan:
  - `warnoto_state`;
  - `wa_allowed_users`;
  - `wa_agent_logs`;
  - `wa_sync_status`.
- Secrets Edge Function:
  - `WHATSAPP_VERIFY_TOKEN`;
  - `WHATSAPP_ACCESS_TOKEN`;
  - `WHATSAPP_PHONE_NUMBER_ID`;
  - `GROQ_API_KEY`;
  - `COHERE_API_KEY`.
- Service role hanya dipakai server-side di Edge Function, tidak diekspos ke frontend.

#### 19.5 Instruksi Migrasi ke Claude
- Saat implementasi di Claude, upload:
  - `App.jsx`;
  - `WARNOTO_DOCS.md`;
  - `README.md`;
  - `WA_AI_AGENT_SPEC.md`;
  - `supabase/schema.sql`;
  - `supabase/functions/whatsapp-webhook/index.ts`;
  - `MATERIAL_CADANG_SPEC.md` jika butuh konteks lintas fitur.
- Prompt pembuka dan urutan kerja detail sudah tertulis di `WA_AI_AGENT_SPEC.md` bagian "Instruksi Implementasi di Claude".

#### 19.6 Status Setup WhatsApp Cloud API
- Meta App sudah dibuat dengan nama `Warnoto BOT`.
- User sudah mendapatkan `Phone Number ID`, `WhatsApp Business Account ID`, `App ID`, dan `App Secret`.
- Form yang sedang disiapkan di Meta: `Configure Webhooks`.
- Isi form Meta:
  - `Callback URL`: `https://tadxodrzoquugnsyejld.supabase.co/functions/v1/whatsapp-webhook`
  - `Verify token`: `warnoto-wa-verify-2026`
- `App ID`, `App Secret`, dan `WhatsApp Business Account ID` tidak diisi di form webhook.
- Cek endpoint terakhir masih `404 Requested function was not found`, artinya Edge Function `whatsapp-webhook` belum terdeploy.
- Lanjutan besok: jalankan `npx supabase login`, `npx supabase link --project-ref tadxodrzoquugnsyejld`, set secrets, deploy `whatsapp-webhook --no-verify-jwt`, lalu baru klik `Verify and save` di Meta.

### 20. Planning Migrasi Data Stok SAP, Non-SAP, dan TUG-15

#### 20.1 Tujuan
- Migrasi data stok dibuat sebagai cutover terkontrol, bukan import bebas.
- File SAP diperlakukan sebagai sumber baku.
- File Non-SAP diperlakukan sebagai data kotor yang harus melalui cleansing dan review.
- Saldo cutover approved menjadi sumber kebenaran utama stok aktif.
- Histori TUG-15 migrasi boleh terlihat di aplikasi, tetapi tidak menjadi transaksi approval aktif.

#### 20.2 Input Migrasi
- Input utama:
  - XLSX `Material Status SAP` dari sistem SAP.
  - XLSX `Material Non-SAP`.
  - XLSX histori/mutasi TUG-15 jika terpisah dari dua file utama.
- File SAP:
  - formatnya baku dari SAP;
  - parser mengikuti kolom SAP seperti `Material`, `Material Description`, `Base Unit of Measure`, `Unrestricted Use Stock`, `Valuation Type`, dan `Harga Satuan` jika tersedia.
- File Non-SAP:
  - tidak boleh langsung masuk Master Katalog aktif;
  - tidak selalu punya No Katalog;
  - nama material bisa tidak standar;
  - perlu cleansing, grouping, dan review Admin + TL.

#### 20.3 Lapisan Data
- Migrasi dibagi menjadi 4 lapisan:
  - `Master Katalog`: referensi material hasil cleaning.
  - `Saldo Cutover`: saldo final per `No Katalog x Lokasi/Blok`.
  - `Histori TUG15`: mutasi historis hasil migrasi.
  - `Arsip Backup`: metadata backup, tanggal cutover, sumber file, dan catatan rekonsiliasi.
- Grain saldo aktif:
  - `Material x Lokasi/Blok`.
- Matching utama:
  - SAP memakai `No Katalog/Material`.
  - Non-SAP memakai hasil mapping review, bukan nama mentah.

#### 20.4 Jalur SAP
- Parse otomatis dari XLSX SAP.
- Normalisasi `Material` dengan trim dan leading zero handling.
- Klasifikasi:
  - 10 digit -> `Cadang`.
  - 7/8 digit + `NORMAL` -> `Persediaan`.
  - 7/8 digit + `BURSA` -> `Persediaan Bursa`.
  - 7/8 digit + `PRE-MEMORY` -> `Pre Memory`.
- Deduplicate saldo per `No Katalog x Lokasi/Blok`.
- Jika nama/satuan/jenis berbeda dari Master Katalog existing, tampilkan warning, bukan langsung overwrite diam-diam.

#### 20.5 Jalur Non-SAP
- Non-SAP masuk staging cleansing, bukan langsung aktif.
- Cleaning awal:
  - uppercase/trim;
  - hapus karakter/noise berulang;
  - normalisasi satuan;
  - pisahkan token material, equipment, spesifikasi, rating, tegangan, ukuran, dan lokasi jika tersedia.
- Grouping kandidat duplikat berdasarkan:
  - `jenisBarang`;
  - nama normalisasi;
  - satuan;
  - spesifikasi utama;
  - lokasi jika diperlukan.
- Cocokkan ke hidden SAP/MARA reference:
  - jika match kuat, tampilkan kandidat No Katalog SAP/MARA.
  - jika tidak match, status `HOLD_NON_SAP`.
- `HOLD_NON_SAP`:
  - tidak masuk `stocks` aktif;
  - tidak masuk Master Katalog aktif;
  - tetap muncul di report review;
  - harus diselesaikan di luar cutover sebelum bisa aktif.

#### 20.6 Master Review Sheet Non-SAP
- Output cleansing Non-SAP wajib berupa Master Review Sheet.
- Kolom minimal:
  - `Nama Asli`;
  - `Nama Standar Usulan`;
  - `Kandidat No Katalog SAP/MARA`;
  - `Status Match`;
  - `Jenis Barang Usulan`;
  - `Satuan Usulan`;
  - `Lokasi/Blok`;
  - `Qty`;
  - `Confidence`;
  - `Warning`;
  - `Keputusan Admin`;
  - `Keputusan TL`;
  - `Catatan Review`.
- Hanya item yang sudah disetujui Admin + TL yang boleh ikut saldo cutover aktif.

#### 20.7 Cutover
- Replace scope:
  - replace `katalogList`;
  - replace `stocks`;
  - kosongkan `txns` test lama;
  - simpan histori migrasi TUG-15 ke state terpisah;
  - lokasi boleh diupdate dari mapping jika ada.
- Master pendukung dipertahankan:
  - gudang;
  - lokasi existing yang tidak konflik;
  - satpam;
  - tim mutu;
  - rencana kedatangan;
  - opname;
  - stock count;
  - maturity;
  - approval history non-migrasi.
- Transaksi baru WARNOTO dimulai dari tanggal cutover fixed.
- `docSeq` diset ke nomor awal transaksi baru setelah cutover.

#### 20.8 Histori TUG-15 Migrasi
- Histori migrasi disimpan di state/storage terpisah:
  - state: `migratedTug15History`;
  - storage key: `pln_migrated_tug15_v1`.
- Histori migrasi tidak dikonversi menjadi `txns`.
- Histori migrasi tidak membuat approval palsu.
- Histori migrasi tidak mengubah qty aktif.
- Menu TUG-15 menampilkan gabungan:
  - sumber `MIGRASI` dari `migratedTug15History`;
  - sumber `WARNOTO` dari transaksi baru `txns`.
- Tabel TUG-15 perlu kolom/badge sumber:
  - `MIGRASI`;
  - `WARNOTO`.
- Histori migrasi belum dipakai forecast/AI sampai Admin menandai valid.

#### 20.9 Preview dan Rekonsiliasi
- Sebelum apply, sistem wajib menampilkan:
  - total baris SAP;
  - total baris Non-SAP;
  - total kandidat approved;
  - total `HOLD_NON_SAP`;
  - total invalid fatal;
  - total warning;
  - total qty aktif hasil cutover;
  - total nilai stok;
  - ringkasan per jenis barang;
  - ringkasan per lokasi/blok;
  - overlap histori dengan tanggal cutover.
- Tombol apply diblokir hanya jika ada invalid fatal.
- Warning boleh lanjut.
- `HOLD_NON_SAP` boleh lanjut, tetapi item HOLD dikeluarkan dari stok aktif.

#### 20.10 Backup Wajib
- Sebelum apply replace, sistem wajib membuat:
  - JSON full backup untuk rollback;
  - XLSX report backup untuk audit manusia.
- JSON full backup harus memuat state aktif sebelum migrasi:
  - `stocks`;
  - `katalogList`;
  - `lokasiList`;
  - `txns`;
  - `docSeq`;
  - `rencanaKedatanganList`;
  - `opnameList`;
  - `stockCountList`;
  - `approvalHistoryList`;
  - `maturityAssessments`;
  - state lain yang sudah ada.
- XLSX report backup harus memuat:
  - summary migrasi;
  - data sebelum;
  - data sesudah;
  - Non-SAP HOLD;
  - warning;
  - invalid;
  - histori migrasi.

#### 20.11 Acceptance Test
- SAP XLSX valid berhasil diparse.
- Non-SAP tidak bisa langsung aktif tanpa review.
- Non-SAP tidak match MARA/SAP masuk `HOLD_NON_SAP`.
- Item `HOLD_NON_SAP` tidak masuk `stocks`.
- Invalid fatal memblokir apply.
- Warning tidak memblokir apply.
- Backup JSON dan XLSX dibuat sebelum replace.
- Setelah cutover, total qty aktif sama dengan saldo approved.
- `txns` test lama kosong.
- TUG-15 menampilkan sumber `MIGRASI` dan `WARNOTO`.
- Histori migrasi tidak mengubah saldo aktif.
- Forecast tidak memakai histori migrasi sebelum validasi.

#### 20.12 Keputusan yang Sudah Dikunci
- Detail rencana migrasi digabung ke `WARNOTO_DOCS.md`, bukan MD baru.
- Saldo cutover approved adalah sumber kebenaran utama.
- Material Non-SAP tanpa match SAP/MARA tidak boleh aktif dan masuk `HOLD_NON_SAP`.
- Admin + TL menjadi pihak review/approval master Non-SAP.
- Histori TUG-15 migrasi adalah histori referensi, bukan transaksi approval aktif.
- Histori TUG-15 migrasi terlihat di menu TUG-15 dengan label sumber `MIGRASI`.
- Histori TUG-15 migrasi belum dipakai forecast sampai divalidasi Admin.

### 21. Paket Handoff ke Claude

#### 21.1 Pintu Masuk
- File handoff utama: `CLAUDE_HANDOFF.md`.
- Saat memulai sesi baru di Claude, baca file tersebut terlebih dahulu, lalu lanjutkan ke `README.md`, `WARNOTO_DOCS.md`, dan spec fitur terkait.

#### 21.2 File yang Perlu Dibawa
- Source utama:
  - `App.jsx`;
  - `README.md`;
  - `WARNOTO_DOCS.md`;
  - `CLAUDE_HANDOFF.md`;
  - `MATERIAL_CADANG_SPEC.md`;
  - `WA_AI_AGENT_SPEC.md`;
  - `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx`;
  - `supabase/schema.sql`;
  - `supabase/functions/whatsapp-webhook/index.ts`.
- Referensi eksternal dari folder `D:\CLAUDE\WARNOTO data\tester`:
  - `CATALOG MASTER.xlsx`;
  - `Katalog MARA (01-2026).xlsx`;
  - `ABC ANALISIS 2020-2022 Signed.pdf`;
  - `Buku Perhitungan Standard Jumlah Mat Cadang Trans.pdf`.

#### 21.3 Status Terakhir
- Material Cadang: planning/spec/template sudah siap, implementasi kode belum dimulai.
- WA AI Agent: planning/spec sudah siap; Meta App sudah dibuat; Supabase Edge Function `whatsapp-webhook` belum deploy.
- Migrasi Stok SAP/Non-SAP + TUG-15: planning final ada di bagian 20; implementasi kode belum dimulai.
- Jangan memasukkan secret asli ke repo; `.env.example` hanya placeholder.
