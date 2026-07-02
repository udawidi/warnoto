# MATERIAL_CADANG_SPEC.md

# Spesifikasi Fitur Material Cadang WARNOTO

Dokumen ini adalah spesifikasi mandiri untuk pengembangan fitur **Material Cadang** di WARNOTO. Tujuannya agar konsep, format import, rumus, dan rencana implementasi bisa dipindahkan ke Claude atau environment lain tanpa harus membaca ulang seluruh `WARNOTO_DOCS.md`.

Status dokumen: draft final-ish hasil diskusi awal. Belum ada implementasi kode.

---

## 1. Latar Belakang

WARNOTO saat ini sudah memiliki manajemen stok, master katalog, TUG, dashboard, stock opname, import SAP PEMAT, dan forecasting stok. Jenis barang `Cadang` sudah ada di sistem sebagai bagian dari `JENIS_BARANG`.

Fitur Material Cadang akan menambahkan modul khusus untuk menentukan jumlah MTU/spare yang ideal berdasarkan:

1. Penggolongan material ke dalam 5 kelas menggunakan ABC Analysis.
2. Penentuan inventory policy berdasarkan kelas dan karakteristik failure.
3. Perhitungan jumlah material cadang menggunakan metode yang sesuai dengan policy.

Fitur ini tidak menggantikan alur TUG atau Data Stok. Modul ini menghasilkan rekomendasi jumlah spare dan dapat mengajukan penerapan hasil rekomendasi ke `minQty` khusus material cadang melalui approval Asman.

---

## 2. Posisi Terhadap WARNOTO Saat Ini

Data dan fitur yang sudah tersedia:

- `jenisBarang === "Cadang"` sudah dikenal oleh aplikasi.
- Import SAP/PEMAT otomatis mengklasifikasikan material 10 digit sebagai `Cadang`.
- Data Stok sudah memiliki `qty`, `price`, dan `minQty`.
- Master Katalog memiliki `katalog`, `name`, `satuan`, dan `jenisBarang`.
- Histori pemakaian stok keluar tersedia dari TUG-8/TUG-9 approved.
- Forecast stok sudah membaca histori TUG keluar, tetapi belum khusus menghitung kebutuhan material cadang berbasis ABC/policy.

Prinsip integrasi:

- Modul Material Cadang hanya memproses material dengan `jenisBarang === "Cadang"`.
- Hasil rekomendasi tidak otomatis mengubah stok fisik.
- Hasil rekomendasi boleh diajukan untuk diterapkan ke `minQty` setelah user memilih aksi apply.
- Semua pengajuan, approval/reject, dan perubahan `minQty` harus tercatat sebagai audit internal modul.

---

## 3. Scope V1

Masuk scope:

- Halaman/menu baru **Material Cadang**.
- Import file populasi/failure dalam format CSV/XLSX.
- Matching data import ke Master Katalog berdasarkan `No Katalog`.
- ABC Analysis 5 kelas: `A1`, `A2`, `B1`, `B2`, `C`.
- Inventory policy: `Mandatory`, `Optimum`, `Optimum & Economic`, dan `Persediaan` untuk item yang tidak diperlakukan sebagai material cadang.
- Calculation model:
  - Mandatory: `ceil(2% x Populasi Cluster)`.
  - Optimum: Poisson reliability-only.
  - Economic: `% history penggantian x populasi`.
  - B1/B2: rekomendasi final memakai nilai terbesar dari Poisson dan Economic.
- Rekomendasi jumlah ideal, gap terhadap stok saat ini, dan status kecukupan.
- Pengajuan apply rekomendasi ke `minQty` khusus material cadang dengan approval Asman.

Tidak masuk scope v1:

- Optimasi biaya penuh pada model Poisson.
- Integrasi langsung ke SAP.
- Pembuatan otomatis rencana pengadaan.
- Perhitungan lokasi penyimpanan spare berbasis EFC/ENS.
- Machine learning tambahan.

---

## 4. Format Import File

Template import memakai **1 sheet panjang**.

Grain data:

> 1 baris = 1 Material x Equipment Cluster

Artinya satu nomor katalog boleh muncul beberapa kali jika material yang sama dipakai pada beberapa cluster/peralatan berbeda.

### 4.1 Kolom Wajib

| Kolom | Tipe | Keterangan |
| --- | --- | --- |
| `No Katalog` | text | Primary key matching ke `katalog.katalog`. Leading zero boleh, sistem normalize. |
| `Nama Material` | text | Validasi nama. Jika berbeda dari Master Katalog, tetap match tapi diberi warning. |
| `Equipment Cluster` | text | Contoh: IBT, Trafo Tenaga, PMT, CT, LA, Bushing, OLTC, Relay Proteksi. |
| `Populasi Cluster` | number | Jumlah aset sejenis pada cluster tersebut. Wajib > 0. |
| `Failure 5 Tahun` | number | Jumlah gangguan/kegagalan yang menyebabkan kebutuhan spare dalam 5 tahun terakhir. |
| `Penggantian 5 Tahun` | number | Jumlah penggantian material akibat failure/breakdown dalam 5 tahun terakhir. |
| `Emergency Replacement 5 Tahun` | number | Jumlah penggantian emergency dalam 5 tahun terakhir. |
| `Lead Time Hari` | number | Lead time pengadaan/penyediaan material. Wajib > 0. |
| `Time To Failure Hari` | number | Estimasi waktu menuju failure. Dipakai untuk split A2. Wajib > 0. |
| `Breakdown` | text | Isi `YA` atau `TIDAK`. Case-insensitive. |
| `Harga Satuan` | number | Opsional secara bisnis, tetapi kolom tetap ada. Jika kosong, pakai harga dari Data Stok. |

### 4.2 Kolom Opsional

