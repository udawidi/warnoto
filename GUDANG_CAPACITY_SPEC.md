# Spesifikasi Fitur Monitoring Kapasitas Gudang WARNOTO

Dokumen ini adalah spesifikasi mandiri untuk implementasi fitur **Monitoring Kapasitas Gudang** di WARNOTO.

Status: **PLANNING / SPEC READY**  
Tanggal: 30 Juni 2026  
Sumber awal: `KAPASITAS GUDANG UIT JBM.xlsx`

---

## 1. Latar Belakang

WARNOTO saat ini sudah memiliki konsep gudang, lokasi/blok, dan peta gudang. Namun kapasitas yang ada pada `lokasi.kapasitas` masih bersifat kapasitas blok atau jumlah item/slot, bukan kapasitas luas fisik gudang.

Fitur baru ini dibuat untuk memonitor kapasitas gudang berdasarkan laporan rutin UIT JBM, dengan ukuran utama:

- luas lahan gudang;
- luas terpakai;
- sisa luas;
- persentase pemakaian;
- komposisi area material.

Tujuan akhirnya adalah memberi dashboard manajemen yang cepat dibaca: gudang mana yang sudah kritis, UPT mana yang paling padat, dan area mana yang masih punya sisa kapasitas.

---

## 2. Prinsip Desain

1. **Kapasitas m2 dipisah dari kapasitas blok existing.**  
   Field `lokasi.kapasitas` tidak boleh dipakai untuk luas m2 agar tidak merusak logika stok dan peta gudang yang sudah ada.

2. **Sumber awal adalah laporan UIT berbasis XLSX.**  
   File `KAPASITAS GUDANG UIT JBM.xlsx` menjadi baseline awal melalui proses import, review, dan publish.

3. **Data shared lintas user.**  
   Storage utama memakai Supabase, dengan fallback local/CLOUD mengikuti pola WARNOTO.

4. **Mapping ke peta harus dikonfirmasi.**  
   Sistem boleh memberi auto-suggest, tetapi Admin/TL tetap harus mengonfirmasi mapping ke master gudang/lokasi.

5. **Dashboard tetap informatif walau mapping belum lengkap.**  
   Record yang belum match tetap tampil di dashboard kapasitas, tetapi tidak ditempel ke denah Peta Gudang.

---

## 3. Scope v1

### In Scope

- Import file XLSX laporan kapasitas gudang UIT JBM.
- Validasi header baku laporan.
- Preview hasil parsing sebelum publish.
- Simpan data kapasitas dengan grain `UPT x Gudang x Sub Gudang`.
- Hitung status kapasitas:
  - `KRITIS`;
  - `WASPADA`;
  - `AMAN`.
- Dashboard manajemen kapasitas gudang.
- Integrasi ringkas ke Peta Wilayah Gudang.
- Integrasi badge/panel ke Peta Gudang jika record sudah ter-mapping.
- Role Admin dan TL dapat upload, koreksi, mapping, dan publish.
- Role lain read-only.

### Out of Scope v1

- Sheet `ALAT ANGKAT ANGKUT`.
- Perhitungan kapasitas volume berdasarkan dimensi material.
- Auto-optimasi penempatan material.
- Blok transaksi stok jika gudang penuh.
- Overlay sub-gudang ke titik/blok denah tanpa mapping manual.

---

## 4. Sumber Data XLSX

File referensi:

```text
D:\CLAUDE\WARNOTO data\tester\KAPASITAS GUDANG UIT JBM.xlsx
```

Sheet utama:

```text
KAPASITAS GUDANG
```

Sheet pendukung yang belum masuk v1:

```text
ALAT ANGKAT ANGKUT
```

Hasil eksplorasi file awal:

- sheet `KAPASITAS GUDANG` memiliki 44 record valid;
- total luas lahan sekitar 50.658,1 m2;
- total luas terpakai sekitar 44.417,4 m2;
- total sisa luas sekitar 6.240,7 m2;
- utilization total sekitar 87,7%;
- UPT dalam file: Surabaya, Malang, Probolinggo, Madiun, Bali, Gresik;
- sebagian besar record memiliki persentase Excel dalam bentuk ratio, misalnya `0.95` untuk `95%`;
- kolom `WAKTU UPDATE` dapat berisi Excel serial date dan harus dikonversi menjadi tanggal normal.

