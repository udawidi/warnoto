export const MTU_KHS_LIFECYCLE = ["VENDOR", "IN_TRANSIT", "WAREHOUSE", "ON_SITE", "INSTALLED", "PLANNED_ARRIVAL", "CANCELLED"];
export const MTU_KHS_LIFECYCLE_LABEL = {
  VENDOR: "Vendor / Pabrik",
  IN_TRANSIT: "Dalam Pengiriman",
  WAREHOUSE: "Gudang / Blok",
  ON_SITE: "Onsite GI",
  INSTALLED: "Terpasang",
  PLANNED_ARRIVAL: "Rencana Kedatangan",
  CANCELLED: "Dibatalkan",
};
export const MTU_KHS_DOCUMENT_TYPES = ["DRAWING", "CATALOG", "TPG", "TYPE_TEST", "SCHEMATIC", "NAMEPLATE", "OTHER"];
export const MTU_KHS_DRAWING_FOLDERS = {
  UNINDO: "https://drive.google.com/drive/folders/1ITLAMr8wipKTdWviLYRofmAK9b_97yw8",
  HITACHI: "https://drive.google.com/drive/folders/12rpCqQw0OLsMXk3diBempEAtqBdjmG8P",
  TWINK: "https://drive.google.com/drive/folders/1rs8N9pPXxC0DXF3HMwOkUY2OURnm_rYo",
};

const asText = value => String(value ?? "").replace(/\s+/g, " ").trim();
const asOriginalText = value => String(value ?? "").trim();

const MONTHS = {
  JANUARY: 1, JAN: 1, JANUARI: 1, FEBRUARY: 2, FEB: 2, FEBRUARI: 2,
  MARCH: 3, MAR: 3, MARET: 3, APRIL: 4, APR: 4, MAY: 5, MEI: 5,
  JUNE: 6, JUN: 6, JUNI: 6, JULY: 7, JUL: 7, JULI: 7,
  AUGUST: 8, AUG: 8, AGUSTUS: 8, SEPTEMBER: 9, SEP: 9, SEPT: 9,
  OCTOBER: 10, OCT: 10, OKT: 10, OKTOBER: 10, NOVEMBER: 11, NOV: 11,
  DECEMBER: 12, DEC: 12, DES: 12, DESEMBER: 12,
};

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

function parseDateToken(token) {
  const value = asText(token).replace(/[–—−]/g, "-").toUpperCase();
  let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) return validDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = value.match(/^(\d{1,2})\s+([A-ZÀ-Ÿ]+)\s*(\d{4})?$/);
  return match && match[3] ? validDate(Number(match[3]), MONTHS[match[2]], Number(match[1])) : null;
}

export function parseMtuDates(value) {
  const original = asOriginalText(value);
  if (!original || original === "-") return { original: "", dates: [], last: "" };
  const tokenPattern = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b|\b\d{1,2}\s+[A-Za-zÀ-ÿ]+(?:\s*20\d{2})?\b/gi;
  const dates = [];
  for (const match of original.matchAll(tokenPattern)) {
    let token = match[0];
    if (!/20\d{2}/.test(token) && !/^\d{4}[-/]/.test(token)) {
      const inferredYear = original.slice(match.index).split(/\r?\n/, 1)[0].match(/20\d{2}/)?.[0];
      if (inferredYear) token = `${token} ${inferredYear}`;
    }
    const date = parseDateToken(token);
    if (date && !dates.includes(date)) dates.push(date);
  }
  return { original, dates, last: dates.at(-1) || "" };
}

function numericValue(value) {
  if (value === "" || value == null || value === "-") return null;
  const number = Number(String(value).replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

export function jakartaTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function deriveMtuLifecycle(record = {}, { now = new Date() } = {}) {
  const year = normalizeMtuYear(record.procurementYear ?? record.year ?? record.tahun);
  if (year === 2026) return "PLANNED_ARRIVAL";
  const qty = physicalQuantity(record);
  const installedQty = numericValue(record.installedQty ?? record.jumlahTerpasang);
  const remainingQty = numericValue(record.remainingQty ?? record.sisa);
  const installation = parseMtuDates(record.installationDate || record.tanggalTerpasang || record.installationDates?.join("\n"));
  const onsite = parseMtuDates(record.onsiteDate || record.tanggalOnsite || record.onsiteDates?.join("\n"));
  if ((installedQty != null && installedQty >= qty && qty > 0) || (installedQty != null && installedQty > 0 && remainingQty != null && remainingQty <= 0) || (installation.last && installedQty == null && remainingQty == null)) return "INSTALLED";
  if (installation.last || (installedQty != null && installedQty > 0) || (remainingQty != null && remainingQty < qty && qty > 0)) return "ON_SITE";
  if (onsite.last) return onsite.last <= jakartaTodayIso(now) ? "ON_SITE" : "PLANNED_ARRIVAL";
  return "VENDOR";
}

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
  const onsite = parseMtuDates(record.onsiteDate || record.tanggalOnsite || record.rawData?.["TANGGAL MATERIAL ON SITE"]);
  const installation = parseMtuDates(record.installationDate || record.tanggalTerpasang || record.rawData?.["REALISASI PASANG"]);
  const installedQty = numericValue(record.installedQty ?? record.jumlahTerpasang ?? record.rawData?.["JUMLAH TERPASANG"]);
  const remainingQty = numericValue(record.remainingQty ?? record.sisa ?? record.rawData?.SISA);
  const enriched = {
    ...record,
    procurementYear: year,
    year,
    sifatPekerjaan: sifat,
    qty,
    physicalQty: sifat === "SUPERVISI" ? 0 : qty,
    onsiteDate: onsite.last,
    onsiteDates: onsite.dates,
    onsiteDateOriginal: record.onsiteDateOriginal || onsite.original,
    installationDate: installation.last,
    installationDates: installation.dates,
    installationDateOriginal: record.installationDateOriginal || installation.original,
    installedQty,
    remainingQty,
    lifecycleStatus: MTU_KHS_LIFECYCLE.includes(record.lifecycleStatus) ? record.lifecycleStatus : null,
    mtuCode: normalizeMtuCode(record.mtuCode || record.jenisMtu || record.jenis_mtu || record.codeRfq),
    vendor: asText(record.vendor || record.provider || record.penyedia),
  };
  return {
    ...enriched,
    lifecycleStatus: enriched.lifecycleStatus || deriveMtuLifecycle(enriched),
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