| Kolom | Tipe | Keterangan |
| --- | --- | --- |
| `Lokasi/Gardu` | text | Catatan lokasi aset. Belum menjadi grain utama v1. |
| `Tegangan` | text | Contoh: 20kV, 70kV, 150kV, 500kV. |
| `Spesifikasi` | text | Catatan spesifikasi unik. Berguna untuk A1. |
| `Catatan` | text | Catatan bebas untuk reviewer. |

### 4.3 Contoh CSV

```csv
No Katalog,Nama Material,Equipment Cluster,Populasi Cluster,Failure 5 Tahun,Penggantian 5 Tahun,Emergency Replacement 5 Tahun,Lead Time Hari,Time To Failure Hari,Breakdown,Harga Satuan,Lokasi/Gardu,Tegangan,Spesifikasi,Catatan
0000001234567890,BUSHING 150KV,Trafo Tenaga,24,3,2,1,180,120,YA,205000000,GI Ketintang,150kV,Unique asset A1,Data awal
0000001234567891,OLTC MOTOR DRIVE,OLTC,18,1,1,0,210,365,TIDAK,85000000,GI Waru,150kV,,Sample
```

### 4.4 Template XLSX Siap Upload

Template kerja awal sudah dibuat di root project:

```text
TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx
```

Template ini dipakai sebagai format resmi v1 untuk upload data Material Cadang. CSV tetap didukung, tetapi struktur header harus sama persis dengan sheet utama template XLSX.

Isi workbook:

| Sheet | Fungsi |
| --- | --- |
| `Import Material Cadang` | Sheet utama yang dibaca sistem saat upload. |
| `Contoh` | Contoh pengisian 3 baris untuk membantu user memahami grain data. |
| `Referensi` | Daftar referensi `Equipment Cluster` dan nilai dropdown `Breakdown`. |
| `Petunjuk` | Ringkasan aturan upload, matching, validasi, dan approval Asman. |

Aturan sheet `Import Material Cadang`:

- Header berada pada baris ke-3.
- Nama header harus sama dengan daftar kolom pada bagian 4.1 dan 4.2.
- Setiap baris mewakili `1 Material x Equipment Cluster`.
- `No Katalog` menjadi primary key matching ke Master Katalog WARNOTO.
- `Nama Material` hanya dipakai sebagai validasi/warning jika berbeda dengan Master Katalog.
- `Equipment Cluster` memakai dropdown referensi, tetapi importer tetap perlu menerima teks manual sepanjang masih dapat dinormalisasi.
- `Breakdown` memakai dropdown `YA/TIDAK`.
- Kolom numerik diberi validasi angka pada template, tetapi parser tetap harus melakukan validasi ulang saat upload.

Daftar awal `Equipment Cluster` pada template:

```text
PMT/CB, PMS/DS, PT/CVT, CT, LA, Cable Joint, Bushing, OLTC,
IBT, Trafo Tenaga, Trafo Distribusi, Relay Proteksi, Sealing End,
Kapasitor, Reaktor, GIS, Panel, Battery, Charger, Isolator,
Konduktor, Clamp, Universal Acc.
```

Catatan alias cluster:

- `PMT/CB` dinormalisasi sebagai `CB`.
- `PMS/DS` dinormalisasi sebagai `DS`.
- `PT/CVT`, `CT`, `LA`, `Cable Joint`, `Bushing`, dan `OLTC` dipertahankan sebagai cluster penting Material Cadang.
- Cluster lain mengikuti kebutuhan katalog WARNOTO dan referensi cataloger PLN.

---

## 5. Aturan Matching dan Validasi Import

### 5.1 Normalisasi

- `No Katalog` di-trim dan leading zero dihapus.
- `Nama Material` di-trim dan dibandingkan case-insensitive.
- `Breakdown` menerima `YA`, `Y`, `YES`, `TRUE`, `1` sebagai true.
- `Breakdown` menerima `TIDAK`, `N`, `NO`, `FALSE`, `0` sebagai false.
- Angka kosong dianggap `0`, kecuali kolom yang wajib > 0.

### 5.2 Matching

- Primary key: `No Katalog`.
- Jika `No Katalog` cocok dengan Master Katalog, baris dianggap match.
- Jika `Nama Material` berbeda dari Master Katalog, status baris menjadi `WARNING_NAME_DIFF`, tetapi tetap boleh dihitung.
- Jika `No Katalog` tidak ditemukan, status baris menjadi `UNMATCHED` dan tidak ikut perhitungan.
- Jika kolom wajib tidak valid, status baris menjadi `INVALID` dan tidak ikut perhitungan.

### 5.3 Duplikat

Duplikat ditentukan dari kombinasi:

```text
No Katalog + Equipment Cluster
```

Jika duplikat ditemukan, sistem menggabungkan baris dengan aturan:

- `Populasi Cluster`: pakai nilai terbesar.
- `Failure 5 Tahun`: dijumlah.
- `Penggantian 5 Tahun`: dijumlah.
- `Emergency Replacement 5 Tahun`: dijumlah.
- `Lead Time Hari`: pakai nilai terbesar.
- `Time To Failure Hari`: pakai nilai terbesar.
- `Harga Satuan`: pakai nilai import jika ada; jika beberapa nilai berbeda, pakai nilai terbesar dan beri warning.
- Baris hasil gabungan diberi warning `DUPLICATE_MERGED`.

### 5.4 Preview Import

Setelah upload, WARNOTO harus menampilkan:

- Total baris file.
- Jumlah `MATCH`.
- Jumlah `WARNING`.
- Jumlah `UNMATCHED`.
- Jumlah `INVALID`.
- Jumlah duplikat yang digabung.
- Preview tabel dengan status per baris.

Baris yang boleh lanjut hitung:

- `MATCH`
- `WARNING_NAME_DIFF`
- `DUPLICATE_MERGED`