---

## 5. Format Header XLSX v1

Header baku berada pada sheet `KAPASITAS GUDANG`.

Kolom yang perlu dibaca:

| No | Header XLSX | Field Sistem | Catatan |
| --- | --- | --- | --- |
| 1 | `UPT` | `upt` | Normalisasi trim dan uppercase display seperlunya |
| 2 | `GUDANG` | `gudang` | Nama gudang utama |
| 3 | `SUB GUDANG` | `subGudang` | Grain record v1 |
| 4 | `SUB/TYPE GUDANG` | `typeGudang` | Tipe/jenis sub-gudang |
| 5 | `ALAMAT` | `alamat` | Untuk display dan match |
| 6 | `KOORDINAT LATITUDE` | `latitude` | Numeric, nullable |
| 7 | `KOORDINAT LONGITUDE` | `longitude` | Numeric, nullable |
| 8 | `LUAS LAHAN (M2)` | `luasLahanM2` | Numeric |
| 9 | `LUAS TERPAKAI (M2)` | `luasTerpakaiM2` | Numeric |
| 10 | `SISA LUAS LAHAN (M2)` | `sisaLuasM2` | Bisa dihitung ulang |
| 11 | `PERSENTASE TERPAKAI (%)` | `persentaseTerpakai` | Simpan sebagai 0-1, tampilkan persen |
| 12 | `PERSEDIAAN (%)` | `persediaanPct` | Simpan sebagai 0-1 |
| 13 | `CADANG (%)` | `cadangPct` | Simpan sebagai 0-1 |
| 14 | `PRE-MEMORY (%)` | `preMemoryPct` | Simpan sebagai 0-1 |
| 15 | `ATTB (%)` | `attbPct` | Simpan sebagai 0-1 |
| 16 | `LAINNYA (LIMBAH NON B3, ALAT ANGKUT, DLL) (%)` | `lainnyaPct` | Simpan sebagai 0-1 |
| 17 | `100% KOMPOSISI MATERIAL GUDANG TERPAKAI` | `komposisiCheck` | Validasi/warning, bukan field utama |
| 18 | `CONTACT PERSON` | `contactPerson` | Tampil di detail saja |
| 19 | `WAKTU UPDATE` | `waktuUpdate` | Convert Excel serial/date/string |
| 20 | `KETERANGAN` | `keterangan` | Optional |
| 21 | `BOBOT` | `bobot` | Optional, belum dipakai KPI v1 |
| 23 | `BOBOT GUDANG` | `bobotGudang` | Optional, belum dipakai KPI v1 |
| 24 | `LINK GUDANG` | `linkGudang` | Tampil di detail saja |

Header harus divalidasi secara toleran terhadap spasi ekstra, tetapi tetap harus cocok secara makna.

---

## 6. Struktur Data Disarankan

State React:

```js
const [gudangCapacityList, setGudangCapacityList] = useState([]);
const [gudangCapacityImports, setGudangCapacityImports] = useState([]);
```

Storage/Supabase:

```text
Supabase table: warehouse_capacity
Fallback key: pln_gudang_capacity_v1
Import audit key: pln_gudang_capacity_imports_v1
```

Contoh record:

