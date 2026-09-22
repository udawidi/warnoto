// Photo boundary for Stock Opname. The caller supplies the Storage uploader so
// this helper stays independent of React and can be verified without a browser.
export async function normalizeOpnamePhotos(opn, uploadStockFoto) {
  const sessionUptId = opn?.uptId || opn?.upt_id;
  const items = [...(opn?.items || [])];
  let changed = false;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    for (const field of ["fotoKeseluruhan", "fotoNameplate"]) {
      const value = item?.[field];
      if (typeof value !== "string" || !value.startsWith("data:")) continue;
      if (!sessionUptId) throw new Error("Sesi opname tidak memiliki UPT. Foto tidak disimpan.");
      const katalogId = item.katalogId || item.noKatalog || item.stockId;
      if (!katalogId) throw new Error(`Foto ${field} tidak memiliki identitas material.`);
      items[index] = { ...items[index], [field]: await uploadStockFoto(katalogId, field, value, sessionUptId) };
      changed = true;
    }
  }
  return changed ? { ...opn, items } : opn;
}
