// ATTB (Penghapusan Aset Material / Aktiva Tetap Tidak Beroperasi) — pipeline
// stages, field spec per jenis, gate approval, parser Excel File 2/4. Dipindah
// dari App.jsx (refactor Fase 3e). Lihat docs/ATTB_SPEC.md.
import { getUserUptScope } from "./roles.js";

// Lihat docs/ATTB_SPEC.md untuk spesifikasi lengkap. Satu record = satu material/aset,
// bergerak maju linear lewat 5 tahap (tidak pernah mundur), kecuali ditandai "Belum
// Lanjut" di Tahap 2 — item tetap di tahap yang sama, bukan mundur.
export const ATTB_JENIS_ASET = ["TANAH","BANGUNAN","SALURAN_AIR","JALAN","KENDARAAN","MATERIAL"];

export const ATTB_JENIS_ASET_LABEL = { TANAH:"Tanah", BANGUNAN:"Bangunan", SALURAN_AIR:"Saluran Air", JALAN:"Jalan", KENDARAAN:"Kendaraan Bermotor", MATERIAL:"Material/Alat" };

export const ATTB_STAGES = [
  { code:"USULAN_AE1", label:"Usulan AE.1 ke Unit Induk" },
  { code:"AE1_AE4", label:"AE.1 s.d. AE.4" },
  { code:"CEK_DEKOM", label:"Siap Cek Dekom" },
  { code:"CEK_KJPP", label:"Cek KJPP" },
  { code:"LELANG", label:"Menunggu Lelang" },
];

export function attbStageIndex(stage) {
  const i = ATTB_STAGES.findIndex(s=>s.code===stage);
  return i === -1 ? 0 : i;
}

export function attbStageLabel(stage) {
  return ATTB_STAGES.find(s=>s.code===stage)?.label || stage || "-";
}

// Approval Tahap1->2 discope ke Asman UPT PENGAJU (item.upt) — pola sama
// canApproveHeavyEquipmentLoan: WAJIB match persis, tidak longgar kalau upt kosong.
export function canApproveAttb(user, item) {
  if (user?.role === "SUPERADMIN") return true;
  if (user?.role !== "ASMAN") return false;
  const userUpt = getUserUptScope(user);
  return !!item?.upt && userUpt === item.upt;
}

export function isPendingAttbApproval(item) {
  return item?.approvalStatus === "PENDING_ASMAN";
}

// Field tambahan per jenis aset (docs/ATTB_SPEC.md bagian 5, sheet template AE.3.1).
// estimasiNilaiManfaat{jenis,konversiKg,rpPerKg,nilaiTaksiran} dari spec disederhanakan
// jadi field flat (estimasiJenis/estimasiKonversiKg/dst) supaya form tetap generik lewat
// renderField, tanpa kehilangan data (tetap tersimpan sebagai kolom jsonb biasa).
export const ATTB_FIELDS_BY_JENIS = {
  TANAH: [
    {key:"noSertifikat", label:"No Sertifikat", type:"text"},
    {key:"luasM2", label:"Luas (m²)", type:"number"},
    {key:"tahunPerolehan", label:"Tahun Perolehan", type:"text"},
  ],
  BANGUNAN: [
    {key:"masaManfaat", label:"Masa Manfaat", type:"text"},
    {key:"lokasi", label:"Lokasi", type:"text"},
    {key:"kuantitas", label:"Kuantitas", type:"number"},
    {key:"satuan", label:"Satuan", type:"text"},
    {key:"tahunPerolehan", label:"Tahun Perolehan", type:"text"},
    {key:"umurPakai", label:"Umur Pakai", type:"text"},
    {key:"estimasiJenis", label:"Estimasi Nilai Manfaat — Jenis", type:"text"},
    {key:"estimasiKonversiKg", label:"Estimasi — Konversi Kg", type:"number"},
    {key:"estimasiRpPerKg", label:"Estimasi — Rp per Kg", type:"number"},
    {key:"estimasiNilaiTaksiran", label:"Estimasi — Nilai Taksiran", type:"number"},
  ],
  KENDARAAN: [
    {key:"masaManfaat", label:"Masa Manfaat", type:"text"},
    {key:"tahunPerolehan", label:"Tahun Perolehan", type:"text"},
    {key:"umurPakai", label:"Umur Pakai", type:"text"},
    {key:"kuantitas", label:"Kuantitas", type:"number"},
    {key:"satuan", label:"Satuan", type:"text"},
    {key:"spesifikasi", label:"Spesifikasi", type:"text"},
    {key:"nomorRangka", label:"Nomor Rangka", type:"text"},
    {key:"nomorMesin", label:"Nomor Mesin", type:"text"},
    {key:"nomorBPKB", label:"Nomor BPKB", type:"text"},
    {key:"nomorSTNK", label:"Nomor STNK", type:"text"},
    {key:"nomorPolisi", label:"Nomor Polisi", type:"text"},
    {key:"estimasiJenis", label:"Estimasi Nilai Manfaat — Jenis", type:"text"},
    {key:"estimasiKonversiKg", label:"Estimasi — Konversi Kg", type:"number"},
    {key:"estimasiRpPerKg", label:"Estimasi — Rp per Kg", type:"number"},
    {key:"estimasiNilaiTaksiran", label:"Estimasi — Nilai Taksiran", type:"number"},
  ],
  MATERIAL: [
    {key:"masaManfaat", label:"Masa Manfaat", type:"text"},
    {key:"merkType", label:"Merk/Type", type:"text"},
    {key:"spesifikasi", label:"Spesifikasi", type:"text"},
    {key:"kuantitas", label:"Kuantitas", type:"number"},
    {key:"satuan", label:"Satuan", type:"text"},
    {key:"tahunPerolehan", label:"Tahun Perolehan", type:"text"},
    {key:"umurPakai", label:"Umur Pakai", type:"text"},
    {key:"lokasi", label:"Lokasi", type:"text"},
    {key:"bay", label:"Bay", type:"text"},
    {key:"noEquipment", label:"No Equipment", type:"text"},
    {key:"kelengkapanBA", label:"Kelengkapan BA", type:"text"},
    {key:"hasilUji", label:"Hasil Uji", type:"text"},
    {key:"linkBAUpdate", label:"Link BA Update", type:"text"},
    {key:"catatanBA", label:"Catatan BA (QC)", type:"text"},
    {key:"keteranganAlat", label:"Keterangan Alat", type:"text"},
    {key:"lokasiFisikCatatan", label:"Catatan Lokasi Fisik", type:"text"},
    {key:"estimasiJenis", label:"Estimasi Nilai Manfaat — Jenis", type:"text"},
    {key:"estimasiKonversiKg", label:"Estimasi — Konversi Kg", type:"number"},
    {key:"estimasiRpPerKg", label:"Estimasi — Rp per Kg", type:"number"},
    {key:"estimasiNilaiTaksiran", label:"Estimasi — Nilai Taksiran", type:"number"},
  ],
};

