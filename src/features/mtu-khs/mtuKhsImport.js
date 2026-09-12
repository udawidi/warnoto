import * as XLSX from "xlsx";
import { normalizeMtuRecord, normalizeMtuText, normalizeMtuYear, validateMtuRecord } from "./mtuKhsModel.js";

const aliases = {
  provider: ["PROVIDER", "PENYEDIA", "VENDOR", "NAMA PENYEDIA"],
  uptName: ["UPT", "NAMA UPT", "UNIT PELAKSANA"] ,
  ultgName: ["ULTG", "NAMA ULTG"],
  giName: ["GI", "GIS", "GITET", "GARDU INDUK", "NAMA GI", "GI/GIS/GITET"],
  bayName: ["BAY", "NAMA BAY"],
  mtuCode: ["JENIS MTU", "KODE MTU", "CODE RFQ", "KODE RFQ", "SPESIFIKASI"],
  materialName: ["MATERIAL", "NAMA MATERIAL", "URAIAN MATERIAL", "NAMA BARANG"],
  qty: ["QTY", "JUMLAH", "VOLUME", "JUMLAH MATERIAL"],
  unit: ["SATUAN", "UNIT"],
  sifatPekerjaan: ["SIFAT PEKERJAAN", "SIFAT"],
  noKontrak: ["NO KONTRAK", "NOMOR KONTRAK", "KHS", "NO. KONTRAK"],
  tanggalKontrak: ["TANGGAL KONTRAK", "TGL KONTRAK"],
  tanggalSerahTerima: ["RENCANA KEDATANGAN", "TANGGAL SERAH TERIMA", "DELIVERY", "TGL RENCANA"],
  onsiteDate: ["ONSITE", "TANGGAL ONSITE", "TGL ONSITE", "MATERIAL ONSITE"],
  noSpmk: ["NO SPMK", "SPMK"],
  location: ["LOKASI", "LOKASI MTU", "GUDANG", "BLOK"],
  serialNumber: ["SERIAL NUMBER", "NO SERI", "SERIAL"],
};

function normalizeHeader(value) { return normalizeMtuText(value).replace(/[.:]/g, "").replace(/\s+/g, " "); }
function findColumn(headers, names) { const candidates = names.map(normalizeHeader); return headers.findIndex(header => candidates.some(candidate => header === candidate || header.includes(candidate))); }
function cellText(cell) { return cell?.v == null ? "" : String(cell.v).trim(); }

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
    const source = { procurementYear: normalizeMtuYear(procurementYear || sheetName), provider: pick("provider"), uptName: pick("uptName"), ultgName: pick("ultgName"), giName: pick("giName"), bayName: pick("bayName"), mtuCode: pick("mtuCode"), materialName: pick("materialName"), qty: Number(String(pick("qty")).replace(/\./g, "").replace(",", ".")) || 0, unit: pick("unit"), sifatPekerjaan: pick("sifatPekerjaan"), noKontrak: pick("noKontrak"), tanggalKontrak: pick("tanggalKontrak"), tanggalSerahTerima: pick("tanggalSerahTerima"), onsiteDate: pick("onsiteDate"), noSpmk: pick("noSpmk"), location: pick("location"), serialNumber: pick("serialNumber"), rawData: raw };
    const normalized = normalizeMtuRecord(source);
    rows.push({ rowNumber: r + 1, source: normalized, rawData: raw, hyperlinks: Object.entries(raw).filter(([key]) => key.endsWith("__href")).map(([key, url]) => ({ field: key.slice(0, -6), url })), validation: validateMtuRecord(normalized, { requireMappings: false }) });
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
