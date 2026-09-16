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

const normalizeIdentity = value => String(value || "").trim().toUpperCase();
const userUptId = user => user?.uptId || user?.upt_id || null;

export function parseStockOpnamePidRefs(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,;\n]+/);
  return [...new Set(raw.map(item => String(item || "").trim()).filter(Boolean))];
}

function identityPerson(user) {
  if (!user) return null;
  const name = String(user.name || user.nama || "").trim();
  const position = String(user.jabatan || user.position || user.role || "").trim();
  if (!name && !position) return null;
  return { userId: user.id || user.userId || null, name, position, uptId: userUptId(user) };
}

export function normalizeStockOpnamePerson(person, fallbackUptId = null) {
  if (!person) return null;
  const name = String(person.name || person.nama || "").trim();
  const position = String(person.position || person.jabatan || person.role || "").trim();
  return {
    userId: person.userId || person.id || null,
    name,
    position,
    uptId: userUptId(person) || fallbackUptId || null,
  };
}

function dedupePeople(people) {
  const seen = new Set();
  return people.filter(person => {
    if (!person) return false;
    const key = person.userId ? `id:${person.userId}` : `person:${normalizeIdentity(person.name)}|${normalizeIdentity(person.position)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

export function resolveStockOpnameDocumentIdentity({ opn = {}, users = [], uptList = [], gudangList = [], currentUser = null, childList = [], selectedUptId = null } = {}) {
  const people = Array.isArray(users) ? users : [];
  const creator = people.find(user => user.id === (opn.dibuatOleh || opn.createdBy)) || currentUser || null;
  const gudang = gudangList.find(item => item.id === opn.gudangId);
  const sources = [
    ["sesi", opn.uptId || opn.upt_id],
    ["gudang", gudang?.uptId || gudang?.upt_id],
    ["pembuat", userUptId(creator)],
  ].filter(([, value]) => value);
  const distinctUptIds = [...new Set(sources.map(([, value]) => String(value)))];
  const errors = [];
  if (!distinctUptIds.length) errors.push("UPT sesi tidak dapat ditentukan.");
  const selected = selectedUptId ? String(selectedUptId) : null;
  if (selected && !distinctUptIds.includes(selected)) errors.push(`UPT pilihan ${selected} tidak termasuk sumber sesi.`);
  if (distinctUptIds.length > 1 && !selected) errors.push(`Konflik UPT sumber: ${distinctUptIds.join(", ")}. Pilih UPT yang benar.`);
  const uptId = selected && distinctUptIds.includes(selected) ? selected : (distinctUptIds.length === 1 ? distinctUptIds[0] : null);
  const upt = uptList.find(item => String(item.id) === String(uptId)) || null;
  if (uptId && Array.isArray(uptList) && uptList.length && !upt) errors.push(`UPT ${uptId} tidak ditemukan pada master UPT.`);
  const managers = uptId
    ? people.filter(user => normalizeIdentity(user.role) === "MANAGER" && String(userUptId(user)) === String(uptId))
    : [];
  if (managers.length !== 1) errors.push(`Harus ada tepat satu Manager pada UPT${uptId ? ` ${uptId}` : ""}; ditemukan ${managers.length}.`);
  const defaults = [
    creator && String(userUptId(creator)) === String(uptId) ? creator : null,
    people.find(user => normalizeIdentity(user.role) === "TL" && String(userUptId(user)) === String(uptId)),
    people.find(user => normalizeIdentity(user.role) === "ASMAN" && String(userUptId(user)) === String(uptId)),
  ];
  const examiners = dedupePeople(defaults.map(identityPerson));
  const children = Array.isArray(childList) ? childList.filter(child => childOpnameMatches(child, opn)) : [];
  const child = children.find(item => item.status === "SELESAI") || null;
  const childWarning = children.length > 0 && !child ? "Child Non-SAP belum selesai; paket SAP tetap dapat dicetak." : (!children.length && opn.jenisAlur === "SAP" ? "Child Non-SAP belum ada; paket SAP tetap dapat dicetak." : "");
  return { ok: errors.length === 0, errors, sources, candidateUptIds: distinctUptIds, uptId, upt, manager: identityPerson(managers[0]), examiners, child, childCandidates: children, childWarning };
}

export function buildStockOpnameDocumentMeta({ identity, tanggal, pidRefs, examiners, manager, savedAt = new Date().toISOString(), savedBy = null } = {}) {
  const resolvedManager = normalizeStockOpnamePerson(manager || identity?.manager, identity?.uptId);
  const resolvedExaminers = dedupePeople((examiners || identity?.examiners || []).map(person => normalizeStockOpnamePerson(person, identity?.uptId)));
  return {
    version: 1,
    tanggal: String(tanggal || "").trim(),
    pidRefs: parseStockOpnamePidRefs(pidRefs),
    examiners: resolvedExaminers,
    manager: resolvedManager,
    savedAt,
    savedBy: savedBy || null,
  };
}
