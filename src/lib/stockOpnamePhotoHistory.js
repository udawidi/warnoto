// Scope, mapping, and history helpers for Stock Opname photos.
// Keep these pure so approval/backfill/UI use exactly the same UPT boundary.

export function stockUptId(stock) {
  return stock?.uptId || stock?.upt_id || null;
}

export function itemUptId(opname) {
  return opname?.uptId || opname?.upt_id || null;
}

export function photoUrl(value) {
  return typeof value === "string" && value && !value.startsWith("data:") ? value : null;
}

export function resolveOpnamePhotoTarget(item, stocks, opname) {
  const sessionUptId = itemUptId(opname);
  if (!sessionUptId) return { stock: null, reason: "missing_upt" };
  const list = Array.isArray(stocks) ? stocks : [];
  const exact = item?.stockId ? list.find(stock => String(stock.id) === String(item.stockId)) : null;
  if (exact) {
    return stockUptId(exact) === sessionUptId
      ? { stock: exact, reason: "exact" }
      : { stock: null, reason: "upt_mismatch" };
  }
  const katalogId = item?.katalogId ?? item?.noKatalog;
  if (!katalogId) return { stock: null, reason: "missing_stock" };
  const candidates = list.filter(stock => stockUptId(stock) === sessionUptId && [stock?.katalogId, stock?.katalog]
    .some(value => value != null && String(value) === String(katalogId)));
  if (candidates.length === 1) return { stock: candidates[0], reason: "catalog_unique" };
  return { stock: null, reason: candidates.length > 1 ? "ambiguous" : "missing_stock" };
}

export function photoHistoryOf(stock) {
  return Array.isArray(stock?.photoHistory) ? stock.photoHistory.map(entry => {
    if (!entry || typeof entry !== "object") return entry;
    const { after: _legacyAfter, ...withoutAfter } = entry;
    return withoutAfter;
  }) : [];
}

export function archiveAndPromoteOpnamePhoto(stock, item, opname, at = Date.now()) {
  const target = resolveOpnamePhotoTarget(item, [stock], opname);
  if (!target.stock) return { stock, reason: target.reason, changed: false };
  const uptId = itemUptId(opname);
  const before = {};
  const promoted = {};
  for (const field of ["fotoKeseluruhan", "fotoNameplate"]) {
    const next = photoUrl(item?.[field]);
    if (!next) continue;
    const previous = photoUrl(stock?.[field]);
    if (previous && previous !== next) before[field] = previous;
    promoted[field] = next;
  }
  if (!Object.keys(promoted).length) return { stock, reason: "no_photo", changed: false };
  const entryId = `OPNAME:${uptId}:${opname.id}`;
  const history = photoHistoryOf(stock);
  const previousEntry = history.find(entry => entry?.id === entryId);
  const { after: _ignoredAfter, ...previousWithoutAfter } = previousEntry || {};
  const entry = {
    ...previousWithoutAfter,
    id: entryId,
    source: "OPNAME",
    sourceId: opname.id,
    uptId,
    at: previousEntry?.at ?? at,
    semester: opname.semester || "",
    status: opname.status || "SELESAI",
    before: { ...(previousEntry?.before || {}), ...before },
  };
  // No empty history entry: the promoted photo remains in the stock row and
  // the opname item remains the source for the new photo.
  const nextHistory = Object.keys(entry.before).length || previousEntry
    ? (previousEntry ? history.map(item => item?.id === entryId ? entry : item) : [...history, entry])
    : history;
  const historyChanged = JSON.stringify(nextHistory) !== JSON.stringify(history);
  const photosChanged = Object.entries(promoted).some(([field, value]) => stock?.[field] !== value);
  if (!historyChanged && !photosChanged) {
    return { stock, reason: "already_promoted", changed: false, ocrReset: false };
  }
  const next = { ...stock, photoHistory: nextHistory, updatedAt: at };
  let ocrReset = false;
  for (const field of ["fotoKeseluruhan", "fotoNameplate"]) {
    if (promoted[field]) {
      next[field] = promoted[field];
      if (field === "fotoNameplate" && stock.fotoNameplate !== promoted[field]) {
        next.fotoNameplateOcr = null;
        ocrReset = true;
      }
    }
  }
  return { stock: next, reason: "promoted", changed: JSON.stringify(stock) !== JSON.stringify(next), ocrReset };
}

export function archiveManualPhotoChange(stock, field, nextUrl, at = Date.now()) {
  const next = photoUrl(nextUrl);
  const previous = photoUrl(stock?.[field]);
  if (!next || !previous || previous === next) return stock;
  const uptId = stockUptId(stock);
  if (!uptId) return stock;
  const id = `MANUAL:${uptId}:${stock.id}:${field}:${at}`;
  return {
    ...stock,
    photoHistory: [...photoHistoryOf(stock), {
      id, source: "MANUAL", sourceId: stock.id, uptId, at,
      before: { [field]: previous },
    }],
  };
}

export function listScopedOpnameSessions(stock, opnameList, stocks) {
  const uptId = stockUptId(stock);
  if (!uptId) return [];
  return (Array.isArray(opnameList) ? opnameList : [])
    .filter(opname => itemUptId(opname) === uptId)
    .map(opname => {
      const items = (opname.items || []).map(item => ({ item, ...resolveOpnamePhotoTarget(item, stocks, opname) }));
      const matches = items.filter(row => row.stock?.id === stock.id);
      return matches.length ? { opname, items: matches.map(row => row.item) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.opname.updatedAt || b.opname.dibuatAt || 0) - Number(a.opname.updatedAt || a.opname.dibuatAt || 0));
}