Baris yang tidak boleh lanjut hitung:

- `UNMATCHED`
- `INVALID`

---

## 6. ABC Analysis

### 6.1 Nilai Urut

Nilai utama untuk mengurutkan ABC:

```text
riskUsageValue = hargaSatuan x failureAtauPenggantian
```

Default `failureAtauPenggantian`:

```text
max(Failure 5 Tahun, Penggantian 5 Tahun)
```

Jika keduanya 0, nilai risiko menjadi 0.

Jika `Harga Satuan` di file kosong, gunakan harga dari Data Stok. Jika Data Stok juga kosong, harga dianggap 0 dan diberi warning.

### 6.2 Kumulatif

Untuk setiap material hasil agregasi per katalog:

```text
usageValuePct = riskUsageValue / totalRiskUsageValue
cumulativeUsageValuePct = running total usageValuePct setelah sort desc
cumulativeItemPct = urutanItem / totalItem
```

### 6.3 Kelas

Kelas default:

| Class | Cumulative % usage value | Cumulative % item | Perlakuan |
| --- | --- | --- | --- |
| `A1` | sampai >50% | <= 3% | Material Cadang, Mandatory |
| `A2` | sekitar +/-25% berikutnya | sekitar +/-7% berikutnya | Split Cadang/Persediaan berdasarkan kondisi |
| `B1` | sampai sekitar 95% | sekitar +/-10% berikutnya | Material Cadang |
| `B2` | sisa critical sebelum C | sekitar +/-15% berikutnya | Material Cadang |
| `C` | nilai rendah/rutin | sisa item | Persediaan/rutin |

Catatan implementasi:

- Threshold v1 dibuat sebagai parameter default, bukan hardcoded tersembunyi.
- User tidak perlu memilih kelas manual pada v1.
- Override manual bisa menjadi fase lanjutan jika diperlukan.

---

## 7. Inventory Policy

### 7.1 Mapping Dasar

| Class | Policy | Model |
| --- | --- | --- |
| `A1` | `Mandatory` | Max 2% x Populasi |
| `A2` | `Optimum` atau `Persediaan` | Poisson jika masuk Material Cadang |
| `B1` | `Optimum & Economic` | Poisson dan Economic |
| `B2` | `Optimum & Economic` | Poisson dan Economic |
| `C` | `Persediaan` | Tidak dihitung sebagai Material Cadang v1 |

### 7.2 Split A2

A2 menjadi `Persediaan` jika:

```text
Time To Failure Hari >= Lead Time Hari
AND Breakdown == false
AND Emergency Replacement 5 Tahun == 0
```

A2 menjadi `Material Cadang` dengan policy `Optimum` jika salah satu kondisi berikut benar:

```text
Time To Failure Hari < Lead Time Hari
OR Breakdown == true
OR Emergency Replacement 5 Tahun > 0
```

---

## 8. Calculation Model

### 8.1 Mandatory

Dipakai untuk `A1`.

```text
mandatoryQty = ceil(Populasi Cluster x 0.02)
```

Aturan rounding:

- Jika hasil > 0, minimal 1.
- Jika populasi 0 atau invalid, item tidak dihitung.

### 8.2 Optimum - Poisson Reliability-Only

Dipakai untuk `A2` yang masuk Material Cadang, dan sebagai salah satu model untuk `B1/B2`.

V1 hanya menghitung dari reliability/availability. Optimasi biaya belum dihitung.

Input:

- `Failure 5 Tahun`
- `Populasi Cluster`
- `Lead Time Hari`
- periode histori default 5 tahun
- `serviceLevel`

Default service level:

| Policy/Class | Service Level |
| --- | --- |
| `A1/Mandatory` | 99% |
| `A2/Optimum` | 95% |
| `B1/B2` | 90% |

Failure rate per hari:

```text
failureRatePerDay = Failure 5 Tahun / (5 x 365)
```

Expected demand selama restocking:

```text
lambda = failureRatePerDay x Lead Time Hari
```

Poisson CDF:

```text
P(X <= s) = sum(k=0..s) (e^-lambda x lambda^k / k!)
```

Jumlah optimum:

```text
poissonQty = angka s terkecil saat P(X <= s) >= serviceLevel
```

Rounding:

- `poissonQty` sudah bilangan bulat.
- Jika lambda > 0 dan hasil 0, tetap boleh 0 hanya jika service level tercapai.
- Untuk rekomendasi final Material Cadang, jika kebutuhan > 0 maka minimal 1.

### 8.3 Economic

Dipakai untuk `B1/B2` dan situasi data Optimum belum cukup kuat.

Rumus:

```text
historyReplacementRate = Penggantian 5 Tahun / Populasi Cluster
economicQty = ceil(historyReplacementRate x Populasi Cluster)
```

Secara matematis v1 ini setara dengan `ceil(Penggantian 5 Tahun)`, tetapi tetap ditulis dalam bentuk rate x populasi agar mengikuti konsep `% history penggantian x populasi` dan siap jika populasi referensi berbeda dari populasi saat ini pada fase berikutnya.

### 8.4 Rekomendasi Final

| Policy | Final Recommended Qty |
| --- | --- |
| `Mandatory` | `mandatoryQty` |
| `Optimum` | `poissonQty` |
| `Optimum & Economic` | `max(poissonQty, economicQty)` |
| `Persediaan` | Tidak apply sebagai Material Cadang |

Semua hasil final memakai aturan:

```text
finalQty = ceil(finalQty)
if finalQty > 0 then minimum 1
```

---

## 9. Hidden Catalog Master PLN Reference

WARNOTO dapat menyimpan `CATALOG MASTER.xlsx` sebagai **hidden cataloger reference**. Referensi ini berisi standar cataloger PLN untuk pola penamaan, terminologi/singkatan, dan klasifikasi material. Data ini bukan daftar stok operasional dan tidak boleh memenuhi Master Katalog.

