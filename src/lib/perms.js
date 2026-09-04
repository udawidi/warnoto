// Matrix izin per role (RBAC tingkat 1) — sumber default hardcoded di sini,
// bisa di-override per role lewat tabel Supabase `role_permissions` (jsonb perms).
// DEFAULT_PERMS MEREPLIKASI PERSIS gating role yang berlaku di App.jsx sekarang,
// supaya perilaku tidak berubah sebelum Admin mengubahnya lewat halaman Matrix Izin.
//
// Kunci izin dua kelompok:
//   menu.<id>  — visibilitas menu sidebar utama (id = nilai `tab`/navItems)
//   aksi.<x>   — empat gate aksi lintas-menu

// Menu sidebar utama (id sama persis dengan nilai `tab` di App.jsx).
export const PERM_MENUS = [
  { key: "menu.dashboard", label: "Dashboard" },
  { key: "menu.stock", label: "Data Stok" },
  { key: "menu.kapasitasGudang", label: "Kapasitas Gudang" },
  { key: "menu.master", label: "Master Data" },
  { key: "menu.transaction", label: "TUG" },
  { key: "menu.approval", label: "Approval" },
  { key: "menu.heavyEquipment", label: "Alat Berat" },
  { key: "menu.attb", label: "MRWI" },
  { key: "menu.opname", label: "Stock Opname & Count" },
  { key: "menu.maturity", label: "Penilaian Maturity" },
  { key: "menu.rencana", label: "Rencana Kedatangan" },
  { key: "menu.forecastStok", label: "Forecast Stok" },
  { key: "menu.inspeksiMaterial", label: "Inspeksi Material Cadang" },
  { key: "menu.ai", label: "Pak War (AI)" },
  { key: "menu.integrasiApi", label: "Integrasi API" },
  { key: "menu.lacakAlat", label: "Lacak Alat" },
  { key: "menu.riwayatOperator", label: "Riwayat Operator" },
  { key: "menu.profilOperator", label: "Profil Operator" },
];

export const PERM_AKSI = [
  { key: "aksi.buatTransaksi", label: "Buat Transaksi TUG" },
  { key: "aksi.kelolaMaster", label: "Kelola Master Data" },
  { key: "aksi.import", label: "Import Data (Excel)" },
  { key: "aksi.kelolaAkun", label: "Kelola Akun" },
  { key: "aksi.migrasiData", label: "Migrasi Data SAP/Non-SAP" },
  { key: "aksi.buatInspeksiMaterial", label: "Buat Inspeksi Material Cadang" },
  { key: "aksi.kelolaApiIntegrasi", label: "Kelola API Integrasi" },
];

// Urutan role sebagai kolom di halaman Matrix Izin. SUPERADMIN read-only (selalu true).
export const MATRIX_ROLES = [
  "SUPERADMIN", "ADMIN", "TL", "ASMAN", "MANAGER",
  "ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT", "ADMIN_LOG_PUSAT",
  "PENGADAAN", "VIEWER", "ADMIN_ULTG", "MGR_ULTG", "OPERATOR", "RENEV",
];

// Helper: {menu.a:true, menu.b:true, ...} — hanya kunci true yang dicantumkan,
// kunci yang tidak ada otomatis dianggap false (lihat can()).
function menus(...ids) {
  const o = {};
  ids.forEach(i => { o["menu." + i] = true; });
  return o;
}

const FULL_MENUS = menus(
  "dashboard", "stock", "kapasitasGudang", "master", "transaction", "approval",
  "heavyEquipment", "attb", "opname", "maturity", "rencana", "forecastStok", "inspeksiMaterial", "ai"
);

