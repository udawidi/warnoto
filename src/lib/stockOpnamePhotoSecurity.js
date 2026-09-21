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

// Foto bukti opname wajib berasal dari bucket self-host, bukan data URL atau host luar.
export function isValidOpnamePhotoUrl(value) {
  return typeof value === "string"
    && /^https:\/\/warnoto\.com\/storage\/v1\/object\/(?:public|sign|authenticated)\/stock-photos\//i.test(value);
}

export function missingRequiredOpnamePhotos(opn) {
  return (opn?.items || []).map((item, index) => ({ item, index }))
    .filter(({ item }) => Number(item?.qtsFisik) > 0 && !isValidOpnamePhotoUrl(item?.fotoKeseluruhan));
}