Tujuan referensi Catalog Master:

- Menjadi kamus standar penamaan material PLN.
- Memperkuat search global Data Stok/Master Katalog.
- Menormalisasi alias equipment dan istilah operasional.
- Memberi warning jika nama katalog existing tidak sesuai pola cataloger PLN.
- Membantu modul Material Cadang mengenali equipment cluster dan alias seperti PMT/CB atau PMS/DS.

### 9.1 Sumber Sheet

Workbook `CATALOG MASTER.xlsx` memiliki sheet utama:

| Sheet | Fungsi |
| --- | --- |
| `PLN-Naming Convention` | Pola penulisan deskripsi material dan contoh. |
| `PLN-Terminology` | Kamus singkatan/istilah, termasuk alias English/Indonesia. |
| `PLN-Material Classification` | Klasifikasi item name, char schema, dan contoh deskripsi. |
| `PLN-Naming Convention Example` | Contoh pola naming; dapat dipakai sebagai referensi audit. |

### 9.2 Struktur Hidden Reference

Storage key yang disarankan:

```text
pln_catalog_master_reference_v1
```

Struktur ringkas:

```js
{
  namingConventions: [
    {
      itemName: "CB",
      pattern: "ITEM NAME;JENIS;TEG;ARUS;BREAKING CAP;JENIS MEKANIK;MODE OPR;MEDIA",
      sample: "CB;K;150KV;3150A;50KA;HYD-SPRING;3P;SF6"
    }
  ],
  terminology: [
    {
      abbreviation: "CB",
      description: "Circuit Breaker",
      localAbbreviation: "PMT",
      localDescription: "Pemutus Tenaga"
    }
  ],
  materialClassifications: [
    {
      itemName: "CB",
      charSchema: ["ITEM NAME", "JENIS", "TEG", "ARUS", "BREAKING CAP", "JENIS MEKANIK", "MODE OPR", "MEDIA"],
      examples: []
    }
  ],
  aliases: {
    "PMT": "CB",
    "PMS": "DS",
    "CIRCUIT BREAKER": "CB",
    "DISCONNECTING SWITCH": "DS"
  }
}
```

### 9.3 Authority dan Conflict

- Catalog Master PLN menjadi standar penamaan/cataloger.
- WARNOTO tetap tidak auto-rename data existing tanpa review.
- Jika nama katalog WARNOTO berbeda dari pola Catalog Master, tampilkan warning/review.
- Untuk search global, alias dari Catalog Master boleh langsung dipakai agar query `PMT` menemukan `CB` dan query `PMS` menemukan `DS`.

### 9.4 Alias Equipment Awal

Alias yang sudah dikunci:

| Istilah Operasional | Standar Catalog Master |
| --- | --- |
| `PMT` | `CB` / Circuit Breaker |
| `PMS` | `DS` / Disconnecting Switch |
| `PT/CVT` | `PT` atau `CVT` sesuai deskripsi katalog |
| `CT` | `CT` |
| `LA` | `LA` |
| `Cable Joint` | `JOINT` / `CABLE PWR ACC` sesuai katalog |
| `Bushing` | umumnya `TRF ACC;BUSHING...` atau deskripsi bushing terkait |
| `OLTC` | umumnya `TRF ACC;OLTC...` |

Sisanya mengikuti nama/prefix katalog WARNOTO dan Catalog Master.

---

## 10. Hidden SAP MARA Reference

WARNOTO dapat menyimpan data `Katalog MARA (01-2026).xlsx` sebagai **Hidden SAP Reference**. Referensi ini adalah katalog SAP resmi yang sudah terdaftar, tetapi tidak boleh otomatis memenuhi Master Katalog WARNOTO karena jumlahnya sangat besar dan tidak semua material dipakai di gudang.

Tujuan referensi MARA:

- Lookup katalog SAP saat user ingin extend Master Data Material.
- Validasi apakah nomor katalog/material adalah SAP resmi.
- Cek material `ZCAD`/material cadang.
- Cek apakah katalog termasuk `Katalog Unblock`.
- Membantu pencarian material cadang yang belum ada di WARNOTO.

### 10.1 Sumber Sheet

Workbook MARA memiliki 3 sheet utama:

| Sheet | Fungsi |
| --- | --- |
| `Sheet1` | Sumber utama katalog SAP. Berdasarkan inspeksi awal berisi sekitar 42.703 material unik. |
| `Katalog Unblock` | Subset dari `Sheet1`; tidak disimpan sebagai data kedua, hanya menjadi flag `isUnblocked`. |
| `Formula Nama Katalog` | Referensi naming/pola deskripsi; bukan daftar material operasional. |

### 10.2 Struktur Hidden Reference

Storage key yang disarankan:

```text
pln_sap_mara_reference_v1
```

Struktur per material:

```js
{
  materialRaw: "000000001020001",
  katalog: "1020001",
  materialType: "ZST1",
  materialGroup: "ZM0102",
  satuan: "U",
  status: "01",
  description: "TRF PWR;K;150/20kV;3P;60MVA;YnYno;OD",
  prefix: "TRF PWR",
  isCadang: false,
  isUnblocked: false,
  sourceFile: "Katalog MARA (01-2026).xlsx",
  sourceSheet: "Sheet1"
}
```

Field mapping dari workbook:

| Field Reference | Kolom MARA |
| --- | --- |
| `materialRaw` | `Material` |
| `katalog` | `Material` setelah trim dan hapus leading zero |
| `materialType` | `Material Type` |
| `materialGroup` | `Material Group` |
| `satuan` | `Base Unit of Measure` |
| `status` | `X-plant matl status` |
| `description` | `Material Description` |
| `prefix` | token pertama `Material Description` sebelum `;` |

