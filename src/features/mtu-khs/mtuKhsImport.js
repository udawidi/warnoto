import * as XLSX from "xlsx";
import { normalizeMtuRecord, normalizeMtuText, normalizeMtuYear, validateMtuRecord } from "./mtuKhsModel.js";

const aliases = {
  provider: ["PROVIDER", "PENYEDIA MATERIAL", "PENYEDIA", "VENDOR", "NAMA PENYEDIA"],
  uptName: ["UPT", "NAMA UPT", "UNIT PELAKSANA"] ,
  ultgName: ["ULTG", "NAMA ULTG"],
  giName: ["GI", "GIS", "GITET", "GARDU INDUK", "NAMA GI", "GI/GIS/GITET"],
  bayName: ["BAY", "NAMA BAY"],
  mtuCode: ["JENIS MTU", "KODE MTU", "CODE RFQ", "KODE RFQ", "SPESIFIKASI"],
  materialName: ["MATERIAL", "NAMA MATERIAL", "URAIAN MATERIAL", "NAMA BARANG"],
  qty: ["QTY", "JUMLAH", "VOLUME", "JUMLAH MATERIAL"],
  unit: ["SATUAN", "UNIT"],
  sifatPekerjaan: ["SIFAT PEKERJAAN", "SIFAT"],
  noKontrak: ["KONTRAK KHS", "NO KONTRAK", "NOMOR KONTRAK", "KHS", "NO. KONTRAK"],
  tanggalKontrak: ["TANGGAL KONTRAK", "TGL KONTRAK"],
  tanggalSerahTerima: ["BATAS SERAH TERIMA (BASTB) KONTRAKTUAL", "RENCANA KEDATANGAN", "TANGGAL SERAH TERIMA", "DELIVERY", "TGL RENCANA"],
  onsiteDate: ["TANGGAL MATERIAL ON SITE", "ONSITE", "TANGGAL ONSITE", "TGL ONSITE", "MATERIAL ONSITE"],
  installationDate: ["REALISASI PASANG", "TANGGAL REALISASI PASANG", "TANGGAL TERPASANG"],
  installedQty: ["JUMLAH TERPASANG", "JUMLAH TERINSTALL", "QTY TERPASANG"],
  remainingQty: ["SISA", "SISA MATERIAL", "QTY SISA"],
  noSpmk: ["NOMOR SPMK", "NO SPMK", "SPMK"],
  location: ["LOKASI PASANG", "LOKASI", "LOKASI MTU", "GUDANG", "BLOK"],
  serialNumber: ["NO SERI", "SERIAL NUMBER", "SERIAL"],
};

function normalizeHeader(value) { return normalizeMtuText(value).replace(/[.:]/g, "").replace(/\s+/g, " "); }
function findColumn(headers, names) {
  const candidates = names.map(normalizeHeader);
  // Exact aliases win.  A generic alias such as MATERIAL must not capture
  // PENYEDIA MATERIAL when the sheet also contains the real MATERIAL column.
  for (const candidate of candidates) {
    const exact = headers.findIndex(header => header === candidate);
    if (exact >= 0) return exact;
  }
  const matches = headers.reduce((found, header, index) => {
    if (candidates.some(candidate => candidate.length > 3 && header.includes(candidate))) found.push(index);
    return found;
  }, []);
  return matches.length === 1 ? matches[0] : -1;
}
function cellText(cell) { return cell?.w != null ? String(cell.w).trim() : cell?.v == null ? "" : String(cell.v).trim(); }
function meaningful(value) { return value && value !== "-"; }

async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildMtuImportHashes(fileBytes, parsed) {
  const rawRowSha256 = await Promise.all((parsed?.rows || []).map(row => sha256(JSON.stringify(row.rawData || {}))));
  const counts = rawRowSha256.reduce((result, hash) => result.set(hash, (result.get(hash) || 0) + 1), new Map());
  const duplicateCandidate = rawRowSha256.map(hash => counts.get(hash) > 1);
  const fileSha256 = await sha256(fileBytes);
  const year = parsed?.rows?.[0]?.source?.procurementYear || "unknown";
  return { fileSha256, rawRowSha256, duplicateCandidate, batchId: `MTU-BATCH-${year}-${fileSha256.slice(0, 16)}` };
}

