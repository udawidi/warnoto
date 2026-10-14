export function resolveEffectiveUptId(stock, lokasiById = new Map(), gudangById = new Map()) {
  const direct = String(stock?.upt_id || stock?.data?.uptId || "").trim();
  if (direct) return direct;
  const lokasiId = stock?.lokasi_id || stock?.data?.lokasiId || stock?.data?.lokasi_id;
  const lokasi = lokasiById.get(String(lokasiId || ""));
  const gudangId = lokasi?.gudang_id || lokasi?.data?.gudangId || lokasi?.data?.gudang_id;
  const gudang = gudangById.get(String(gudangId || ""));
  return String(gudang?.upt_id || gudang?.data?.uptId || gudang?.data?.upt_id || "").trim();
}

export function isPermanentCohere429(error) {
  if (error?.status !== 429) return false;
  const message = String(error?.message || "").toLowerCase();
  return /trial|quota|monthly|credit|billing|exhaust|limit.*(month|credit)/.test(message);
}

export function chunkValues(values, size = 50) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}