### 10.3 Aturan Normalisasi

- `Material` dinormalisasi dengan trim dan hapus leading zero.
- `isCadang = true` jika:
  - `materialType === "ZCAD"`, atau
  - nomor material normalisasi berjumlah 10 digit.
- `isUnblocked = true` jika nomor material normalisasi muncul di sheet `Katalog Unblock`.
- Jika material muncul di `Katalog Unblock`, data utama tetap mengambil metadata dari `Sheet1`.
- Jika ada duplikat nomor material normalisasi di `Sheet1`, simpan satu baris pertama dan beri warning saat import reference.

### 10.4 Behavior Extend ke Master Data

Referensi MARA tidak otomatis menambah 42 ribu material ke Master Katalog.

Alur extend:

1. User mencari material dari hidden MARA reference.
2. User memilih material yang akan ditambahkan.
3. Sistem menampilkan preview:
   - nomor katalog;
   - deskripsi MARA;
   - satuan;
   - material type;
   - material group;
   - status unblock;
   - apakah sudah ada di Master Katalog WARNOTO.
4. Jika belum ada di WARNOTO, user boleh membuat Master Katalog baru dari material terpilih.
5. Jika sudah ada di WARNOTO, sistem menampilkan perbandingan WARNOTO vs MARA dan tidak overwrite otomatis.

Authority:

- Untuk operasional aplikasi, Master Katalog WARNOTO tetap authority utama.
- MARA adalah referensi SAP resmi, tetapi perbedaan dengan WARNOTO hanya menjadi warning/review.
- Tidak ada auto-rename, auto-update satuan, atau auto-update jenis barang tanpa aksi user.

### 10.5 Hubungan dengan Material Cadang

MARA membantu modul Material Cadang untuk:

- memastikan nomor katalog import populasi/failure adalah katalog SAP valid;
- menandai material `ZCAD` sebagai kandidat Material Cadang;
- memberi status `SAP Registered` dan `Unblocked`;
- memberi warning jika material cadang pada data import belum ada di Master Katalog WARNOTO tetapi ada di MARA.

Status matching tambahan pada import Material Cadang:

| Status | Arti |
| --- | --- |
| `MATCH_WARNOTO` | No katalog ada di Master Katalog WARNOTO. |
| `MATCH_MARA_ONLY` | No katalog tidak ada di WARNOTO, tetapi ada di hidden MARA reference. |
| `MATCH_BOTH` | No katalog ada di WARNOTO dan MARA. |
| `UNREGISTERED_SAP` | No katalog tidak ada di WARNOTO maupun MARA. |

Baris `MATCH_MARA_ONLY` boleh ditampilkan sebagai kandidat extend, tetapi tidak otomatis masuk perhitungan sampai user memutuskan apakah material tersebut akan dibuat di Master Katalog atau hanya disimpan sebagai referensi analisis.

---

## 11. Struktur Data yang Disarankan

Storage key baru:

```text
pln_material_cadang_v1
```

Contoh bentuk data:

```js
{
  imports: [
    {
      id: "MCIMP-...",
      fileName: "material_cadang_2026.xlsx",
      importedBy: "user-id",
      importedAt: 1750000000000,
      rowCount: 120,
      matchedCount: 110,
      warningCount: 8,
      unmatchedCount: 5,
      invalidCount: 5,
      rows: []
    }
  ],
  analyses: [
    {
      id: "MCANA-...",
      importId: "MCIMP-...",
      periodYears: 5,
      serviceLevels: { mandatory: 0.99, optimum: 0.95, economic: 0.90 },
      thresholds: { a1ValuePct: 50, a1ItemPct: 3, a2ValuePct: 75, a2ItemPct: 10, bValuePct: 95 },
      createdBy: "user-id",
      createdAt: 1750000000000,
      results: []
    }
  ],
  applyHistory: [
    {
      id: "MCAPPLY-...",
      analysisId: "MCANA-...",
      katalogId: "KAT-...",
      status: "APPROVED_APPLIED",
      oldMinQty: 0,
      newMinQty: 2,
      requestedBy: "user-id",
      requestedAt: 1750000000000,
      decidedBy: "asman-user-id",
      decidedAt: 1750000000000,
      appliedAt: 1750000000000,
      rejectReason: ""
    }
  ]
}
```

Contoh result per katalog:

```js
{
  katalogId: "KAT-1234567890",
  katalog: "1234567890",
  name: "BUSHING 150KV",
  satuan: "BH",
  equipmentCluster: "Trafo Tenaga",
  population: 24,
  failure5y: 3,
  replacement5y: 2,
  emergencyReplacement5y: 1,
  leadTimeDays: 180,
  timeToFailureDays: 120,
  breakdown: true,
  price: 205000000,
  riskUsageValue: 615000000,
  cumulativeUsageValuePct: 42.5,
  cumulativeItemPct: 2.1,
  abcClass: "A1",
  materialTreatment: "Material Cadang",
  inventoryPolicy: "Mandatory",
  model: "2% Populasi",
  mandatoryQty: 1,
  poissonQty: null,
  economicQty: null,
  recommendedQty: 1,
  currentQty: 0,
  gapQty: 1,
  canRequestApplyToMinQty: true,
  warnings: []
}
```

---

## 12. Approval Apply ke Min Qty

Apply rekomendasi ke `minQty` tidak dilakukan langsung oleh pembuat analisis. Perubahan `minQty` harus melalui approval Asman agar rekomendasi Material Cadang tetap terkontrol dan sensitif terhadap keputusan manajemen.

Tombol ajukan apply hanya berlaku untuk result dengan:

```text
materialTreatment == "Material Cadang"
recommendedQty > 0
```

Role yang boleh mengajukan apply:

- `ADMIN`
- `TL`

Role yang boleh approve/reject apply:

