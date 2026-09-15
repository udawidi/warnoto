export const SAP_OPNAME_CATEGORIES = ["Cadang", "Persediaan", "Pre Memory"];

const normalize = value => String(value || "").toLowerCase().replace(/[-\u2013\u2014]/g, " ").replace(/\s+/g, " ").trim();

export function getSapOpnameCategory(label) {
  const value = normalize(label);
  if (!value || value.includes("non sap")) return null;
  if (value.includes("pre memory") || value.includes("prememory")) return "Pre Memory";
  if (value.includes("cadang")) return "Cadang";
  if (value.includes("persediaan") && !value.includes("bursa")) return "Persediaan";
  return null;
}

export function isSapOpnameItem(item) {
  return SAP_OPNAME_CATEGORIES.includes(getSapOpnameCategory(item?.sapCategory || item?.sapLabel || item?.jenisBarang));
}

function counted(item) {
  if (item?.qtsFisik !== null && item?.qtsFisik !== undefined && item?.qtsFisik !== "") return true;
  const rows = item?.hitungPerLokasi;
  return !!rows && Object.keys(rows).length > 0 && Object.values(rows).every(row => row?.at != null);
}

export function opnameProgress(items = [], category = null) {
  const scoped = category ? items.filter(item => getSapOpnameCategory(item?.sapCategory || item?.sapLabel) === category) : items;
  const total = scoped.length;
  const filled = scoped.filter(counted).length;
  return { filled, total, pct: total ? Math.round((filled / total) * 100) : 0 };
}

export function childOpnameMatches(child, parent) {
  return !!child && !!parent && parent.flowVersion === 2 && parent.jenisAlur === "SAP"
    && child.jenisAlur === "NON_SAP"
    && child.sourceSapOpnameId === parent.id
    && child.gudangId === parent.gudangId
    && child.semester === parent.semester;
}
