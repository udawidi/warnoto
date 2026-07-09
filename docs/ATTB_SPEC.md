# Spesifikasi Fitur Material ATTB (Aktiva Tetap Tidak Beroperasi) WARNOTO

Dokumen ini adalah spesifikasi mandiri untuk implementasi fitur **Material ATTB** di WARNOTO.

Status: **PLANNING / SPEC READY** — hasil sesi planning (`/plan-warnoto`) tanggal 9 Juli 2026. Belum ada kode ditulis untuk fitur ini. Semua keputusan desain di bawah sudah difinalkan bersama user (lihat bagian 9), tinggal lanjut ke implementasi.

Sumber referensi: `D:\_SURABAYA\ATTB\ATTB SEMESTER 2 2026\` — 4 file Excel + 1 diagram alur (`5. Alur Pendaftaran ATTB.jpeg`). File `1. CAD AKUNTANSI.xlsx` di folder yang sama **di luar scope** — itu data cadangan akuntansi terpisah, jangan dicampur.

---

## 1. Latar Belakang

UPT (terutama Surabaya/JBM) memproses penghapusan aset material yang sudah rusak/tidak terpakai lewat alur berjenjang: dari pengumpulan data material di gudang, verifikasi ke SAP (ZAR02/CBM), sampai diajukan ke Kantor Induk (KI) dan berakhir di lelang. Saat ini proses ini dipantau lewat beberapa file Excel terpisah (Bursa Material, Monitoring Saldo ATTB, Template AE.3.1) yang mudah membuat item "hilang jejak" — tidak jelas siapa yang pegang bola berikutnya di setiap tahap.

Fitur ini memberi WARNOTO satu tempat untuk memantau posisi tiap material ATTB dalam satu pipeline linear, dengan riwayat perpindahan tahap yang tercatat rapi (audit trail), termasuk item yang macet ("Belum Lanjut") beserta alasannya — istilah yang sudah dipakai persis di data lapangan user.

Fitur ini **tidak menggantikan** proses resmi SAP/ZAR02/CBM/approval Kantor Induk (lihat diagram "Sumber Penghapusan Aset dari UPT": Cek TUG10 → Cek Olahdata → Cek ZAR02 → Cek Asset Value → Lengkapi BA Penggantian → Draft AE.1 → Kirim ke KI). WARNOTO mulai mencatat dari titik material sudah terkumpul sebagai kandidat (setara langkah "Lengkapi BA → Draft AE.1 → Kirim ke KI" di diagram), lalu terus memonitor sampai Menunggu Lelang.

---

## 2. Konsep Inti — Pipeline 5 Tahap

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
`jenisAset` (enum: `TANAH`/`BANGUNAN`/`SALURAN_AIR`/`JALAN`/`KENDARAAN`/`MATERIAL`), `nomorAT`, `nomorATTB`, `assetClass`, `assetType`, `function`, `description`, `nilaiPerolehan`, `nilaiBuku`, `alasanPenghapusbukuan`, `keterangan`, `upt`, `stage`, `stageHistory[]` ({stage, tanggal, oleh, catatan}), `katalogId`/`stockId` (opsional, link ke Data Stok existing), `createdAt`/`createdBy`, `updatedAt`/`updatedBy`.

### Field tambahan per jenis aset
(sesuai template resmi PLN di file `4. Rev 01 Template AE. 3.1 3.2 - AT Kondisi Tertentu 2026...xlsx`, sheet per jenis)

| Jenis | Field tambahan |
|---|---|
| **Tanah** | `noSertifikat`, `luasM2`, `tahunPerolehan` |
| **Bangunan** / **Saluran Air** / **Jalan** | `masaManfaat`, `lokasi`, `kuantitas`, `satuan`, `tahunPerolehan`, `umurPakai`, `estimasiNilaiManfaat{jenis, konversiKg, rpPerKg, nilaiTaksiran}` (khusus Jalan +`hilang`) |
| **Kendaraan** | `masaManfaat`, `tahunPerolehan`, `umurPakai`, `kuantitas`, `satuan`, `spesifikasi`, `nomorRangka`, `nomorMesin`, `nomorBPKB`, `nomorSTNK`, `nomorPolisi`, `estimasiNilaiManfaat{...}` |
| **Material/Alat** (AT OP) | `masaManfaat`, `merkType`, `spesifikasi`, `kuantitas`, `satuan`, `tahunPerolehan`, `umurPakai`, `lokasi`, `bay`, `noEquipment`, `kelengkapanBA`, `hasilUji`, `kategoriMaterial` (Trafo/Non Trafo) |

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

Catatan penting hasil pengecekan file referensi (2026-07-09): dari 6 sheet template di file 4, **hanya "Template AE.3.1f AT OP" (Material/Alat) yang punya data terisi** (59 baris). Sheet Tanah, Bangunan, Saluran Air, Jalan, Kendaraan semuanya kosong (cuma 1 baris contoh) — belum pernah dipakai UPT Surabaya. Sumber data riil untuk import:
- `2. List Material Bursa yang belum diusulkan hapus...xlsx` (sheet `Template AE.3.1f AT OP`, ~250 baris) → kandidat Tahap 1, dikelompokkan per gudang (mis. "GUDANG SURABAYA SELATAN").
- `3. Monitoring Saldo ALL Usulan ATTB Hapus...xlsx` (sheet `Saldo ATTB Hapus`, ~4.386 baris, kolom lengkap termasuk `BA`, `Status ATTB`, `Lanjut/Belum Lanjut`, `Kategori Material`) → item yang sudah di Tahap 2, mencakup banyak UPT (Bali, dst — bukan cuma Surabaya).

Form/parser import tetap dibangun generik untuk 6 jenis supaya siap dipakai kapan pun Tanah/Bangunan/Kendaraan punya data riil, tanpa kerja ulang.

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