// Default per role — turunan langsung dari gating hardcoded App.jsx:
//   navItems (3 cabang: pengadaan / ULTG / normal), kondisi menu approval,
//   CAN_CREATE (buat transaksi), hasRole("ADMIN") (master CRUD/import/akun).
export const DEFAULT_PERMS = {
  // ULTG create (TUG-5) tetap lewat jalur canCreateULTG terpisah di App.jsx,
  // jadi aksi.buatTransaksi ADMIN_ULTG sengaja false di sini (perilaku tak berubah).
  // ADMIN diturunkan jadi vendor security (2026-08-12): cuma ajukan TUG + upload
  // foto stok + pindah blok — TANPA menu master/approval/opname/rencana/maturity/
  // inspeksiMaterial/attb, TANPA aksi kelola apa pun. Edit/Hapus/kelola pindah ke TL.
  ADMIN: { ...menus("dashboard", "stock", "transaction", "forecastStok", "heavyEquipment", "kapasitasGudang", "ai"), "aksi.buatTransaksi": true },
  TL: { ...FULL_MENUS, "menu.integrasiApi": true, "aksi.buatTransaksi": true, "aksi.kelolaMaster": true, "aksi.import": true, "aksi.kelolaAkun": true, "aksi.buatInspeksiMaterial": true, "aksi.migrasiData": true, "aksi.kelolaApiIntegrasi": true },
  ASMAN: { ...FULL_MENUS, "aksi.migrasiData": true },
  MANAGER: { ...FULL_MENUS, "aksi.migrasiData": true },
  ADMIN_UIT: { ...FULL_MENUS },
  // Peninjau UIT & Pusat: lihat semua menu, TANPA aksi.* (peninjau, bukan pembuat
  // data). Entri ini WAJIB ada — can() mengembalikan false untuk role yang tidak
  // terdaftar, jadi tanpa ini akunnya membuka aplikasi tanpa satu menu pun.
  ASMAN_LOG_UIT: { ...FULL_MENUS },
  MGR_LOGISTIK_UIT: { ...FULL_MENUS },
  ADMIN_LOG_PUSAT: { ...FULL_MENUS },
  // VIEWER: cabang normal TANPA menu approval.
  VIEWER: menus("dashboard", "stock", "kapasitasGudang", "master", "transaction", "heavyEquipment", "attb", "opname", "rencana", "forecastStok", "inspeksiMaterial", "ai"),
  PENGADAAN: menus("dashboard", "rencana"),
  ADMIN_ULTG: menus("dashboard", "stock", "kapasitasGudang", "transaction", "approval", "heavyEquipment", "rencana", "forecastStok", "ai"),
  MGR_ULTG: menus("dashboard", "stock", "kapasitasGudang", "transaction", "approval", "heavyEquipment", "rencana", "forecastStok", "ai"),
  SUPERADMIN: { ...FULL_MENUS, "aksi.buatTransaksi": true, "aksi.kelolaMaster": true, "aksi.import": true, "aksi.kelolaAkun": true },
  // OPERATOR (Live Location Alat Berat, batch 2): layar tunggal bersih di HP —
  // HANYA Lacak Alat + Profil, nol menu lain, nol aksi.* (tak boleh sentuh master/stok).
  OPERATOR: menus("lacakAlat", "riwayatOperator", "profilOperator"),
  // RENEV (Perencanaan): reservasi material (TUG-5) saja, plus menu baca dasar —
  // sub-tab TUG di-clamp ke TUG5 di App.jsx via RESERVASI_ONLY_ROLES.
  RENEV: { ...menus("dashboard", "stock", "kapasitasGudang", "transaction", "rencana", "forecastStok", "ai"), "aksi.buatTransaksi": true },
};

// Cek izin efektif: SUPERADMIN selalu true; override role dari DB menang;
// jika tak ada override, fallback ke default; jika tak ada juga → false.
export function can(user, key, overrides) {
  if (!user) return false;
  if (user.role === "SUPERADMIN") return true;
  const ov = overrides?.[user.role];
  if (ov && Object.prototype.hasOwnProperty.call(ov, key)) return !!ov[key];
  return DEFAULT_PERMS[user.role]?.[key] ?? false;
}

// Nilai efektif untuk tampilan matrix (dipakai sebagai nilai awal checkbox).
export function effectivePerm(role, key, overrides) {
  if (role === "SUPERADMIN") return true;
  const ov = overrides?.[role];
  if (ov && Object.prototype.hasOwnProperty.call(ov, key)) return !!ov[key];
  return DEFAULT_PERMS[role]?.[key] ?? false;
}

export function defaultPerm(role, key) {
  if (role === "SUPERADMIN") return true;
  return DEFAULT_PERMS[role]?.[key] ?? false;
}
