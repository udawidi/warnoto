export const CAPACITY_COMPOSITION_KEYS = ["persediaanPct", "cadangPct", "preMemoryPct", "attbPct", "lainnyaPct"];
const EPSILON = 0.000001;

export function deriveWarehouseCapacity({ luasLahanM2, ...value }) {
  const land = Number(luasLahanM2) || 0;
  const total = CAPACITY_COMPOSITION_KEYS.reduce((sum, key) => sum + (Number(value[key]) || 0), 0);
  const used = land * total;
  return {
    luasTerpakaiM2: used,
    sisaLuasM2: land - used,
    persentaseTerpakai: land > 0 ? total : 0,
  };
}

export function validateWarehouseCapacity(value = {}) {
  const land = Number(value.luasLahanM2);
  const errors = [];
  if (!Number.isFinite(land) || land < 0) errors.push("Luas lahan tidak boleh negatif.");
  const total = CAPACITY_COMPOSITION_KEYS.reduce((sum, key) => {
    const n = Number(value[key] ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 1) errors.push(`${key} harus antara 0% dan 100%.`);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  if (total > 1 + EPSILON) errors.push(`Total komposisi ${(total * 100).toFixed(2)}% melebihi 100%.`);
  if (land === 0 && total > EPSILON) errors.push("Luas lahan 0 hanya menerima total komposisi 0%.");
  return { valid: errors.length === 0, errors, total, warning: "" };
}