```json
{
  "id": "CAP-SBY-KETINTANG-RUANG-ELEKTRONIK",
  "upt": "SURABAYA",
  "gudang": "KETINTANG",
  "subGudang": "RUANG ELEKTRONIK",
  "typeGudang": "RUANG ELEKTRONIK",
  "alamat": "Jl. Ketintang Baru Surabaya",
  "latitude": -7.314,
  "longitude": 112.724,
  "luasLahanM2": 64,
  "luasTerpakaiM2": 60.8,
  "sisaLuasM2": 3.2,
  "persentaseTerpakai": 0.95,
  "persediaanPct": 1,
  "cadangPct": 0,
  "preMemoryPct": 0,
  "attbPct": 0,
  "lainnyaPct": 0,
  "statusKapasitas": "KRITIS",
  "contactPerson": "",
  "waktuUpdate": "2026-06-01",
  "keterangan": "",
  "linkGudang": "",
  "matchedGudangId": "GDG-001",
  "matchedLokasiId": null,
  "mappingStatus": "CONFIRMED",
  "sourceFile": "KAPASITAS GUDANG UIT JBM.xlsx",
  "sourceSheet": "KAPASITAS GUDANG",
  "importBatchId": "CAPIMP-20260630-001",
  "createdAt": "2026-06-30T00:00:00.000Z",
  "updatedAt": "2026-06-30T00:00:00.000Z"
}
```

Mapping status:

```text
UNMATCHED
AUTO_SUGGESTED
CONFIRMED
REJECTED
```

---

## 7. Supabase Schema Disarankan

Minimal table:

```sql
create table if not exists warehouse_capacity (
  id text primary key,
  upt text not null,
  gudang text not null,
  sub_gudang text not null,
  type_gudang text,
  alamat text,
  latitude numeric,
  longitude numeric,
  luas_lahan_m2 numeric,
  luas_terpakai_m2 numeric,
  sisa_luas_m2 numeric,
  persentase_terpakai numeric,
  persediaan_pct numeric,
  cadang_pct numeric,
  pre_memory_pct numeric,
  attb_pct numeric,
  lainnya_pct numeric,
  status_kapasitas text,
  contact_person text,
  waktu_update date,
  keterangan text,
  link_gudang text,
  matched_gudang_id text,
  matched_lokasi_id text,
  mapping_status text default 'UNMATCHED',
  source_file text,
  source_sheet text,
  import_batch_id text,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Audit import:

```sql
create table if not exists warehouse_capacity_imports (
  id text primary key,
  source_file text not null,
  imported_by text,
  imported_at timestamptz default now(),
  status text not null,
  total_rows integer default 0,
  valid_rows integer default 0,
  warning_rows integer default 0,
  invalid_rows integer default 0,
  summary jsonb default '{}'::jsonb,
  errors jsonb default '[]'::jsonb
);
```

Catatan:

- Jika implementasi Supabase belum siap, fallback local/CLOUD tetap memakai key `pln_gudang_capacity_v1`.
- Saat Supabase aktif, local/CLOUD hanya menjadi fallback/cache.

---

## 8. Aturan Perhitungan

Status kapasitas:

```js
if (persentaseTerpakai >= 0.90) statusKapasitas = "KRITIS";
else if (persentaseTerpakai >= 0.75) statusKapasitas = "WASPADA";
else statusKapasitas = "AMAN";
```

Sisa luas:

```js
sisaLuasM2 = luasLahanM2 - luasTerpakaiM2;
```

Persentase terpakai:

```js
persentaseTerpakai = luasLahanM2 > 0 ? luasTerpakaiM2 / luasLahanM2 : 0;
```

Jika nilai XLSX dan hasil hitung berbeda kecil karena pembulatan, gunakan hasil hitung sistem dan tampilkan warning minor di preview.

Komposisi material:

```js
totalKomposisi =
  persediaanPct +
  cadangPct +
  preMemoryPct +
  attbPct +
  lainnyaPct;
