// Alat Berat: data default + normalizer + getter loan + gate approval —
// dipindah dari App.jsx (refactor Fase 3d). getUserUptScope dari roles.js.
import { getUserUptScope } from "./roles.js";

export const HEAVY_EQUIPMENT_RAW = `
HE-001|Surabaya|Gudang Ketintang|TRUCK CRANE|Angkat|Nissan|8 TON|||Baik|
HE-002|Surabaya|Gudang Ketintang|TRUCK CRANE|Angkat Angkut|Hino|3 TON|||Service Time|
HE-003|Surabaya|GI Sukolilo|TRUCK CRANE|Angkat Angkut|Isuzu|3 TON||2024|Baik|
HE-004|Surabaya|Gudang Ketintang|FORKLIFT|Angkat Angkut|Patria|3 TON|||Baik|
HE-005|Surabaya|Gudang Ketintang|FORKLIFT|Angkat Angkut|Nissan|5 TON|||Baik|
HE-006|Surabaya|Gudang Ketintang|MANLIFT|Angkat|Haulotte|-|||Baik|
HE-007|Surabaya|Gudang Ketintang|MOBILE MANLIFT|Angkat|Hino|-|||Baik|
HE-008|Surabaya|Gudang Ketintang|HANDLIFT|Angkat|Krisbow|3 TON||2025|Baik|
HE-009|Surabaya|Gudang Ketintang|HANDLIFT|Angkat|Magna|3 TON||2021|Baik|
HE-010|Surabaya|Gudang Wonorejo|HANDLIFT|Angkat|HEMNEX|3 TON||2026|Baik|
HE-011|Surabaya|Gudang Wonorejo|HANDLIFT|Angkat|HEMNEX|3 TON||2026|Baik|
HE-012|Surabaya|Gudang Ketintang|TRUCK|Angkut|Rangger|-|||Baik|
HE-013|Probolinggo|KANTOR UPT PROBOLINGGO|TRUCK CRANE 5 TON|ANGKAT  ANGKUT|TADANO|5000|||BAIK|PERPANJANGAN
HE-014|Probolinggo|KANTOR UPT PROBOLINGGO|TRUCK CRANE 3 TON|ANGKAT  ANGKUT|TADANO|3000|||BAIK|PERPANJANGAN
HE-015|Probolinggo|GUDANG BANGIL|FORKLIFT|ANGKAT|TOYOTA|5000|||BAIK|PERPANJANGAN
HE-016|Probolinggo|GUDANG BANGIL|HAND PALLET|ANGKAT|KRISBOW|2000|||KERUSAKAN PISTON|
HE-017|Probolinggo|GUDANG BANGIL|HAND STACKER|ANGKAT|CAR LIFT|2000|||BAIK|
HE-018|Probolinggo|GUDANG BANGIL|HAND STACKER SEMI ELECTRIC|ANGKAT|GONON|2000|||BAIK|
HE-019|Bali|KAPAL|TROLLEY||KRISBOW|300 KG|||BAIK|
HE-020|Bali|KAPAL|TROLLEY||KRISBOW|300 KG|10544133||BAIK|
HE-021|Bali|KAPAL|DRUM HANDLING TROLLEY||KRISBOW||050087-0025-0825||BAIK|
HE-022|Bali|KAPAL|HYDRAULIC HAND PALLET||DALTON|2 TON|||BAIK|
HE-023|Bali|KAPAL|HYDRAULIC HAND PALLET||KRISBOW|3 TON|||BAIK|
HE-024|Bali|KAPAL|HYDRAULIC HAND PALLET||TOYO|5 TON|||BAIK|
HE-025|Bali|KAPAL|HYDRAULIC HAND STACKER||KRISBOW|2 TON x 1.5 M|051845-0094-0825||BAIK|
HE-026|Bali|KAPAL|MANLIFT||HINO|200 KG|DK 9002 FB||BAIK|
HE-027|Bali|KAPAL|FORKLIFT||KOMATSU|1 TON|||BAIK|
HE-028|Bali|KAPAL|FORKLIFT||TCM|4 TON|59204586||BAIK|
HE-029|Bali|KAPAL|CRANE||TOYOTA|2 TON|DK 8126 FE||BAIK|
HE-030|Bali|KAPAL|TRUCK CRANE||ISUZU|5 TON|DK 8214 JF||BAIK|
HE-031|Madiun|GUDANG PLTD|CRANE|ANGKAT / ANGKUT|HINO / SANNY PALFINGER|4 TON|NR:FF173MA14295 ;NM: H07CEJ15745|1990|NORMAL / KONDISI FISIK 60%|
HE-032|Madiun|GUDANG PLTD|CRANE|ANGKAT / ANGKUT|ISUZU GIGA / SANNY PALFINGER|10 TON|NR:MHCFVZ34URJ000690; NM:6HK1F108452|2024|NORMAL / KONDISI FISIK BAGUS|
HE-033|Madiun|GUDANG PLTD|FORKLIFT|ANGKAT|TOYOTA|5 TON||2022|NORMAL / KONDISI FISIK BAGUS|
HE-034|Madiun|GUDANG ULTG BABAT|FORKLIFT|ANGKAT|PATRIA|2 TON||2012|NORMAL / KONDISI FISIK 60%|
HE-035|Madiun|GUDANG PLTD / GUDANG DOLOPO|HAND STACKER|ANGKAT|NOBLELIFT|2 TON||2023|NORMAL / KONDISI FISIK BAGUS|
HE-036|Madiun|GUDANG PLTD / GUDANG DOLOPO|HAND STACKER|ANGKAT|NOBLELIFT|2 TON||2023|NORMAL / KONDISI FISIK BAGUS|
HE-037|Madiun|GUDANG PLTD / GUDANG DOLOPO|HANDLIFT|ANGKAT|KRISBOW|2 TON||2022|GUDANG PLTD NORMAL / GUDANG DOLOPO BOCOR SIL OIL|
HE-038|Madiun|GUDANG PLTD / GUDANG DOLOPO|HANDLIFT|ANGKAT|KRISBOW|2 TON||2022|GUDANG PLTD NORMAL / GUDANG DOLOPO BOCOR SIL OIL|
HE-039|Gresik|Gudang Tandes|TRUCK CRANE|Angkat Angkut|Tadano|3 TON|KE2298|2020|Baik|28 May 2026
HE-040|Gresik|Gudang Tandes|TRUCK CRANE|Angkat Angkut|Isuzu|8 TON|1100183287|2026|Baik|
HE-041|Gresik|Gudang Tandes|FORKLIFT|Angkat Angkut|Toyota|5 TON|8FD50N-22639|2023|Baik|28 May 2026
HE-042|Gresik|Gudang Tandes|FORKLIFT|Angkat Angkut|Komatsu|3 TON|413225-P||Butuh Peremajaan|28 May 2026
HE-043|Gresik|Gudang Tandes|HAND PALLET|Angkat|Krisbow||||Baik|
HE-044|Gresik|Gudang Tandes|TROLLEY|Angkat|Krisbow||||Baik|
HE-045|Malang|Gudang Polehan|TRUCK CRANE||Hino|5 TON||2024|Baik|June 2026
HE-046|Malang|Gudang Polehan|FORKLIFT||Patria|3 TON|||Butuh Peremajaan|
HE-047|Malang|Gudang Polehan|HAND PALLET||Krisbow|3 TON||2025|Baik|
HE-048|Malang|Gudang Polehan|HAND STACKER||Wipro|3 TON||2025|Baik|
HE-049|Malang|Gudang Polehan|TRUCK||Hino Ranger|-|||Baik|
HE-050|Malang|Gudang Krian|TRUCK CRANE||Isuzu|8 TON||2018|Butuh Perbaikan|
HE-051|Malang|Gudang Mojokerto|TRUCK CRANE||Mitsubishi Fuso|5 TON|||Butuh Peremajaan|
`;