export function parseMtuKhsWorkbook(input, { procurementYear, headerRow } = {}) {
  const workbook = input?.SheetNames ? input : XLSX.read(input, { type: typeof input === "string" ? "binary" : "array", cellFormula: false, cellHTML: false });
  const sheetName = workbook.SheetNames.find(name => /input khs/i.test(name)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { sheetName, headerRow, rows: [], errors: ["Sheet Input KHS tidak ditemukan"] };
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  const actualHeaderRow = Number.isInteger(headerRow) ? headerRow : (/2026/.test(sheetName) ? 7 : 4);
  const headerIndex = Math.max(0, actualHeaderRow - 1);
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) headers.push(normalizeHeader(cellText(sheet[XLSX.utils.encode_cell({ r: headerIndex, c })])));
  const rows = [];
  for (let r = headerIndex + 1; r <= range.e.r; r++) {
    const raw = {};
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const key = headers[c - range.s.c] || `COLUMN_${c + 1}`;
      const value = cellText(cell);
      raw[key] = value;
      if (value && value !== "-") hasValue = true;
      if (cell?.l?.Target) raw[`${key}__href`] = cell.l.Target;
    }
    if (!hasValue) continue;
    const pick = field => { const index = findColumn(headers, aliases[field] || [field]); return index < 0 ? "" : raw[headers[index]]; };
    const provider = pick("provider");
    const uptName = pick("uptName");
    const materialName = pick("materialName");
    // Footer/summary rows have no vendor, UPT, or material identity.
    const providerColumnExists = findColumn(headers, aliases.provider) >= 0;
    if (!meaningful(uptName) || !meaningful(materialName) || (providerColumnExists && !meaningful(provider))) continue;
    const source = { procurementYear: normalizeMtuYear(procurementYear || sheetName), provider, uptName, ultgName: pick("ultgName"), giName: pick("giName"), bayName: pick("bayName"), mtuCode: pick("mtuCode"), materialName, qty: Number(String(pick("qty")).replace(/\./g, "").replace(",", ".")) || 0, unit: pick("unit"), sifatPekerjaan: pick("sifatPekerjaan"), noKontrak: pick("noKontrak"), tanggalKontrak: pick("tanggalKontrak"), tanggalSerahTerima: pick("tanggalSerahTerima"), onsiteDate: pick("onsiteDate"), installationDate: pick("installationDate"), installedQty: pick("installedQty"), remainingQty: pick("remainingQty"), noSpmk: pick("noSpmk"), location: pick("location"), serialNumber: pick("serialNumber"), rawData: raw };
    const normalized = normalizeMtuRecord(source);
    const validation = validateMtuRecord(normalized, { requireMappings: false });
    if (!normalized.mtuCode) validation.errors.push("MTU_CODE_REQUIRED");
    validation.valid = validation.errors.length === 0;
    rows.push({ rowNumber: r + 1, source: normalized, rawData: raw, hyperlinks: Object.entries(raw).filter(([key]) => key.endsWith("__href")).map(([key, url]) => ({ field: key.slice(0, -6), url })), validation });
  }
  return { sheetName, headerRow: actualHeaderRow, rows, errors: [] };
}

export function applyMtuMappings(parsed, mappings = {}) {
  return (parsed?.rows || []).map(row => {
    const source = row.source;
    const mapped = { ...source, uptId: mappings.upt?.[normalizeMtuText(source.uptName)] || source.uptId, ultgId: mappings.ultg?.[normalizeMtuText(source.ultgName)] || source.ultgId, garduIndukId: mappings.gi?.[normalizeMtuText(source.giName)] || source.garduIndukId, bayId: mappings.bay?.[normalizeMtuText(source.bayName)] || source.bayId };
    return { ...row, source: mapped, validation: validateMtuRecord(mapped) };
  });
}

export function summarizeMtuImport(parsed) {
  const rows = parsed?.rows || [];
  return { totalRows: rows.length, physicalRows: rows.filter(row => row.source.sifatPekerjaan !== "SUPERVISI").length, physicalQty: rows.reduce((total, row) => total + (row.source.physicalQty || 0), 0), serviceRows: rows.filter(row => row.source.sifatPekerjaan === "SUPERVISI").length, unresolved: rows.filter(row => !row.validation.valid).length, hyperlinkCount: rows.reduce((total, row) => total + row.hyperlinks.length, 0) };
}
