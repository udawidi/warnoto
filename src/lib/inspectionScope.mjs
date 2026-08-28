// Scope helpers khusus Inspeksi Material Cadang. Semua fungsi deny-by-default
// untuk user scoped; SUPERADMIN adalah satu-satunya bypass lintas UPT.

function hasAllowedGudang(user, gudangId) {
  const ids = user?.gudangIds;
  return !Array.isArray(ids) || ids.length === 0 || ids.includes(gudangId);
}

// Tier nasional: SUPERADMIN (global) + ADMIN_LOG_PUSAT (PLN Pusat) — lihat semua gudang lintas UPT.
function isNationalRole(user) {
  return user?.role === "SUPERADMIN" || user?.role === "ADMIN_LOG_PUSAT";
}

export function getVisibleGudangForInspection({ currentUser, currentUserUptId, gudangList = [], uptList = [] }) {
  if (isNationalRole(currentUser)) return gudangList;

  const isUitScoped = !!currentUser?.uitId && !currentUser?.uptId && !currentUser?.ultgId;
  return gudangList.filter(gudang => {
    if (!hasAllowedGudang(currentUser, gudang.id)) return false;
    if (isUitScoped) return uptList.some(upt => upt.id === gudang.uptId && upt.uitId === currentUser.uitId);
    return !!currentUserUptId && gudang.uptId === currentUserUptId;
  });
}

export function getInspectionScope({
  currentUser,
  currentUserUptId,
  gudangList = [],
  lokasiList = [],
  stocks = [],
  materialInspectionBatches = [],
  uptList = [],
}) {
  const scopedGudangList = getVisibleGudangForInspection({ currentUser, currentUserUptId, gudangList, uptList });
  const scopedGudangIds = new Set(scopedGudangList.map(gudang => gudang.id));
  const scopedGudangUptById = new Map(scopedGudangList.map(gudang => [gudang.id, gudang.uptId]));
  const scopedLokasiList = lokasiList.filter(lokasi => scopedGudangIds.has(lokasi.gudangId));
  const scopedLokasiIds = new Set(scopedLokasiList.map(lokasi => lokasi.id));
  const isNational = isNationalRole(currentUser);

  return {
    gudangList: scopedGudangList,
    lokasiList: scopedLokasiList,
    stocks: stocks.filter(stock => scopedLokasiIds.has(stock.lokasiId)),
    materialInspectionBatches: materialInspectionBatches.filter(batch =>
      isNational || scopedGudangUptById.get(batch?.gudangId) === batch?.uptId
    ),
  };
}

export function getInspectionIdentity({ currentUser, currentUserUptId, uptList = [], users = [] }) {
  const upt = uptList.find(item => item.id === currentUserUptId) || null;
  const manager = users.find(user => user?.role === "MANAGER" && user?.uptId === currentUserUptId)
    || (currentUser?.role === "MANAGER" && currentUser?.uptId === currentUserUptId ? currentUser : null);

  return {
    uptId: currentUserUptId || "",
    namaUpt: upt?.nama || currentUser?.upt || "UPT",
    managerUpt: manager?.name || "Belum ditetapkan",
  };
}
