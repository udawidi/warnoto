export const TUG_ROUTE_DEFAULTS = {
  penerimaan: "TUG3",
  pengeluaran: "TUG9",
  permintaan: "TUG5",
  laporan: "TUG15",
};

export const TUG_ROUTE_OPTIONS = {
  penerimaan: ["TUG3", "TUG10"],
  pengeluaran: ["TUG9", "TUG8"],
  permintaan: ["TUG5"],
  laporan: ["TUG15"],
};

export function readTugRoute() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem("warnoto_tug_route") || "null");
    const group = parsed?.group;
    const subtab = parsed?.subtab;
    if (TUG_ROUTE_OPTIONS[group]?.includes(subtab)) return { group, subtab };
  } catch {}
  return { group: "penerimaan", subtab: "TUG3" };
}

export function writeTugRoute(group, subtab) {
  if (!TUG_ROUTE_OPTIONS[group]?.includes(subtab)) return;
  try { sessionStorage.setItem("warnoto_tug_route", JSON.stringify({ group, subtab })); } catch {}
}