- `ASMAN`

Role yang boleh melihat:

- `ADMIN`
- `TL`
- `ASMAN`
- `MANAGER`

Alur apply:

1. `ADMIN`/`TL` memilih rekomendasi Material Cadang yang akan diterapkan ke `minQty`.
2. Sistem membuat pengajuan apply dengan status `PENDING_ASMAN`.
3. `ASMAN` melihat pengajuan di menu Approval atau modul Material Cadang.
4. Jika `ASMAN` approve, sistem baru mengubah `minQty`.
5. Jika `ASMAN` reject, `minQty` tidak berubah dan alasan reject disimpan.

Aturan perubahan saat approve:

- Rekomendasi dihitung per katalog, bukan per lokasi.
- Jika satu katalog punya beberapa baris stok/lokasi:
  - Cari baris stok utama dengan qty terbesar.
  - Set `minQty` baris utama = `recommendedQty`.
  - Set `minQty` baris lain untuk katalog yang sama = `0`.
  - Tujuannya agar alert stok kritis tidak dobel di beberapa lokasi.
- Catat pengajuan, approval/reject, dan perubahan final ke `applyHistory`.

Contoh status pengajuan:

```text
DRAFT_SELECTED
PENDING_ASMAN
APPROVED_APPLIED
REJECTED
```

Catatan risiko:

- Dashboard saat ini sebagian masih membaca `minQty` per row stok. Untuk hasil terbaik, bagian alert Material Cadang sebaiknya membandingkan total qty agregat per katalog dengan recommended/minQty katalog.

---

## 13. Dashboard Manajemen Material Cadang

Fitur Material Cadang harus tampil juga di Dashboard agar informatif untuk manajemen. Dashboard tidak dipakai untuk input data detail; dashboard berfungsi sebagai ringkasan status, risiko, dan kebutuhan tindak lanjut.

### 13.1 Posisi di Dashboard

Tambahkan section **Material Cadang** di Dashboard utama, idealnya setelah KPI saldo inventory dan sebelum widget analitik material umum.

Tampil untuk role:

- `ADMIN`
- `TL`
- `ASMAN`
- `MANAGER`

Untuk role manajemen (`ASMAN`, `MANAGER`), section ini harus bersifat ringkas, scan-friendly, dan menonjolkan kondisi status, bukan detail teknis rumus.

### 13.2 KPI Card

KPI minimal:

| KPI | Definisi |
| --- | --- |
| `Total Item Cadang Dianalisis` | Jumlah katalog Material Cadang yang sudah masuk hasil analisis terakhir. |
| `Siap / Aman` | Jumlah item dengan `currentQty >= recommendedQty`. |
| `Kurang` | Jumlah item dengan `currentQty < recommendedQty` dan `currentQty > 0`. |
| `Kosong / Critical` | Jumlah item dengan `recommendedQty > 0` dan `currentQty == 0`. |
| `Gap Qty` | Total `max(0, recommendedQty - currentQty)`. |
| `Estimasi Nilai Gap` | Total `gapQty x price`. |

Status warna:

- `Aman`: hijau.
- `Kurang`: kuning/oranye.
- `Critical/Kosong`: merah.
- `Belum Dianalisis`: abu-abu.

### 13.3 Distribusi Status

Dashboard menampilkan ringkasan distribusi:

- Distribusi kelas ABC: `A1`, `A2`, `B1`, `B2`, `C`.
- Distribusi policy: `Mandatory`, `Optimum`, `Optimum & Economic`, `Persediaan`.
- Distribusi kondisi stok:
  - `Aman`
  - `Kurang`
  - `Kosong/Critical`
  - `Belum Apply ke Min Qty`

Visual yang disarankan:

- Card kecil per status.
- Bar horizontal/stacked untuk komposisi kelas.
- Tabel top priority untuk tindakan manajemen.

### 13.4 Tabel Prioritas Manajemen

Dashboard harus memiliki tabel ringkas **Prioritas Material Cadang** berisi maksimal 10 item teratas.

Urutan prioritas:

1. `gapQty` terbesar pada kelas `A1`.
2. `gapQty` terbesar pada kelas `A2`.
3. Status `Kosong/Critical`.
4. Nilai gap terbesar (`gapQty x price`).
5. `Emergency Replacement 5 Tahun` terbesar.

Kolom tabel:

| Kolom | Keterangan |
| --- | --- |
| `No Katalog` | Nomor katalog material. |
| `Nama Material` | Nama dari Master Katalog. |
| `Class` | A1/A2/B1/B2/C. |
| `Policy` | Mandatory/Optimum/Optimum & Economic/Persediaan. |
| `Stok` | Total stok saat ini per katalog. |
| `Ideal` | `recommendedQty`. |
| `Gap` | Kekurangan terhadap ideal. |
| `Status` | Aman/Kurang/Kosong/Belum Dianalisis. |
| `Nilai Gap` | `gapQty x price`. |

Klik baris membuka detail Material Cadang di modul utama, bukan modal panjang di dashboard.

### 13.5 Status Per Material

Status per material ditentukan dari hasil analisis terakhir:

```text
if no latestAnalysis result:
  status = "Belum Dianalisis"
else if materialTreatment != "Material Cadang":
  status = "Persediaan/Rutin"
else if recommendedQty <= 0:
  status = "Tidak Ada Kebutuhan"
else if currentQty == 0:
  status = "Kosong/Critical"
else if currentQty < recommendedQty:
  status = "Kurang"
else:
  status = "Aman"
```

Status `Belum Apply ke Min Qty` bersifat tambahan:

```text
belumApply = recommendedQty > 0 && appliedMinQtyForKatalog != recommendedQty
```

Ini penting untuk manajemen karena hasil analisis bisa sudah ada tetapi belum dijadikan alert operasional.

