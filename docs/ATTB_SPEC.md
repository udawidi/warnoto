# Spesifikasi Fitur Material ATTB (Aktiva Tetap Tidak Beroperasi) WARNOTO

Dokumen ini adalah spesifikasi mandiri untuk implementasi fitur **Material ATTB** di WARNOTO.

Status: **IMPLEMENTASI SELESAI untuk jenis MATERIAL, termasuk import Excel** (10 Juli 2026) — langkah 1-6 di bagian 9 sudah dikerjakan untuk jenis MATERIAL: tabel `attb_list`, state+load/sync, fungsi CRUD (createAttbItem/saveAttbEdit/submitAttbToKI/approveAttbToKI/rejectAttbToKI/advanceAttbStage/markAttbBelumLanjut/**bulkImportAttbItems**), komponen `AttbTab` (termasuk panel Import Excel), menu sidebar "ATTB". Build (`npm run build`) lolos. Parser Excel (`parseAttbMaterialFile2`/`parseAttbMaterialFile4`) sudah divalidasi lewat skrip Node standalone terhadap file Excel asli — hasil parsing 165 baris (file 2) & 57 baris (file 4) match persis dengan profil data, dedupe 56 item terdeteksi otomatis, `kategoriMaterial` Trafo/Non-Trafo terdeteksi benar. **Belum dites manual lewat UI browser oleh user** (upload file sungguhan lewat tombol "📥 Import Excel (Material)" di menu ATTB, sebelum data riil benar-benar masuk ke Supabase).

Jenis aset lain (Tanah/Bangunan/Saluran Air/Jalan/Kendaraan) **belum dianalisis & belum ada parser import** — sheetnya di file 4 masih kosong (belum pernah dipakai UPT Surabaya), jadi belum ada data riil untuk dipetakan. Kalau nanti ada datanya, tinggal tambah parser baru mengikuti pola `parseAttbMaterialFile2`/`parseAttbMaterialFile4` di App.jsx.

Sumber referensi: `D:\_SURABAYA\ATTB\ATTB SEMESTER 2 2026\` — 4 file Excel + 1 diagram alur (`5. Alur Pendaftaran ATTB.jpeg`). File `1. CAD AKUNTANSI.xlsx` di folder yang sama **di luar scope** — itu data cadangan akuntansi terpisah, jangan dicampur.

---

## 1. Latar Belakang

UPT (terutama Surabaya/JBM) memproses penghapusan aset material yang sudah rusak/tidak terpakai lewat alur berjenjang: dari pengumpulan data material di gudang, verifikasi ke SAP (ZAR02/CBM), sampai diajukan ke Kantor Induk (KI) dan berakhir di lelang. Saat ini proses ini dipantau lewat beberapa file Excel terpisah (Bursa Material, Monitoring Saldo ATTB, Template AE.3.1) yang mudah membuat item "hilang jejak" — tidak jelas siapa yang pegang bola berikutnya di setiap tahap.

Fitur ini memberi WARNOTO satu tempat untuk memantau posisi tiap material ATTB dalam satu pipeline linear, dengan riwayat perpindahan tahap yang tercatat rapi (audit trail), termasuk item yang macet ("Belum Lanjut") beserta alasannya — istilah yang sudah dipakai persis di data lapangan user.

Fitur ini **tidak menggantikan** proses resmi SAP/ZAR02/CBM/approval Kantor Induk (lihat diagram "Sumber Penghapusan Aset dari UPT": Cek TUG10 → Cek Olahdata → Cek ZAR02 → Cek Asset Value → Lengkapi BA Penggantian → Draft AE.1 → Kirim ke KI). WARNOTO mulai mencatat dari titik material sudah terkumpul sebagai kandidat (setara langkah "Lengkapi BA → Draft AE.1 → Kirim ke KI" di diagram), lalu terus memonitor sampai Menunggu Lelang.

---

## 2. Konsep Inti — Pipeline 5 Tahap

**Pra-tahap — Material Bongkaran (dari TUG-10)** (ditambah 10 Juli 2026): sebelum masuk pipeline, ada pool sumber = material yang masuk lewat TUG-10 (retur) dengan `statusMaterial = "Bongkaran ATTB (MTU)"`. Pool ini diturunkan LIVE dari `txns` (docType TUG10), bukan disimpan di `attb_list`. Admin/TL klik **"Usulkan ATTB"** pada satu material → dibuat record `attb_list` baru di Tahap 1 (Usulan AE.1), pre-filled dari data TUG-10 (`description`=nama, `nomorAT`=noAsset, `noEquipment`=noSeri, `kuantitas`/`satuan`, `keterangan`=asal TUG-10) + `sourceTug10Key` = `${txnId}::${noSeri}` untuk dedup (material yg sudah diusulkan ditandai "Sudah diusulkan", tidak bisa dobel). Tombol "+ Tambah Kandidat manual" **dihapus** — jalur masuk kandidat ATTB sekarang lewat pra-tahap ini (TUG-10) atau import Excel. Di UI, pra-tahap tampil sebagai chip putus-putus 🧰 paling depan di pipeline.

Satu material = satu record yang bergerak maju terus melalui 5 tahap berurutan (tidak pernah mundur, kecuali ditandai "Belum Lanjut" dengan alasan — item tetap di tahap yang sama, bukan mundur):

1. **Usulan AE.1 ke Unit Induk** — kandidat material dari gudang yang belum diajukan.
2. **AE.1 s.d. AE.4** — sudah diajukan, dalam proses approval berjenjang di Kantor Induk.
3. **Siap Cek Dekom** — menunggu/proses pemeriksaan dekomisioning fisik.
4. **Cek KJPP** — menunggu/proses penilaian oleh Kantor Jasa Penilai Publik.
5. **Menunggu Lelang** — tahap akhir yang di-track WARNOTO, sebelum lelang oleh Kantor Induk (hasil lelang/serah terima di luar scope).

---

## 3. Alur Pengguna

**Tahap 1 — Usulan AE.1 ke Unit Induk**
- Admin/TL menandai material sebagai kandidat ATTB (link ke Data Stok existing ATAU input manual — lihat bagian 4).
- Pilih **jenis aset** dulu (Tanah/Bangunan/Saluran Air/Jalan/Kendaraan/Material) — form field menyesuaikan (lihat bagian 5).
- Isi field awal, status `DRAFT`.
- Klik **"Ajukan ke Asman"** → status `PENDING_ASMAN`.
- **Asman approve** → resmi terkirim ke KI, pindah ke Tahap 2. **Asman reject** → balik ke `DRAFT` dengan alasan, tetap di Tahap 1.

**Tahap 2 — AE.1 s.d. AE.4**
- Field tambahan terisi: BA (BA AE3/BA AE4), Status ATTB (kode batch), Kategori Material (Trafo/Non Trafo — khusus jenis Material), Link Eviden Dokumen.
- Kalau macet: tandai **"Belum Lanjut"** + alasan wajib diisi — item tetap di Tahap 2.
- Kalau lolos AE.4: Admin/TL klik **"Siap Cek Dekom"** → Tahap 3 (tanpa approval Asman).

**Tahap 3 — Siap Cek Dekom**
- Field: tanggal cek, PIC pemeriksa, hasil, catatan, foto kondisi (opsional).
- Admin/TL klik **"Lanjut ke Cek KJPP"** → Tahap 4.

**Tahap 4 — Cek KJPP**
- Field: tanggal penilaian, nilai taksiran KJPP, dokumen hasil penilaian (link), catatan.
- Admin/TL klik **"Masuk Antrian Lelang"** → Tahap 5.

**Tahap 5 — Menunggu Lelang**
- Field: estimasi jadwal lelang, catatan. Tahap akhir di WARNOTO.

Semua perpindahan tahap = aksi manual (bukan otomatis), sesuai preferensi WARNOTO review-first.

---

## 4. Rencana UI

Pola konsisten dengan menu Alat Berat (chip filter + kartu, compact desktop & mobile):

- Header + ringkasan KPI (Total item, jumlah per tahap, jumlah "Belum Lanjut").
- Chip filter 5 tahap dengan angka count (klik untuk filter).
- Badge merah kalau ada item "Belum Lanjut" di tahap manapun — perlu perhatian.
- Kartu per item: nomor ATTB, deskripsi, nilai, lokasi asal, badge tahap, tombol aksi kontekstual sesuai tahap.
- Tombol **"✏️ Edit"** per item (pola sama Alat Berat) — isi field tambahan tahap + upload foto/link dokumen dalam 1 modal, form menyesuaikan `jenisAset`.
- Detail/riwayat: timeline perpindahan tahap per item.
- Mobile: chip filter scroll horizontal, kartu stack vertikal (bukan tabel lebar).

---

## 5. Data Model

Diusulkan tabel baru **`attb_list`** di `supabase/schema.sql`, pola generik jsonb sama seperti `heavy_equipment`/`warehouse_capacity` — kolom fisik minimal `id`, `data jsonb`, `created_at`, `upt`, `stage` (untuk index/filter cepat).

### Field inti (semua jenis aset)
`jenisAset` (enum: `TANAH`/`BANGUNAN`/`SALURAN_AIR`/`JALAN`/`KENDARAAN`/`MATERIAL`), `nomorAT`, `nomorATTB`, `assetClass`, `assetType`, `function`, `description`, `nilaiPerolehan`, `nilaiBuku`, `alasanPenghapusbukuan`, `waktuUsulanPenghapusan` (mis. "Semester 2 2026" — penanda batch/periode usulan, diminta user 2026-07-10 supaya tiap item bisa dilacak diusulkan di semester berapa), `keterangan`, `upt`, `stage`, `stageHistory[]` ({stage, tanggal, oleh, catatan}), `lokasiId` (opsional — link ke blok Master Data Gudang `lokasi`, diisi manual via dropdown Gudang→Blok inline di kolom Lokasi tabel, seperti Data Stok; mengaktifkan tombol 📍 "Lihat di Peta Gudang" via `getLokasiPetaInfo`/`setPetaMiniDetail` bersama existing. Data lokasi teks bawaan Excel tetap disimpan di `lokasi`/`lokasiFisikCatatan` sebagai referensi, tidak auto-map ke `lokasiId`), `katalogId`/`stockId` (opsional, link ke Data Stok existing), `createdAt`/`createdBy`, `updatedAt`/`updatedBy`.

`alasanPenghapusbukuan` **sudah jadi dropdown/select** di `ATTB_CORE_FIELDS` (App.jsx, konstanta `ATTB_ALASAN_PENGHAPUSBUKUAN`) — daftar baku dari sheet referensi "Daftar Alasan Pengapusbukuan" di file 4 (lihat 7a): kategori **Kondisi Tertentu** (`Hilang`, `Musnah`, `Rusak`, `Biaya pemindahtanganan lebih besar daripada nilai ekonomis`, `Dibongkar untuk dibangun kembali/jadi Aktiva Tetap lain`, `Dibongkar untuk tidak dibangun kembali`, `Berdasarkan UU/putusan Pengadilan`) dan kategori **Pemindahtanganan** (`Penjualan`, `Tukar Menukar`, `Ganti Rugi`, `Aktiva Tetap dijadikan Penyertaan Modal`, `Cara Lain`).

### Field tambahan per jenis aset
(sesuai template resmi PLN di file `4. Rev 01 Template AE. 3.1 3.2 - AT Kondisi Tertentu 2026...xlsx`, sheet per jenis)

| Jenis | Field tambahan |
|---|---|
| **Tanah** | `noSertifikat`, `luasM2`, `tahunPerolehan` |
| **Bangunan** / **Saluran Air** / **Jalan** | `masaManfaat`, `lokasi`, `kuantitas`, `satuan`, `tahunPerolehan`, `umurPakai`, `estimasiNilaiManfaat{jenis, konversiKg, rpPerKg, nilaiTaksiran}` (khusus Jalan +`hilang`) |
| **Kendaraan** | `masaManfaat`, `tahunPerolehan`, `umurPakai`, `kuantitas`, `satuan`, `spesifikasi`, `nomorRangka`, `nomorMesin`, `nomorBPKB`, `nomorSTNK`, `nomorPolisi`, `estimasiNilaiManfaat{...}` |
| **Material/Alat** (AT OP) | `masaManfaat`, `merkType`, `spesifikasi`, `kuantitas`, `satuan`, `tahunPerolehan`, `umurPakai`, `lokasi`, `bay`, `noEquipment`, `kelengkapanBA` (lihat catatan di bawah), `hasilUji`, `linkBAUpdate` (link file BA update di Google Drive), `catatanBA` (catatan QC bebas soal BA, mis. "OK"/"SALAH NO SERI"/"ADA" — **beda** dari field `ba` di Tahap 2 yang isinya kode batch BA AE3/AE4, sengaja dipisah biar tidak ketuker), `keteranganAlat` (catatan bebas ttg alat, mis. "RELAY"/"MTU"/"1 SET DENGAN CUBICLE INCOMING"), `lokasiFisikCatatan` (teks bebas — isinya campuran kode rak gudang informal/nama Gardu Induk/catatan status, **tidak** dipaksa jadi FK ke Master Gudang; direkonsiliasi manual oleh Admin/TL lewat picker Master Gudang existing saat review kalau materialnya memang sudah di gudang), `estimasiJenis`/`estimasiKonversiKg`/`estimasiRpPerKg`/`estimasiNilaiTaksiran` (Estimasi Nilai Manfaat — ada di file 4, **tidak ada** di file 2 sumber data Semester 2, jadi kosong dulu sampai ada penilaian), `kategoriMaterial` (Trafo/Non Trafo) |

**Catatan `kelengkapanBA`**: field ini sudah ada sejak planning awal (diasumsikan teks/checklist), tapi hasil cek file 4 kolomnya ternyata berisi link Google Drive (78.9% terisi). Diputuskan (9-10 Juli 2026) untuk **tidak mengimpor isi kolom itu** (juga kolom "LINK UPT" yang serupa) — cukup `linkBAUpdate` yang disimpan. Field `kelengkapanBA` tetap ada di skema untuk isian manual nanti, tapi import Excel tidak akan mengisinya otomatis.

**Kolom yang di-drop / digabung ke `keterangan`** (bukan field terpisah): "NO URUT SEBELUMNYA" (nomor urut versi lama) dan kolom tanpa header di file 4 (catatan QC ke-2, mis. "KURANG TTD MAS TRIYAN") — keduanya diputuskan digabung jadi teks tambahan di `keterangan`, bukan field baru.

### Field tracking per tahap
- **Tahap 1→2 (approval)**: `approvalStatus` (DRAFT/PENDING_ASMAN/APPROVED/REJECTED), `diajukanBy`/`diajukanAt`, `approvedBy`/`approvedAt`, `catatanApproval`/`alasanTolak` — pakai `logApprovalHistory` yang sudah ada di app (konsisten pola TUG/Stock Opname).
- **Tahap 2**: `ba`, `statusATTB`, `lanjutBelumLanjut`, `keteranganTidakLanjut`, `linkEvidenDokumen`.
- **Tahap 3 (Dekom)**: `tanggalCekDekom`, `picDekom`, `hasilDekom`, `catatanDekom`, `fotoDekom`.
- **Tahap 4 (KJPP)**: `tanggalKJPP`, `nilaiTaksiranKJPP`, `dokumenKJPP`, `catatanKJPP`.
- **Tahap 5 (Lelang)**: `estimasiJadwalLelang`, `catatanLelang`.

---

## 6. Bisnis Rules

1. Perpindahan tahap selalu manual, satu arah maju — tidak ada tombol "mundur tahap".
2. "Belum Lanjut" di Tahap 2 tidak memindahkan item, hanya menandai + wajib isi alasan (`keteranganTidakLanjut`).
3. Approval Asman **hanya** di Tahap 1→2. Tahap 2→3, 3→4, 4→5 dieksekusi langsung oleh Admin/TL.
4. Link ke Data Stok bersifat opsional — tidak memaksa satu cara input.
5. Multi-UPT: MSB/Manager UIT melihat semua UPT; role lain terkunci ke UPT sendiri (pola sama Alat Berat).
6. Menu berdiri sendiri di sidebar (bukan sub-tab Master Data), sejajar Data Stok/Alat Berat.

---

## 7. Import Data Lama (Excel)

Tool import dibangun untuk mendukung ke-6 jenis aset (mapping kolom per template), tapi **dijalankan sekali nanti setelah semua jenis siap** — bukan bertahap per jenis, sesuai keputusan user.

Catatan penting hasil pengecekan file referensi (2026-07-09, dikonfirmasi ulang lebih presisi 2026-07-10): dari 6 sheet template di file 4, **hanya "Template AE.3.1f AT OP" (Material/Alat) yang punya data terisi** (57 baris riil, 3 baris terakhir TOTAL/rekap). Sheet Tanah, Bangunan, Saluran Air, Jalan, Kendaraan semuanya kosong (cuma 1 baris contoh) — belum pernah dipakai UPT Surabaya. Sumber data riil untuk import:
- `2. List Material Bursa yang belum diusulkan hapus...xlsx` (sheet `Template AE.3.1f AT OP`, ~250 baris) → kandidat Tahap 1, dikelompokkan per gudang (mis. "GUDANG SURABAYA SELATAN").
- `3. Monitoring Saldo ALL Usulan ATTB Hapus...xlsx` (sheet `Saldo ATTB Hapus`, ~4.386 baris, kolom lengkap termasuk `BA`, `Status ATTB`, `Lanjut/Belum Lanjut`, `Kategori Material`) → item yang sudah di Tahap 2, mencakup banyak UPT (Bali, dst — bukan cuma Surabaya).

### 7a. Pemetaan Kolom Final — jenis MATERIAL (struktur dari File 4, data dari File 2)

Hasil analisis struktur (2026-07-09 s.d. 2026-07-10, dibaca langsung pakai library `xlsx` yang sudah ada di project) + keputusan user. **Belum ada kode import ditulis** — ini murni dokumentasi pemetaan untuk dipakai saat sesi coding import berikutnya. Keputusan user (2026-07-10): **file 4 dipakai sebagai acuan struktur kolom yang benar** (format resmi usulan AE.1 ke Kantor Induk), tapi **data yang diimpor tetap dari file 2** (kandidat Semester 2 yang belum diusulkan) — file 4 sendiri isinya data Semester 1 yang sudah lewat, cuma dipakai untuk mencocokkan field.

**File 2** — `2. List Material Bursa yang belum diusulkan hapus (usulan AE 1 Semester 2 2026).xlsx`, sheet `Template AE.3.1f AT OP`: 1 sheet, header ganda (baris 6 + baris 9), data riil baris 11-175 (165 baris), baris 178 = TOTAL/footer (**wajib di-exclude**). Judul section "GUDANG SURABAYA SELATAN" di baris 10 **tidak** mewakili semua baris — lokasi per-baris ada di kolom I sendiri (2 nilai: Surabaya Selatan & Ketintang).

**File 4** — `4. Rev 01 Template AE. 3.1 3.2 - AT Kondisi Tertentu 2026 - TAHAP 1 KI (semester 1 2026).xlsx`, sheet `Template AE.3.1f AT OP` (200MB total file — sheet lain isinya dokumentasi foto, dibaca selektif pakai opsi `sheets:[...]` biar tidak load semua): 32 kolom (jauh lebih lengkap dari file 2), header baris 6-9 (termasuk sub-header baris 7 untuk kolom Nilai Perolehan/Buku dan Estimasi Nilai Manfaat yang merged-cell), data riil baris 11-67 (57 baris), baris 68-70 = TOTAL/rekap (**wajib di-exclude**). Semua kolom inti 100% terisi. Ada sheet referensi terpisah **"Daftar Alasan Pengapusbukuan"** (11 nilai baku, lihat bagian 5).

**Analisis silang file 2 vs file 4 (2026-07-10) — ditemukan duplikasi 100% terverifikasi**: cross-check penuh `Nomor AT/ATTB` antar kedua file (bukan sampel) menunjukkan **56 dari 57 item di file 4 persis sama** dengan 56 baris di file 2 (match Nomor AT, Description, dan NILAI/Nilai Perolehan identik semua) — dan ke-56 baris itu di file 2 **tepat** adalah semua baris yang `HASIL UJI = "sudah usul hapus"` (set-nya sama persis, 56=56, dikonfirmasi lewat perbandingan set, bukan cuma jumlah kebetulan sama). Jadi flag "sudah usul hapus" di file 2 memang literal & akurat: item itu sudah pernah diusulkan (sudah masuk data Semester 1 yang tercatat di file 4). Sisa 1 item file4 yang tidak ada di file2 ("4000000686", Trafo TAKAOKA 150/20-30 MVA di lokasi GI SUKOLILO, asset class beda sendiri "00040107") — trafo besar kemungkinan tidak lagi tercatat di list bursa material gudang biasa.

**Catatan istilah**: judul file 4 "TAHAP 1 KI (semester 1 2026)" adalah istilah dokumen PLN sendiri (artinya "batch pertama yang dikirim ke Kantor Induk"), **bukan** sama dengan "Tahap 1" di pipeline WARNOTO (Usulan AE.1 ke Unit Induk — status belum diajukan). Item-item di file 4 justru sudah lewat Tahap 1 WARNOTO: sudah ada BA (link "LINK BA UPDATE" terisi 100%), sudah ada Alasan Penghapusbukuan ("Rusak"), sudah ada estimasi nilai manfaat — ciri-ciri sudah masuk proses approval berjenjang KI. Jadi datanya lebih cocok mendarat di **Tahap 2 WARNOTO ("AE.1 s.d. AE.4")**, bukan Tahap 1.

**Rencana import final (2 tingkat, tidak ada duplikasi)**:
- **109 baris file 2** (165 total − 56 yang sudah terbukti duplikat) → Tahap 1 WARNOTO (`stage="USULAN_AE1"`, `approvalStatus="DRAFT"`), data dari file 2 (field yang tidak ada di file 2 tetap kosong, lihat tabel pemetaan di bawah).
- **57 baris file 4** (56 yang overlap + 1 item unik Trafo) → Tahap 2 WARNOTO (`stage="AE1_AE4"`, `approvalStatus="APPROVED"` — proses Tahap1→2 dianggap sudah lolos sebelum WARNOTO ada), data dari file 4 yang lebih lengkap (assetType, function, masaManfaat, tahunPerolehan, umurPakai, nilaiBuku, 4 field estimasi, alasanPenghapusbukuan, linkBAUpdate, catatanBA semua terisi). `stageHistory` diisi 2 entry sintetis (bukan dibuat manual lewat app): `{stage:"USULAN_AE1", catatan:"Data historis Semester 1 2026 (file 4), tahap awal tidak tercatat di WARNOTO"}` lalu `{stage:"AE1_AE4", catatan:"Sudah diusulkan & disetujui sebelum WARNOTO ada, diimpor langsung dari file 4"}`.
- **Total item MATERIAL unik hasil import**: 109 + 57 = **166 item**, tidak ada duplikat.

**Nilai tetap untuk kedua tingkat**: `jenisAset="MATERIAL"`, `upt="Surabaya"`.

Tabel di bawah berlaku untuk **109 baris genuine-baru dari file 2** (→ Tahap 1). Untuk **57 baris → Tahap 2**, semua field diambil langsung dari file 4 (kolomnya sudah 1:1 sama dengan nama field, semua terisi 100%) — tidak perlu tabel pemetaan terpisah.

| Field ATTB | Kolom di File 4 (acuan struktur) | Ada di File 2? → sumber data saat import (109 baris Tahap 1) |
|---|---|---|
| `nomorAT` | Nomor AT/ATTB (100% unik, dipakai key dedupe) | ✅ kolom "Nomor AT/ATTB" (100% unik juga di file 2) |
| `assetClass` | Asset Class | ✅ kolom "Asset Class" (selalu "10700" di file 2) |
| `assetType` | Asset Type (9 kode SAP, mis. "08102001") | ❌ tidak ada di file 2 — kosong saat import |
| `function` | Function (selalu "7") | ❌ tidak ada di file 2 — kosong, atau default "7" |
| `description` | Description | ✅ kolom "Description" |
| `masaManfaat` | Masa Manfaat ("40"/"15") | ❌ tidak ada di file 2 — kosong |
| `merkType` | Merk / Type | ✅ kolom "Merk / Type" |
| `spesifikasi` | Spesifikasi | ✅ kolom "Spesifikasi" |
| `kuantitas` | Kuantitas | ✅ kolom "Kuantitas" |
| `satuan` | Satuan | ✅ kolom "Satuan" |
| `tahunPerolehan` | Tahun Perolehan | ❌ tidak ada di file 2 — kosong |
| `umurPakai` | Umur Pakai | ❌ tidak ada di file 2 — kosong |
| `nilaiPerolehan` | Nilai (Rp) → Perolehan | ✅ kolom "NILAI" (satu-satunya kolom nilai di file 2, dikonfirmasi cocok ke Nilai Perolehan lewat cross-check nomor AT yang sama) |
| `nilaiBuku` | Nilai (Rp) → Buku | ❌ tidak ada di file 2 — kosong |
| `estimasiJenis`/`KonversiKg`/`RpPerKg`/`NilaiTaksiran` | Estimasi nilai manfaat (4 sub-kolom) | ❌ tidak ada di file 2 — kosong |
| `lokasi` | Lokasi AT / ATTB | ✅ kolom "Lokasi AT/ATTB" |
| `alasanPenghapusbukuan` | Alasan Penghapusbukuan (dropdown, lihat bagian 5) | ❌ tidak ada di file 2 — kosong, diisi manual saat review (field select) |
| `keterangan` | Keterangan (+ gabungan "NO URUT SEBELUMNYA" & kolom QC tanpa header kalau ada) | ✅ kolom "Keterangan" (cuma 12% terisi di file 2) |
| `bay` | BAY | ✅ kolom "BAY" |
| `noEquipment` | No Equipment | ✅ kolom "No Equipment" |
| `kelengkapanBA` | KELENGKAPAN BA (ternyata link Drive di file 4, lihat catatan bagian 5) | ❌ tidak diimpor dari manapun — isian manual nanti |
| `hasilUji` | HASIL UJI (0% terisi di file 4) | Kosong untuk 109 baris Tahap 1 — semua baris yang tadinya terisi "sudah usul hapus" (56 baris) **sudah dikeluarkan** dari kelompok ini (masuk kelompok Tahap 2, lihat analisis silang di atas), jadi tidak ada lagi nilai "sudah usul hapus" tersisa di kelompok Tahap 1 |
| `linkBAUpdate` | LINK BA UPDATE | ❌ tidak ada di file 2 — kosong |
| `catatanBA` | BA (catatan QC bebas, mis. "OK"/"SALAH NO SERI") | ❌ tidak ada di file 2 — kosong |
| `keteranganAlat` | KETERANGAN ALAT | ✅ kolom "KETERANGAN ALAT" di file 2 (98.2% terisi) |
| `lokasiFisikCatatan` | *(tidak ada di file 4 — kolom ini spesifik ada di file 2)* | ✅ kolom "LOKASI" terakhir di file 2 (88.5% terisi, teks bebas campuran kode rak/nama GI/catatan status — lihat detail keputusan di bagian 5) |
| `kategoriMaterial` | *(field Tahap 2, bukan dari kolom import Tahap 1)* | — |

**Revisi dari keputusan sesi sebelumnya (superseded, urutan kronologis)**:
1. Ide awal: field `linkHasilUji` wajib dipasangkan dengan `hasilUji` — **dibatalkan** setelah cek file 4, karena kolom HASIL UJI di file 4 0% terisi dan tidak ada kolom link pendamping resmi untuknya.
2. Ide kedua: baris "sudah usul hapus" tetap diimpor semua apa adanya sebagai Tahap 1 — **dibatalkan** setelah analisis silang membuktikan ke-56 baris itu memang benar-benar duplikat item yang sudah ada di file 4 (Tahap 2). Keputusan final: **56 baris itu tidak diimpor sebagai Tahap 1 dari file 2 sama sekali** — datanya diimpor dari file 4 (lebih lengkap) langsung sebagai Tahap 2. Field `hasilUji` jadi tidak relevan lagi dipakai sebagai penentu apapun saat import (nilainya cuma dipakai untuk filter mana yang exclude dari Tahap 1, tidak ikut disimpan).

**Field baru — SUDAH ditambahkan ke `ATTB_FIELDS_BY_JENIS.MATERIAL` + `ATTB_CORE_FIELDS` di App.jsx (10 Juli 2026)**: core — `function`, `waktuUsulanPenghapusan`, `alasanPenghapusbukuan` (jadi dropdown via `ATTB_ALASAN_PENGHAPUSBUKUAN`); Material — `linkBAUpdate`, `catatanBA`, `keteranganAlat`, `lokasiFisikCatatan`, `estimasiJenis`, `estimasiKonversiKg`, `estimasiRpPerKg`, `estimasiNilaiTaksiran`. `renderField` di `AttbTab` diperluas mendukung `type:"select"` untuk dropdown.

### 7c. Implementasi Import — SELESAI (10 Juli 2026)

- **Parser** (module-scope, App.jsx dekat `ATTB_STAGE5_FIELDS`): `parseAttbCurrency(v)` (strip format ribuan/spasi, `"-"` → 0), `parseAttbMaterialFile2(rows, opts)`, `parseAttbMaterialFile4(rows, opts)`. Deteksi baris data generik: kolom index 1 (Nomor AT/ATTB) match regex `/^\d{6,}$/` — otomatis melewati baris judul section, baris legenda nomor kolom, dan baris TOTAL/footer tanpa perlu tahu nomor baris pasti (robust terhadap variasi file lain di masa depan).
- **CRUD**: `bulkImportAttbItems(records, targetStage)` — dedupe generik lewat `nomorAT` terhadap `attbList` yang sudah ada (bukan cuma string "sudah usul hapus"), jadi aman dipanggil ulang. `targetStage="TAHAP1"` → `stage:"USULAN_AE1"`/`DRAFT`. `targetStage="TAHAP2"` → `stage:"AE1_AE4"`/`APPROVED` + `stageHistory` 2 entri sintetis + `catatanApproval` menjelaskan data historis.
- **UI**: panel modal "📥 Import Excel (Material)" di `AttbTab` — pilih Target Tahap (dropdown menentukan parser mana yang dipakai), input UPT & Waktu Usulan Penghapusan, upload `.xlsx`, preview tabel (Nomor AT/Description/Nilai/status Baru-atau-Duplikat) dengan hitungan Baru vs Dilewati, tombol konfirmasi import. Ada hint di UI: import Tahap 2 dulu baru Tahap 1 supaya dedupe optimal.
- **Validasi**: parser dites lewat skrip Node standalone terhadap kedua file Excel asli (bukan cuma build check) — hasil cocok 100% dengan profil data (165/57/56/109), termasuk deteksi `kategoriMaterial` Trafo dari `assetClass` dan parsing nilai `"-"` jadi 0. `npm run build` lolos tanpa error.
- **Belum dilakukan**: import sungguhan lewat UI browser (upload file asli, cek hasil masuk ke Supabase) — baru tervalidasi di level parser/build, belum end-to-end di aplikasi berjalan.

### 7b. Detail teknis tambahan untuk 57 baris → Tahap 2 (diputuskan sendiri dari data, tanpa tanya user lagi)

- **`kategoriMaterial`** (field Tahap 2, Trafo/Non Trafo) bisa diturunkan otomatis dari `assetClass`: hanya 2 nilai assetClass ditemukan di 57 baris ini — `"00040107"` (1 baris, deskripsi "TRF.TENAGA;TAKAOKA...") → `kategoriMaterial="Trafo"`, `"10700"` (56 baris) → `kategoriMaterial="Non Trafo"`. **Catatan**: aturan ini cuma valid untuk data yang sudah dilihat (2 nilai assetClass) — kalau UPT lain/data lain punya assetClass berbeda, mapping ini perlu dicek ulang, jangan diasumsikan berlaku universal.
- **`ba`** dan **`statusATTB`** (2 field resmi Tahap 2 — kode batch BA AE3/AE4) **tidak ada kolom sumbernya** baik di file 2 maupun file 4 (kolom "BA" di file 4 isinya catatan QC bebas, sudah dipetakan terpisah ke `catatanBA`, bukan kode batch) — tetap kosong saat import, diisi manual oleh Admin/TL kalau/kapan kode batch resminya didapat.
- **`diajukanBy`/`diajukanAt`/`approvedBy`/`approvedAt`**: karena approval Tahap1→2 ini terjadi sebelum WARNOTO ada (tidak ada jejak siapa/kapan approve-nya di Excel), field ini diisi `null` saat import (bukan tanggal/user sungguhan) + `catatanApproval:"Data historis — tanggal & approver asli tidak tercatat, diimpor langsung sebagai Tahap 2 dari file 4"`. Ditampilkan di UI apa adanya (kosong), tidak dipaksa isi tanggal palsu.
- **Parsing nilai uang**: kolom Nilai Buku file 4 kadang berisi `" -   "` (strip, bukan angka 0 eksplisit) untuk 1 baris (Trafo yang sudah full-depresiasi) — parser harus treat `"-"` sebagai `0`, bukan gagal parse atau `NaN`.
- **`upt="Surabaya"` hardcoded** cuma valid untuk kedua file spesifik ini — kalau tool import dipakai lagi nanti untuk file bursa material UPT lain, `upt` harus dibaca dinamis dari judul sheet ("PT PLN (Persero) UITJBM - UPT ...."), bukan tetap di-hardcode "Surabaya".

Form/parser import tetap dibangun generik untuk 6 jenis supaya siap dipakai kapan pun Tanah/Bangunan/Kendaraan punya data riil, tanpa kerja ulang.

### 7d. Opsi import lanjutan (ditambah 10 Juli 2026 atas permintaan user)

- **UPT otomatis dari login** — input UPT manual dihapus; `upt` diisi otomatis dari scope UPT admin yang login (`effectiveUptFilter || myUpt`). Ditampilkan read-only di modal.
- **Waktu Usulan Penghapusan — format baku** — dropdown Semester (1/2) + Tahun (tahun berjalan + tahun sebelumnya), tersimpan sebagai string `"Semester {1/2} - {tahun}"` (mis. `"Semester 1 - 2026"`). Format ini juga dipakai di form Tambah/Edit manual (`waktuUsulanPenghapusan` jadi `type:"select"` dgn `ATTB_WAKTU_USULAN_OPTIONS`).
- **Opsi "Sertakan baris hidden"** — default OFF: baris yang di-hide/di-filter di Excel (`ws["!rows"][i].hidden`) dilewati saat import (butuh `cellStyles:true` saat baca). Toggle ON untuk ikut mengimpor baris tersembunyi. Preview menampilkan jumlah baris hidden. (Latar: file 2 sempat punya 60 baris hidden lewat autofilter — terlihat 105 padahal isi 165.)
- **Opsi "Tiban (timpa)"** — default OFF. Kalau ON: semua item eksisting dengan `waktuUsulanPenghapusan` **dan** `upt` yang sama dengan pilihan import akan **dihapus** lebih dulu, lalu diganti isi file (file jadi sumber kebenaran untuk batch semester itu). Dedup `nomorAT` tetap jalan terhadap item batch LAIN yang dipertahankan (jadi item lintas-semester spt Tahap 2 file 4 tidak dobel). Karena destruktif, muncul popup konfirmasi (pakai `askConfirmDelete` generik) sebelum eksekusi. Berguna untuk re-upload file semester yang sudah dikoreksi tanpa menumpuk duplikat/baris basi.

---

## 8. Risiko

- **Duplikasi dengan Data Stok**: material yang masuk pipeline ATTB kemungkinan masih tercatat sebagai stok aktif — perlu keputusan lanjutan apakah stok otomatis "dibekukan" saat masuk Tahap 1 (belum diputuskan, lihat bagian 10).
- **Proses di luar kendali WARNOTO**: approval AE.1-AE.4 sesungguhnya terjadi di sistem Kantor Induk (SAP/manual) — WARNOTO cuma mencatat status, tidak ada integrasi otomatis ke SAP/ZAR02. Risiko data telat update kalau tidak rajin diisi manual.
- **Import file besar**: `Saldo ATTB Hapus` (4.386 baris) dan file 4 (200MB, banyak sheet dokumentasi foto) — import harus batch/preview, tidak load semua ke browser sekaligus.

---

## 9. Plan Implementasi (urutan kerja, belum dimulai)

1. Tabel `attb_list` di `supabase/schema.sql` (pola generik jsonb sama seperti `heavy_equipment`), plus RLS policy standar.
2. State `attbList` + load/sync di App.jsx (pola sama `heavyEquipmentList`: load dari Supabase, fallback localStorage, `syncMasterTable` saat berubah).
3. Fungsi CRUD: `createAttbItem`, `saveAttbEdit` (form dinamis per `jenisAset` + foto), `submitAttbToKI` (Tahap1→PENDING_ASMAN), `approveAttbToKI`/`rejectAttbToKI` (Asman), `advanceAttbStage` (Tahap2→3→4→5, tanpa approval), `markAttbBelumLanjut`.
4. Komponen tab baru `AttbTab` (pilih jenis aset saat tambah baru → field form menyesuaikan; chip filter 5 tahap; badge "Belum Lanjut"; modal edit + riwayat).
5. Menu sidebar baru + role permission (ADMIN/TL create & advance, ASMAN approve Tahap1→2, MSB/Manager UIT multi-UPT view).
6. Tool import Excel (mapping kolom per 6 template) — dibangun lengkap, dijalankan manual sekali saat semua siap.

---

## 10. Pertanyaan Terbuka (belum diputuskan, tidak menghalangi mulai coding)

- Begitu material masuk Tahap 1, apakah stok-nya di Data Stok otomatis ditandai (mis. status khusus) supaya tidak dobel-hitung, atau dua data berjalan independen dulu?

---

## Keputusan Final (hasil AskUserQuestion, 9 Juli 2026)

| Aspek | Keputusan |
|---|---|
| Cakupan jenis aset | Semua 6 jenis: Tanah, Bangunan, Saluran Air, Jalan, Kendaraan Bermotor, Material/Alat (AT OP) |
| Link Data Stok | Opsional (boleh link atau input manual) |
| Approval | Asman wajib approve di **Tahap 1→2** saja; tahap lain jalan langsung oleh Admin/TL |
| Import data lama | Dibangun untuk 6 jenis aset, dijalankan sekaligus nanti setelah semua jenis siap |
| Menu | Item sidebar sendiri, sejajar Data Stok/Alat Berat |
| Scope UPT | Multi-UPT (pola sama Alat Berat) |
