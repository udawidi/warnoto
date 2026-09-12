export const MTU_KHS_LIFECYCLE = ["VENDOR", "IN_TRANSIT", "WAREHOUSE", "ON_SITE", "INSTALLED", "CANCELLED"];
export const MTU_KHS_LIFECYCLE_LABEL = {
  VENDOR: "Vendor / Pabrik",
  IN_TRANSIT: "Dalam Pengiriman",
  WAREHOUSE: "Gudang / Blok",
  ON_SITE: "Onsite GI",
  INSTALLED: "Terpasang",
  CANCELLED: "Dibatalkan",
};
export const MTU_KHS_DOCUMENT_TYPES = ["DRAWING", "CATALOG", "TPG", "TYPE_TEST", "SCHEMATIC", "NAMEPLATE", "OTHER"];
export const MTU_KHS_DRAWING_FOLDERS = {
  UNINDO: "https://drive.google.com/drive/folders/1ITLAMr8wipKTdWviLYRofmAK9b_97yw8",
  HITACHI: "https://drive.google.com/drive/folders/12rpCqQw0OLsMXk3diBempEAtqBdjmG8P",
  TWINK: "https://drive.google.com/drive/folders/1rs8N9pPXxC0DXF3HMwOkUY2OURnm_rYo",
};

const asText = value => String(value ?? "").replace(/\s+/g, " ").trim();

export function normalizeMtuText(value) {
  return asText(value).replace(/[–—−]/g, "-").toUpperCase();
}

export function normalizeMtuCode(value) {
  return normalizeMtuText(value).replace(/^S\s*-\s*/, "").replace(/\s+/g, "-");
}

export function normalizeMtuYear(value) {
  const match = String(value ?? "").match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

export function physicalQuantity(record) {
  if (normalizeMtuText(record?.sifatPekerjaan || record?.sifat_pekerjaan) === "SUPERVISI") return 0;
  const value = Number(record?.qty ?? record?.jumlah ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function normalizeMtuRecord(record = {}) {
  const year = normalizeMtuYear(record.procurementYear ?? record.tahunPengadaan ?? record.tahun);
  const qty = physicalQuantity(record);
  const sifat = normalizeMtuText(record.sifatPekerjaan || record.sifat_pekerjaan) === "SUPERVISI" ? "SUPERVISI" : "MATERIAL";
  return {
    ...record,
    procurementYear: year,
    year,
    sifatPekerjaan: sifat,
    qty,
    physicalQty: sifat === "SUPERVISI" ? 0 : qty,
    lifecycleStatus: MTU_KHS_LIFECYCLE.includes(record.lifecycleStatus) ? record.lifecycleStatus : "VENDOR",
    mtuCode: normalizeMtuCode(record.mtuCode || record.jenisMtu || record.jenis_mtu || record.codeRfq),
    vendor: asText(record.vendor || record.provider || record.penyedia),
  };
}

export function validateMtuRecord(record, { requireMappings = true } = {}) {
  const errors = [];
  const normalized = normalizeMtuRecord(record);
  const rawQty = Number(record?.qty ?? record?.jumlah ?? 0);
  if (!normalized.procurementYear) errors.push("Tahun pengadaan belum valid");
  if (!normalized.uptId && requireMappings) errors.push("UPT belum dipetakan ke UPT_ID");
  if (normalized.giName && !normalized.garduIndukId && !normalized.gudangId && requireMappings) errors.push("GI belum dipetakan ke master GI");
  if (Number.isFinite(rawQty) && rawQty < 0) errors.push("Qty tidak boleh negatif");
  if (!normalized.sifatPekerjaan) errors.push("Sifat pekerjaan belum valid");
  return { valid: errors.length === 0, errors, record: normalized };
}

export function sameYearDrawing(record, document) {
  if (!record || !document || document.documentType !== "DRAWING" || !document.url) return false;
  return normalizeMtuYear(record.procurementYear ?? record.year) === normalizeMtuYear(document.procurementYear ?? document.year)
    && normalizeMtuText(record.vendor) === normalizeMtuText(document.vendor)
    && normalizeMtuCode(record.mtuCode) === normalizeMtuCode(document.mtuCode);
}

export function resolveMtuScope(user, uptList = []) {
  const role = user?.role;
  if (["SUPERADMIN", "ADMIN_LOG_PUSAT", "PENGADAAN"].includes(role)) return null;
  if (["ADMIN_UIT", "ASMAN_LOG_UIT", "MGR_LOGISTIK_UIT"].includes(role)) {
    return uptList.filter(item => item.uitId === user?.uitId).map(item => item.id);
  }
  return user?.uptId ? [user.uptId] : [];
}

export function canAccessMtuRecord(record, user, uptList = []) {
  const scope = resolveMtuScope(user, uptList);
  return scope === null ? !!record?.uptId : !!record?.uptId && scope.includes(record.uptId);
}

export function filterMtuRecords(records, user, uptList = []) {
  return (records || []).filter(record => canAccessMtuRecord(record, user, uptList));
}

export function isMtuNationalRole(user) {
  return ["SUPERADMIN", "ADMIN_LOG_PUSAT", "PENGADAAN"].includes(user?.role);
}
