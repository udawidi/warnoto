// GI shadow rows are valid only when the database has materialized both sides
// of the gudang/lokasi pair. Transaction selectors use this fail-closed filter.
export function dropCachedGiRows(list) {
  if (!Array.isArray(list)) return null;
  // E2E preview only: fixture shadow rows are safe to expose in the isolated
  // Vite profile. Production and normal development remain fail-closed.
  const fixturePreview = import.meta.env?.DEV && import.meta.env?.MODE === "e2e";
  return list.filter(row => !row?.__gi || (fixturePreview && row.__giFixture === true));
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