// Daftar baku dari sheet referensi "Daftar Alasan Pengapusbukuan" (file 4 ATTB_SPEC bagian 7a/7b).
export const ATTB_ALASAN_PENGHAPUSBUKUAN = [
  "Hilang", "Musnah", "Rusak",
  "Biaya pemindahtanganan lebih besar daripada nilai ekonomis",
  "Dibongkar untuk dibangun kembali/jadi Aktiva Tetap lain",
  "Dibongkar untuk tidak dibangun kembali",
  "Berdasarkan UU/putusan Pengadilan",
  "Penjualan", "Tukar Menukar", "Ganti Rugi",
  "Aktiva Tetap dijadikan Penyertaan Modal", "Cara Lain",
];

// Format baku Waktu Usulan Penghapusan: "Semester {1/2} - {tahun}". Tahun berjalan +
// tahun sebelumnya (untuk data historis). Dibangun sekali saat load modul.
export const ATTB_WAKTU_USULAN_OPTIONS = (() => {
  const y = new Date().getFullYear();
  return [`Semester 1 - ${y}`, `Semester 2 - ${y}`, `Semester 1 - ${y-1}`, `Semester 2 - ${y-1}`];
})();

export const ATTB_CORE_FIELDS = [
  {key:"description", label:"Deskripsi", type:"text"},
  {key:"nomorAT", label:"Nomor AT", type:"text"},
  {key:"nomorATTB", label:"Nomor ATTB", type:"text"},
  {key:"assetClass", label:"Asset Class", type:"text"},
  {key:"assetType", label:"Asset Type", type:"text"},
  {key:"function", label:"Function", type:"text"},
  {key:"nilaiPerolehan", label:"Nilai Perolehan", type:"number"},
  {key:"nilaiBuku", label:"Nilai Buku", type:"number"},
  {key:"alasanPenghapusbukuan", label:"Alasan Penghapusbukuan", type:"select", options:ATTB_ALASAN_PENGHAPUSBUKUAN},
  {key:"waktuUsulanPenghapusan", label:"Waktu Usulan Penghapusan", type:"select", options:ATTB_WAKTU_USULAN_OPTIONS},
  {key:"keterangan", label:"Keterangan", type:"text"},
];

export const ATTB_STAGE2_FIELDS = [
  {key:"ba", label:"BA (BA AE3/BA AE4)", type:"text"},
  {key:"statusATTB", label:"Status ATTB (kode batch)", type:"text"},
  {key:"linkEvidenDokumen", label:"Link Eviden Dokumen", type:"text"},
];

export const ATTB_STAGE3_FIELDS = [
  {key:"tanggalCekDekom", label:"Tanggal Cek Dekom", type:"date"},
  {key:"picDekom", label:"PIC Pemeriksa", type:"text"},
  {key:"hasilDekom", label:"Hasil Pemeriksaan", type:"text"},
  {key:"catatanDekom", label:"Catatan", type:"text"},
];