```

Jika total komposisi jauh dari 1.0, tampilkan warning. Warning tidak selalu fatal karena beberapa baris laporan bisa belum lengkap.

---

## 9. Flow Import

1. Admin/TL membuka menu Monitoring Kapasitas Gudang.
2. Klik `Import Laporan Kapasitas`.
3. Upload XLSX.
4. Sistem membaca sheet `KAPASITAS GUDANG`.
5. Sistem validasi header.
6. Sistem parse record:
   - trim teks;
   - normalisasi angka;
   - normalisasi persen;
   - convert Excel serial date;
   - hitung ulang sisa luas dan persentase;
   - tentukan status kapasitas.
7. Sistem tampilkan preview:
   - total baris;
   - valid;
   - warning;
   - invalid;
   - summary per UPT;
   - summary status kapasitas;
   - daftar record bermasalah.
8. Sistem memberi auto-suggest mapping ke master gudang/lokasi.
9. Admin/TL konfirmasi mapping.
10. Klik `Publish Baseline`.
11. Data tersimpan ke Supabase dan fallback local/CLOUD.
12. Dashboard dan peta memakai data published terakhir.

Fatal error yang memblokir publish:

- header wajib tidak ditemukan;
- luas lahan kosong atau tidak valid;
- luas terpakai negatif;
- persentase tidak bisa dinormalisasi;
- record tanpa `UPT`, `GUDANG`, dan `SUB GUDANG`.

Warning yang tidak memblokir publish:

- koordinat kosong;
- contact person kosong;
- link gudang kosong;
- komposisi tidak tepat 100%;
- mapping belum dikonfirmasi.

---

## 10. Mapping ke Master WARNOTO

Auto-suggest memakai:

- kemiripan `gudang` dengan `gudangList.nama`;
- kemiripan `subGudang` dengan `lokasiList.nama` atau `lokasiList.kode`;
- kemiripan alamat;
- kedekatan koordinat jika tersedia.

Aturan:

- `CONFIRMED` diperlukan sebelum data ditempel ke Peta Gudang detail.
- `UNMATCHED` tetap tampil di dashboard kapasitas dan peta wilayah jika koordinat ada.
- `AUTO_SUGGESTED` boleh tampil di layar review, tetapi belum dianggap valid.
- Admin/TL dapat reject suggestion dan memilih gudang/lokasi manual.

---

## 11. UI yang Disarankan

Menu baru:

```text
Monitoring > Kapasitas Gudang
```

Tab v1:

1. **Dashboard**
   - KPI total lahan;
   - KPI total terpakai;
   - KPI sisa luas;
   - KPI utilization total;
   - jumlah `KRITIS`, `WASPADA`, `AMAN`;
   - ranking UPT;
   - top sub-gudang kritis;
   - komposisi area material.

2. **Data Kapasitas**
   - tabel semua record;
   - filter UPT;
   - filter status;
   - filter mapping status;
   - detail drawer untuk contact person, link, alamat, dan keterangan.

3. **Import & Review**
   - upload XLSX;
   - preview parsing;
   - warning/invalid list;
   - publish baseline.

4. **Mapping**
   - daftar record `UNMATCHED` dan `AUTO_SUGGESTED`;
   - pilih `gudangId`;
   - pilih `lokasiId` jika relevan;
   - confirm/reject mapping.

Dashboard utama WARNOTO:

- Tambah ringkasan kecil untuk manajemen:
  - utilization total;
  - jumlah gudang kritis;
  - UPT paling padat;
  - sisa luas total.

Peta Wilayah Gudang:

- Marker warna:
  - merah untuk `KRITIS`;
  - kuning untuk `WASPADA`;
  - hijau untuk `AMAN`;
  - abu-abu jika data tidak lengkap.
- Popup:
  - nama gudang/sub-gudang;
  - UPT;
  - luas lahan;
  - luas terpakai;
  - sisa luas;
  - persentase terpakai;
  - waktu update.

Peta Gudang detail:

- Tampilkan badge/panel kapasitas jika ada record `CONFIRMED`.
- Jangan mengubah marker stok existing.
- Jangan memakai field `lokasi.kapasitas` untuk m2.

---

## 12. Role dan Akses

| Role | Akses |
| --- | --- |
| Admin Gudang | Upload, review, edit, mapping, publish |
| TL Logistik | Upload, review, edit, mapping, publish |
| Asman | Read-only dashboard dan detail |
| Manager | Read-only dashboard dan detail |
| Admin UIT | Read-only atau dapat diberi edit pada fase lanjut |
| Mgr Logistik UIT | Read-only dashboard dan detail |
| Pengadaan | Read-only jika menu diaktifkan |

Catatan:

- V1 tidak membutuhkan approval Asman.
- Perubahan data harus tercatat dalam audit import/update.

---

## 13. Dashboard Management Insight

Minimal insight yang harus tersedia:

- **Total utilization UIT JBM**: `sum(luasTerpakaiM2) / sum(luasLahanM2)`.
- **Gudang kritis**: jumlah record `KRITIS`.
- **UPT paling padat**: ranking by weighted utilization, bukan rata-rata sederhana.
- **Sisa luas terkecil**: top sub-gudang berdasarkan `sisaLuasM2`.
- **Komposisi dominan**: agregasi komposisi area material.
- **Freshness data**: waktu update terbaru dan batch import terakhir.

Weighted utilization per UPT:

```js
uptUtilization = sum(luasTerpakaiM2) / sum(luasLahanM2);
```

Jangan memakai rata-rata `persentaseTerpakai` antar baris karena luas tiap gudang berbeda.

---

## 14. Acceptance Test

- Upload XLSX baku berhasil membaca 44 record kapasitas.
- Header tidak sesuai ditolak dengan pesan jelas.
- Persentase Excel `0.95` tampil sebagai `95%`.
- Tanggal Excel serial pada `WAKTU UPDATE` tampil sebagai tanggal normal.
- Status kapasitas sesuai threshold 90/75.
- Record unmatched tetap muncul di dashboard tetapi tidak muncul di denah gudang.
- Auto-suggest mapping tidak langsung publish sebagai confirmed tanpa konfirmasi Admin/TL.
- Dashboard total luas, sisa, dan utilization sama dengan preview import.
- User non Admin/TL read-only.
- Peta wilayah tetap berjalan walau sebagian record belum punya koordinat valid.
- Peta Gudang existing tetap menampilkan marker stok seperti sebelumnya.
- Field `lokasi.kapasitas` tidak berubah makna.

---

## 15. Instruksi Migrasi ke Claude

Saat memindahkan pengembangan fitur ini ke Claude:

1. Upload/bawa file:
   - `GUDANG_CAPACITY_SPEC.md`;
   - `WARNOTO_DOCS.md`;
   - `CLAUDE_HANDOFF.md`;
   - `README.md`;
   - `App.jsx`;
   - `KAPASITAS GUDANG UIT JBM.xlsx`.
2. Minta Claude membaca `GUDANG_CAPACITY_SPEC.md` sebelum mengubah kode.
3. Implementasi dimulai dari:
   - parser XLSX dan preview import;
   - state/storage `gudangCapacityList`;
   - dashboard kapasitas;
   - mapping ke gudang/lokasi;
   - integrasi peta wilayah dan peta gudang.
4. Jangan implementasikan sheet `ALAT ANGKAT ANGKUT` di v1.
5. Jangan mengubah `lokasi.kapasitas` menjadi m2.
6. Jalankan `npm run build` setelah implementasi kode.

Prompt pembuka yang disarankan:

```text
Baca GUDANG_CAPACITY_SPEC.md, WARNOTO_DOCS.md bagian 22, dan App.jsx.
Implementasikan fitur Monitoring Kapasitas Gudang v1 sesuai spec.
Jangan ubah makna field lokasi.kapasitas.
Data awal berasal dari import XLSX KAPASITAS GUDANG UIT JBM.xlsx.
Mulai dari parser import + preview + dashboard, lalu mapping dan integrasi peta.
```

---

## 16. Keputusan yang Sudah Dikunci

- Sumber v1: laporan UIT berbasis luas m2.
- Grain v1: `UPT x Gudang x Sub Gudang`.
- Storage utama: Supabase, fallback local/CLOUD.
- Data awal: Import UI Review, bukan hardcoded seed.
- Mapping: auto-suggest + manual confirm.
- Threshold: `KRITIS >= 90%`, `WASPADA 75%-89%`, `AMAN < 75%`.
- Sheet `ALAT ANGKAT ANGKUT` dipisah untuk fase berikutnya.
- Contact person dan link gudang tampil di detail, bukan kartu dashboard utama.