### 13.6 CTA Dashboard

CTA yang disarankan:

- `Lihat Detail Material Cadang` -> buka menu Material Cadang.
- `Review Gap` -> buka Material Cadang dengan filter status `Kurang/Kosong`.
- `Ajukan Apply Min Qty` hanya muncul untuk `ADMIN`/`TL`, dan tetap diarahkan ke modul utama agar user melihat detail sebelum pengajuan.

### 13.7 Empty State

Jika belum ada analisis Material Cadang:

- Tampilkan card informasi: `Material Cadang belum dianalisis`.
- CTA: `Upload Data Populasi/Failure`.
- Jangan tampilkan angka 0 seolah-olah kondisi aman.

---

## 14. Rencana UI Modul Material Cadang

Menu baru:

```text
Material Cadang
```

Layout halaman:

1. Header + ringkasan status data.
2. Panel upload/import:
   - upload CSV/XLSX;
   - download template kosong;
   - template awal: `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx`;
   - preview hasil parsing.
3. Panel validasi:
   - matched;
   - warning;
   - unmatched;
   - invalid.
4. Panel parameter:
   - periode histori default 5 tahun;
   - service level default;
   - threshold ABC default.
5. Tombol `Hitung Rekomendasi`.
6. Dashboard ringkas hasil:
   - count A1/A2/B1/B2/C;
   - total recommended qty;
   - total gap;
   - nilai estimasi kebutuhan.
7. Tabel hasil:
   - no katalog;
   - nama;
   - equipment cluster;
   - class;
   - policy;
   - model;
   - populasi;
   - failure;
   - stok saat ini;
   - recommended qty;
   - gap;
   - status;
   - aksi apply.
8. Detail drawer/modal per material:
   - alasan kelas;
   - breakdown rumus;
   - warning data;
   - audit apply.

---

## 15. Acceptance Test

### Import

- Upload file valid CSV dan XLSX berhasil.
- Download template menghasilkan format setara `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx`.
- Sheet `Import Material Cadang` dengan header baris ke-3 dapat dibaca.
- CSV dengan header yang sama seperti template XLSX dapat dibaca.
- Header salah menampilkan error jelas.
- No katalog dengan leading zero tetap match.
- Nama material berbeda menghasilkan warning, bukan blokir.
- No katalog tidak ditemukan masuk `UNMATCHED`.
- Populasi/lead time/TTF kosong atau 0 masuk `INVALID`.
- Duplikat `No Katalog + Equipment Cluster` digabung sesuai aturan.
- `Breakdown` dari dropdown `YA/TIDAK` dan variasi teks normalisasi tetap terbaca benar.

### Hidden SAP MARA Reference

- `Sheet1` menjadi sumber utama hidden reference.
- `Katalog Unblock` hanya memberi flag `isUnblocked`, bukan membuat data material duplikat.
- Nomor material dengan leading zero dinormalisasi benar.
- `ZCAD` atau nomor normalisasi 10 digit terdeteksi sebagai kandidat Material Cadang.
- Search referensi MARA tidak menambah item ke Master Katalog.
- Extend ke Master Katalog hanya menambah material yang dipilih user.
- Jika nomor katalog sudah ada di WARNOTO, sistem menampilkan perbandingan WARNOTO vs MARA dan tidak overwrite.
- `MATCH_MARA_ONLY` muncul sebagai kandidat extend, bukan otomatis ikut perhitungan.

### Hidden Catalog Master PLN Reference

- `CATALOG MASTER.xlsx` diparse sebagai hidden reference, bukan Master Katalog.
- Query `PMT` dapat menemukan material standar `CB`.
- Query `PMS` dapat menemukan material standar `DS`.
- Pola naming dari Catalog Master dapat memberi warning pada nama katalog WARNOTO yang tidak sesuai.
- Tidak ada auto-rename katalog existing tanpa review user.

### ABC dan Policy

- Hasil sort ABC mengikuti `riskUsageValue` descending.
- Cumulative value dan cumulative item dihitung benar.
- Kelas A1/A2/B1/B2/C muncul di tabel.
- A2 dengan `TTF >= Lead Time`, tidak breakdown, dan emergency 0 menjadi `Persediaan`.
- A2 dengan breakdown/emergency/TTF < lead time menjadi Material Cadang policy `Optimum`.
- C tidak bisa di-apply sebagai Material Cadang.

### Calculation

- A1 menghasilkan `ceil(2% x populasi)`.
- Poisson menghasilkan qty terkecil yang memenuhi service level.
- B1/B2 final memakai `max(poissonQty, economicQty)`.
- Rounding memakai ceil minimum 1 jika kebutuhan > 0.

### Approval Apply

- Role `ADMIN` dan `TL` bisa mengajukan apply rekomendasi ke `minQty`.
- Role `ASMAN` bisa approve/reject pengajuan apply.
- Role `MANAGER` hanya bisa melihat ringkasan dan histori.
- Sebelum approval Asman, `minQty` tidak berubah.
- Setelah approval Asman, apply hanya mengubah `minQty`, tidak mengubah `qty`.
- Jika katalog punya banyak lokasi, hanya row stok utama yang menyimpan `minQty`.
- Pengajuan, approval/reject, dan hasil apply tercatat di audit history.

### Dashboard Manajemen

- Dashboard menampilkan section Material Cadang untuk `ADMIN`, `TL`, `ASMAN`, dan `MANAGER`.
- Jika belum ada analisis, dashboard menampilkan empty state `Material Cadang belum dianalisis`.
- KPI `Aman`, `Kurang`, `Kosong/Critical`, `Gap Qty`, dan `Estimasi Nilai Gap` sesuai hasil analisis terakhir.
- Tabel prioritas maksimal 10 item dan diurutkan berdasarkan kelas/gap/nilai risiko.
- Status per material mengikuti aturan `Belum Dianalisis`, `Persediaan/Rutin`, `Tidak Ada Kebutuhan`, `Kosong/Critical`, `Kurang`, `Aman`.
- CTA dashboard membuka modul Material Cadang dengan filter yang sesuai.
- Role `ASMAN`/`MANAGER` bisa melihat ringkasan; `ASMAN` dapat approve pengajuan apply dari menu Approval/modul Material Cadang, bukan langsung dari dashboard.