export const ATTB_STAGE4_FIELDS = [
  {key:"tanggalKJPP", label:"Tanggal Penilaian KJPP", type:"date"},
  {key:"nilaiTaksiranKJPP", label:"Nilai Taksiran KJPP", type:"number"},
  {key:"dokumenKJPP", label:"Dokumen Hasil Penilaian (link)", type:"text"},
  {key:"catatanKJPP", label:"Catatan", type:"text"},
];

export const ATTB_STAGE5_FIELDS = [
  {key:"estimasiJadwalLelang", label:"Estimasi Jadwal Lelang", type:"date"},
  {key:"catatanLelang", label:"Catatan", type:"text"},
];

// Dua format sumber berbeda, dipetakan ke target tahap berbeda:
// - "File 2" (Bursa Material belum diusulkan, ~18 kolom) -> kandidat baru Tahap 1.
// - "File 4" (Template AE.3.1f resmi, ~32 kolom, header ganda) -> item yang sudah
//   disetujui sebelum WARNOTO ada, langsung masuk Tahap 2.
// Baris data dideteksi generik lewat kolom "Nomor AT/ATTB" (index 1 di kedua format)
// yang berisi angka >=6 digit — membedakannya dari baris judul section (teks),
// baris legenda nomor kolom ("2","3",...), dan baris TOTAL/footer (kosong di kolom ini).
export function parseAttbCurrency(v) {
  const cleaned = String(v ?? "").replace(/[^0-9.\-]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

export function parseAttbMaterialFile2(rows, opts) {
  const records = [];
  for (const row of rows) {
    const nomorAT = String(row[1] ?? "").trim();
    if (!/^\d{6,}$/.test(nomorAT)) continue;
    records.push({
      jenisAset: "MATERIAL",
      nomorAT,
      assetClass: String(row[2] ?? "").trim(),
      description: String(row[3] ?? "").trim(),
      merkType: String(row[4] ?? "").trim(),
      spesifikasi: String(row[5] ?? "").trim(),
      kuantitas: String(row[6] ?? "").trim(),
      satuan: String(row[7] ?? "").trim(),
      lokasi: String(row[8] ?? "").trim(),
      keterangan: String(row[9] ?? "").trim(),
      nilaiPerolehan: parseAttbCurrency(row[10]),
      bay: String(row[11] ?? "").trim(),
      noEquipment: String(row[12] ?? "").trim(),
      hasilUji: String(row[14] ?? "").trim(),
      keteranganAlat: String(row[15] ?? "").trim(),
      lokasiFisikCatatan: String(row[16] ?? "").trim(),
      upt: opts.upt,
      waktuUsulanPenghapusan: opts.waktuUsulanPenghapusan,
    });
  }
  return records;
}

export function parseAttbMaterialFile4(rows, opts) {
  const records = [];
  for (const row of rows) {
    const nomorAT = String(row[1] ?? "").trim();
    if (!/^\d{6,}$/.test(nomorAT)) continue;
    const assetClass = String(row[2] ?? "").trim();
    const noUrutSebelumnya = String(row[28] ?? "").trim();
    const catatanQCTambahan = String(row[31] ?? "").trim();
    const keteranganExtra = [
      noUrutSebelumnya ? `No urut sebelumnya: ${noUrutSebelumnya}` : "",
      catatanQCTambahan,
    ].filter(Boolean).join(" | ");
    const keterangan = [String(row[21] ?? "").trim(), keteranganExtra].filter(Boolean).join(" — ");
    records.push({
      jenisAset: "MATERIAL",
      nomorAT,
      assetClass,
      assetType: String(row[3] ?? "").trim(),
      function: String(row[4] ?? "").trim(),
      description: String(row[5] ?? "").trim(),
      masaManfaat: String(row[6] ?? "").trim(),
      merkType: String(row[7] ?? "").trim(),
      spesifikasi: String(row[8] ?? "").trim(),
      kuantitas: String(row[9] ?? "").trim(),
      satuan: String(row[10] ?? "").trim(),
      tahunPerolehan: String(row[11] ?? "").trim(),
      umurPakai: String(row[12] ?? "").trim(),
      nilaiPerolehan: parseAttbCurrency(row[13]),
      nilaiBuku: parseAttbCurrency(row[14]),
      estimasiJenis: String(row[15] ?? "").trim(),
      estimasiKonversiKg: parseAttbCurrency(row[16]),
      estimasiRpPerKg: parseAttbCurrency(row[17]),
      estimasiNilaiTaksiran: parseAttbCurrency(row[18]),
      lokasi: String(row[19] ?? "").trim(),
      alasanPenghapusbukuan: String(row[20] ?? "").trim(),
      keterangan,
      bay: String(row[22] ?? "").trim(),
      noEquipment: String(row[23] ?? "").trim(),
      hasilUji: String(row[25] ?? "").trim(),
      linkBAUpdate: String(row[27] ?? "").trim(),
      keteranganAlat: String(row[29] ?? "").trim(),
      catatanBA: String(row[30] ?? "").trim(),
      kategoriMaterial: assetClass === "00040107" ? "Trafo" : "Non Trafo",
      upt: opts.upt,
      waktuUsulanPenghapusan: opts.waktuUsulanPenghapusan,
    });
  }
  return records;
}
