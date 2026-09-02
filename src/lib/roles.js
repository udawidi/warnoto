// Role & user-scope primitives — dipindah dari App.jsx (refactor Fase 3d).

// Hirarki resmi (keputusan user 2026-08-02):
//   UPT   (lihat 1 UPT sendiri) : ADMIN, TL, ASMAN, MANAGER, MGR_ULTG, ADMIN_ULTG
//   UIT   (lihat semua UPT)     : ADMIN_UIT, ASMAN_LOG_UIT, MGR_LOGISTIK_UIT
//   Pusat (lihat semua UPT+UIT) : ADMIN_LOG_PUSAT
// MANAGER terikat SATU UPT dan BUKAN Pusat.
export const ROLES = { ADMIN: "Admin Gudang", TL: "TL Logistik", ASMAN: "Asman Konstruksi", MANAGER: "Manager", ADMIN_UIT: "Admin UIT", ASMAN_LOG_UIT: "Asman Logistik UIT", MGR_LOGISTIK_UIT: "Manager Logistik UIT", ADMIN_LOG_PUSAT: "Admin Logistik Pusat", PENGADAAN: "Tim Pengadaan", VIEWER: "Viewer", ADMIN_ULTG: "Admin ULTG", MGR_ULTG: "Manager ULTG", SUPERADMIN: "Super Admin" };

export const CAN_CREATE = ["ADMIN", "TL"];

// Jenjang akun untuk tampilan (Kelola Akun) — turunan langsung dari hirarki di atas.
export function roleTier(role) {
  if (role === "ADMIN_LOG_PUSAT") return "PUSAT";
  if (role === "ADMIN_UIT" || role === "ASMAN_LOG_UIT" || role === "MGR_LOGISTIK_UIT") return "UIT";
  if (role === "SUPERADMIN") return "GLOBAL";
  return "UPT";
}

// SUPERADMIN bypass semua gate role-specific (akses & approval lintas UPT/UIT/ULTG) —
// dipakai lewat hasRole() di seluruh App.jsx, bukan dicek manual satu-satu.
export function hasRole(currentUser, ...allowedRoles) {
  return currentUser?.role === "SUPERADMIN" || allowedRoles.includes(currentUser?.role);
}

// Batasan akses per gudang (RBAC tingkat 2). Sumbernya profiles.gudang_ids (jsonb):
// null / undefined / array kosong = boleh SEMUA gudang (perilaku default semua akun
// existing, tidak berubah). Array of string = hanya gudang ber-id itu yang boleh.
export function allowedGudangIds(user) {
  const g = user?.gudangIds;
  if (!Array.isArray(g) || g.length === 0) return null; // null = tak dibatasi (semua boleh)
  return g;
}

export function canAccessGudang(user, gudangId) {
  const allowed = allowedGudangIds(user);
  if (!allowed) return true;            // tidak dibatasi
  if (!gudangId) return true;           // entitas tanpa gudang (belum di-assign) tidak diblok
  return allowed.includes(gudangId);
}

// Pagar isolasi multi-UPT (Gelombang 1, 2026-08-04): dulu fallback ke konstanta UPT global
// (aman selama cuma 1 UPT). Sekarang UPT kedua akan onboarding, jadi fallback harus SADAR
// JUMLAH UPT di uptList — kalau cuma 1 UPT terdaftar, perilaku lama dipertahankan persis;
// begitu ada 2+, akun tanpa upt/uptId eksplisit tidak lagi diam-diam dianggap UPT pertama.
// Nilai yang berasal dari uptList WAJIB dipangkas prefix "UPT " — versi lama memangkasnya
// (`"UPT Surabaya"` -> `"Surabaya"`) dan nilai itulah yang tersimpan di data existing
// (attb_list.upt / heavy_equipment.upt diisi dari fungsi ini, App.jsx:3810). Tanpa pangkas,
// perbandingan `getUserUptScope(user) === item.upt` gagal dan approval ATTB/Alat Berat mati.
export const stripUptPrefix = (s) => (s || "").replace(/^UPT\s+/i, "").trim();

export function getUserUptScope(user, uptList) {
  if (user?.upt || user?.uptName || user?.uptKode) return user.upt || user.uptName || user.uptKode;
  if (user?.uptId) {
    const found = Array.isArray(uptList) ? uptList.find(u => u.id === user.uptId) : null;
    if (found?.nama) return stripUptPrefix(found.nama);
  }
  if (Array.isArray(uptList) && uptList.length === 1) return stripUptPrefix(uptList[0]?.nama);
  return "";
}

// Cakupan UPT yang boleh dilihat akun — sumber tunggal 3-tier untuk SEMUA scoping data
// (stok, alat berat, TUG, approval, Pak War, RAG). Ganti pola lama `hasRole(...global...)`
// yang memperlakukan UIT = nasional. Return:
//   null            = nasional (Pusat/SUPERADMIN): lihat semua UPT tanpa filter
//   array upt id    = UIT: semua UPT di UIT-nya; UPT/ULTG: [uptId sendiri]
// Konvensi filter: pakai inScopeUpt(uptId, scope) — null selalu true.
export function getScopeUptIds(user, uptList) {
  const tier = roleTier(user?.role);
  if (tier === "GLOBAL" || tier === "PUSAT") return null;
  if (tier === "UIT") return (Array.isArray(uptList) ? uptList : []).filter(u => u.uitId === user?.uitId).map(u => u.id);
  return user?.uptId ? [user.uptId] : [];
}

// True kalau uptId masuk cakupan viewer. scope null = nasional (semua lolos).
// uptId kosong (entitas belum di-assign UPT) TIDAK diblok — sama seperti canAccessGudang.
export function inScopeUpt(uptId, scope) {
  if (scope === null || scope === undefined) return true;
  if (!uptId) return true;
  return scope.includes(uptId);
}

// Gate klien untuk tulis katalog (Security fix P1-katalog, opsi B, 2026-08-18) — cermin
// predikat RLS "Operational write katalog" (migration 20260818b): SEMUA role operasional
// boleh, HANYA VIEWER (satu-satunya role read-only) ditolak. Dipakai untuk mencegah
// auto-sync klien memicu write yang toh akan ditolak RLS.
export function bolehTulisKatalog(role) {
  return !!role && role !== "VIEWER";
}