### Build

- `npm run build` berhasil.
- Tidak ada perubahan behavior TUG, Data Stok, import SAP PEMAT, dan Forecast Stok existing.

---

## 16. Catatan Keputusan Diskusi

Keputusan yang sudah dikunci:

- Fitur v1 khusus `jenisBarang === "Cadang"`.
- Output fitur adalah rekomendasi + pengajuan apply ke `minQty` dengan approval Asman, bukan otomatis membuat rencana pengadaan.
- Import data populasi/failure memakai 1 sheet panjang.
- Grain import adalah `Material x Equipment Cluster`.
- Template XLSX resmi v1: `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx`.
- CSV tetap didukung jika header sama dengan sheet `Import Material Cadang`.
- Matching utama memakai `No Katalog`; `Nama Material` hanya warning.
- Histori failure/penggantian memakai agregat 5 tahun.
- Populasi adalah populasi equipment cluster.
- Lead time dan time to failure diisi per baris import.
- ABC value memakai `Harga x failure`.
- Poisson v1 memakai reliability-only, belum optimasi biaya.
- Service level default per policy:
  - Mandatory/A1: 99%.
  - Optimum/A2: 95%.
  - B1/B2: 90%.
- Rounding memakai ceil minimum 1.
- A2 memakai split:
  - TTF >= lead time dan bukan breakdown/emergency -> Persediaan.
  - TTF < lead time atau breakdown/emergency -> Material Cadang.
- Dashboard harus menampilkan ringkasan status Material Cadang agar informatif untuk manajemen.
- Catalog Master PLN disimpan sebagai hidden cataloger reference, bukan Master Katalog utama.
- Katalog MARA SAP disimpan sebagai hidden reference, bukan Master Katalog utama.
- Extend dari MARA ke Master Data hanya untuk material yang dipilih user.
- Jika MARA berbeda dengan Master Katalog WARNOTO existing, WARNOTO tetap authority operasional; MARA memberi warning/review.
- Apply rekomendasi Material Cadang ke `minQty` harus melalui approval Asman.

---

## 17. Catatan Implementasi untuk Claude

Ketika mulai implementasi di Claude:

1. Baca `App.jsx` terlebih dahulu karena aplikasi masih monolit besar.
2. Tambahkan state/storage baru dengan pola `saveToCloud`.
3. Jangan mengubah seed data katalog/stok untuk fitur ini.
4. Jangan mengubah parser SAP PEMAT existing kecuali hanya reuse helper normalisasi no katalog.
5. Pisahkan helper perhitungan Material Cadang dari komponen UI agar mudah dites manual.
6. Pastikan apply ke `minQty` hanya terjadi setelah approval Asman dan tidak mengubah `qty` atau histori TUG.
7. Untuk MARA, jangan load seluruh hidden reference ke UI Master Data; gunakan lazy search/filter agar performa aman.
8. Setelah implementasi, jalankan `npm run build`.

---

## 18. Instruksi Saat Update/Migrasi di Claude

Saat fitur ini akan dikerjakan di Claude, upload file berikut bersama source WARNOTO:

1. `App.jsx` versi aktif WARNOTO.
2. `WARNOTO_DOCS.md`.
3. `MATERIAL_CADANG_SPEC.md`.
4. `TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx`.
5. `CATALOG MASTER.xlsx`.
6. `Katalog MARA (01-2026).xlsx`.
7. Contoh file import Material Cadang/populasi-failure jika sudah tersedia.

Prompt pembuka yang disarankan untuk Claude:

```text
Baca dulu MATERIAL_CADANG_SPEC.md, WARNOTO_DOCS.md, dan App.jsx.
Implementasikan fitur Material Cadang sesuai spec.
Gunakan TEMPLATE_IMPORT_MATERIAL_CADANG.xlsx sebagai format upload XLSX resmi v1.
Jangan memasukkan seluruh MARA ke Master Katalog.
CATALOG MASTER.xlsx dan Katalog MARA (01-2026).xlsx dipakai sebagai hidden reference.
Master Katalog WARNOTO tetap authority operasional; MARA hanya untuk lookup/extend material terpilih.
Apply rekomendasi ke minQty harus melalui approval Asman.
Setelah implementasi, jalankan npm run build dan laporkan perubahan.
```

Urutan kerja yang disarankan:

1. Parse dan validasi `CATALOG MASTER.xlsx` sebagai hidden cataloger reference.
2. Parse dan validasi `Katalog MARA (01-2026).xlsx` sebagai hidden SAP MARA reference.
3. Tambahkan storage/state untuk Material Cadang dan hidden references.
4. Bangun parser import Material Cadang CSV/XLSX.
5. Bangun helper perhitungan ABC, policy, Poisson, Economic.
6. Bangun UI modul Material Cadang.
7. Tambahkan dashboard manajemen Material Cadang.
8. Tambahkan approval Asman untuk apply rekomendasi ke `minQty`.
9. Uji import, hitung, dashboard, approval, dan build.

Catatan penting:

- Jangan auto-import 42 ribu katalog MARA ke Master Katalog.
- Jangan auto-rename katalog existing dari MARA atau Catalog Master.
- Jangan mengubah qty stok dari fitur ini.
- Jika data referensi besar menyebabkan UI lambat, gunakan pencarian/filter lazy dan tampilkan hasil terbatas.
