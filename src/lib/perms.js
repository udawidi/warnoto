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
  { key: "menu.attb", label: "ATTB" },
  { key: "menu.opname", label: "Stock Opname & Count" },
  { key: "menu.rencana", label: "Rencana Kedatangan" },
  { key: "menu.forecastStok", label: "Forecast Stok" },
  { key: "menu.ai", label: "Pak War (AI)" },
  { key: "menu.maturity", label: "Maturity Audit" },
  { key: "menu.inspeksiMaterial", label: "Inspeksi Material" },
];

export const PERM_AKSI = [
  { key: "aksi.buatTransaksi", label: "Buat Transaksi TUG" },
  { key: "aksi.kelolaMaster", label: "Kelola Master Data" },
  { key: "aksi.import", label: "Import Data (Excel)" },
  { key: "aksi.kelolaAkun", label: "Kelola Akun" },
];

// Urutan role sebagai kolom di halaman Matrix Izin. SUPERADMIN read-only (selalu true).
export const MATRIX_ROLES = [
  "SUPERADMIN", "ADMIN", "TL", "ASMAN", "MANAGER",
  "ADMIN_UIT", "MGR_LOGISTIK_UIT", "PENGADAAN", "VIEWER", "ADMIN_ULTG", "MGR_ULTG",
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
  "heavyEquipment", "attb", "opname", "rencana", "forecastStok", "ai", "maturity", "inspeksiMaterial"
);

// Default per role — turunan langsung dari gating hardcoded App.jsx:
//   navItems (3 cabang: pengadaan / ULTG / normal), kondisi menu approval,
//   CAN_CREATE (buat transaksi), hasRole("ADMIN") (master CRUD/import/akun).
export const DEFAULT_PERMS = {
  // ULTG create (TUG-5) tetap lewat jalur canCreateULTG terpisah di App.jsx,
  // jadi aksi.buatTransaksi ADMIN_ULTG sengaja false di sini (perilaku tak berubah).
  ADMIN: { ...FULL_MENUS, "aksi.buatTransaksi": true, "aksi.kelolaMaster": true, "aksi.import": true, "aksi.kelolaAkun": true },
  TL: { ...FULL_MENUS, "aksi.buatTransaksi": true, "aksi.import": true },
  ASMAN: { ...FULL_MENUS },
  MANAGER: { ...FULL_MENUS },
  ADMIN_UIT: { ...FULL_MENUS },
  MGR_LOGISTIK_UIT: { ...FULL_MENUS },
  // VIEWER: cabang normal TANPA menu approval.
  VIEWER: menus("dashboard", "stock", "kapasitasGudang", "master", "transaction", "heavyEquipment", "attb", "opname", "rencana", "forecastStok", "ai", "maturity", "inspeksiMaterial"),
  PENGADAAN: menus("dashboard", "rencana"),
  ADMIN_ULTG: menus("dashboard", "stock", "kapasitasGudang", "transaction", "approval", "heavyEquipment", "rencana", "forecastStok", "ai"),
  MGR_ULTG: menus("dashboard", "stock", "kapasitasGudang", "transaction", "approval", "heavyEquipment", "rencana", "forecastStok", "ai"),
  SUPERADMIN: { ...FULL_MENUS, "aksi.buatTransaksi": true, "aksi.kelolaMaster": true, "aksi.import": true, "aksi.kelolaAkun": true },
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
