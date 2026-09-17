// GI shadow rows are valid only when the database has materialized both sides
// of the gudang/lokasi pair. Transaction selectors use this fail-closed filter.
export function dropCachedGiRows(list) {
  return Array.isArray(list) ? list.filter(row => !row?.__gi) : null;
}

export function activeGiRows(list) {
  return (list || []).filter(row => !row?.__gi || row.giActive !== false);
}

export function activePairedGudangRows(gudangList, lokasiList) {
  const activeGiLocations = new Map(
    activeGiRows(lokasiList)
      .filter(row => row?.__gi)
      .map(row => [row.giId || String(row.id || "").replace(/^GILOK-/, ""), row]),
  );

  return (gudangList || []).filter(gudang => {
    if (!gudang?.__gi) return true;
    const giId = gudang.giId || String(gudang.id || "").replace(/^GI-/, "");
    const lokasi = activeGiLocations.get(giId);
    return gudang.id === `GI-${giId}`
      && gudang.giActive !== false
      && lokasi?.id === `GILOK-${giId}`
      && lokasi.gudangId === `GI-${giId}`
      && Boolean(gudang.uptId)
      && Boolean(lokasi.uptId)
      && gudang.uptId === lokasi.uptId;
  });
}