export function normalizeHeavyEquipmentJenis(jenis, nama) {
  const raw = String(jenis || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (raw.includes("ANGKAT") && raw.includes("ANGKUT")) return "Angkat Angkut";
  if (raw.includes("ANGKUT")) return "Angkut";
  if (raw.includes("ANGKAT")) return "Angkat";
  const n = String(nama || "").toUpperCase();
  if (n.includes("TRUCK") || n.includes("TROLLEY")) return "Angkut";
  return "Angkat";
}

// Status alat: LAYAK, MAINTENANCE, PERLU_SERVICE, RUSAK, KIR (5 status yang bisa dipilih
// manual lewat tombol Edit Alat oleh Admin/TL). MAINTENANCE & KIR memblokir peminjaman UPT
// lain — lihat createHeavyEquipmentLoan.
export function heavyEquipmentStatusFromKondisi(kondisi) {
  const s = String(kondisi || "").toUpperCase();
  if (s.includes("PEREMAJAAN") || s.includes("PERBAIKAN") || s.includes("KERUSAKAN") || s.includes("BOCOR")) return "RUSAK";
  if (s.includes("SERVICE")) return "PERLU_SERVICE";
  return "LAYAK";
}

// Migrasi data lama: kode status yang sudah tidak dipakai (BUTUH_PERBAIKAN/BUTUH_PEREMAJAAN
// dari import awal, MAINTENANCE yang sebelumnya sempat disimpan di availabilityStatus)
// dipetakan ke skema statusAlat yang baru supaya data lama tetap tampil benar.
export function normalizeHeavyEquipmentRecord(eq) {
  let statusAlat = eq.statusAlat;
  if (statusAlat === "BUTUH_PERBAIKAN" || statusAlat === "BUTUH_PEREMAJAAN") statusAlat = "RUSAK";
  let availabilityStatus = eq.availabilityStatus;
  if (availabilityStatus === "MAINTENANCE") { statusAlat = "MAINTENANCE"; availabilityStatus = "TERSEDIA"; }
  return { ...eq, statusAlat: statusAlat || "LAYAK", availabilityStatus: availabilityStatus || "TERSEDIA" };
}

export const DEFAULT_HEAVY_EQUIPMENT = HEAVY_EQUIPMENT_RAW.trim().split("\n").map(line => {
  const [id, upt, lokasi, nama, jenis, merkType, kapasitas, nomorSeri, tahun, kondisi, suratIzinAlat] = line.split("|");
  return {
    id, upt, lokasi, nama,
    jenis: normalizeHeavyEquipmentJenis(jenis, nama),
    merkType, kapasitas, nomorSeri, tahun, kondisi,
    statusAlat: heavyEquipmentStatusFromKondisi(kondisi),
    suratIzinAlat,
    foto: null,
    availabilityStatus: "TERSEDIA",
    source: "KAPASITAS GUDANG UIT JBM.xlsx - ALAT ANGKAT ANGKUT",
    createdAt: 1751245200000,
  };
});

export function getHeavyEquipmentLoanOwnerUpt(loan) {
  return loan?.ownerUpt || loan?.fromUpt || loan?.requiredApproverUpt || "";
}

export function getHeavyEquipmentLoanRequesterUpt(loan) {
  return loan?.requesterUpt || loan?.toUpt || "";
}

export function getHeavyEquipmentLoanStartDate(loan) {
  return loan?.tanggalAmbil || loan?.tanggalMulai || "";
}

export function getHeavyEquipmentLoanReturnDate(loan) {
  return loan?.tanggalKembali || loan?.tanggalSelesai || "";
}

export function getHeavyEquipmentLoanJobName(loan) {
  return loan?.namaPekerjaan || loan?.keperluan || "";
}

export function normalizeHeavyEquipmentLoanStatus(status) {
  if (status === "PENDING_ASMAN") return "PENDING_OWNER_ASMAN";
  if (status === "APPROVED") return "DIPINJAM";
  return status || "PENDING_OWNER_ASMAN";
}

export function isPendingHeavyEquipmentLoan(loan) {
  return normalizeHeavyEquipmentLoanStatus(loan?.status) === "PENDING_OWNER_ASMAN";
}

export function getHeavyEquipmentLoanRuntimeStatus(loan, now = Date.now()) {
  const normalized = normalizeHeavyEquipmentLoanStatus(loan?.status);
  if (["SELESAI", "REJECTED", "PENDING_OWNER_ASMAN"].includes(normalized)) return normalized;
  const plannedReturn = getHeavyEquipmentLoanReturnDate(loan);
  if (plannedReturn) {
    const returnEnd = new Date(`${plannedReturn}T23:59:59`).getTime();
    if (!Number.isNaN(returnEnd) && returnEnd < now) return "OVERDUE";
  }
  return normalized;
}

export function canApproveHeavyEquipmentLoan(user, loan) {
  if (user?.role === "SUPERADMIN") return true; // full-access, bypass scope UPT di bawah
  if (user?.role !== "ASMAN") return false;
  const userUpt = getUserUptScope(user);
  // Approval discope ke UNIT PEMINJAM (requesterUpt) — Asman UPT sendiri hanya boleh approve
  // pengajuan peminjaman YANG DIAJUKAN OLEH UPT-nya sendiri, bukan berdasar pemilik alat.
  // Diperketat 2026-07-06: dulu `requesterUpt` kosong/tidak ke-set otomatis dianggap "boleh
  // siapa saja" (deny-by-default jadi allow-by-default) — celah yang bikin Asman UPT lain bisa
  // approve pinjaman yang datanya rusak/tidak lengkap. Sekarang WAJIB match persis.
  const requesterUpt = getHeavyEquipmentLoanRequesterUpt(loan);
  return !!requesterUpt && userUpt === requesterUpt;
}

export function getEquipmentCategory(e) {
  const n = String(e.nama||"").toUpperCase().replace(/\s+/g," ").trim();
  if (n.includes("CRANE")) return "crane";
  if (n.includes("FORKLIFT")) return "forklift";
  if (n.includes("MANLIFT")) return "manlift";
  return "pendukung";
}
