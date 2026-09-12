// Pure Sheet mapping helpers. Keep this file free of Deno/Supabase imports so it can
// be checked by Node and reused by the Edge Function.

export const SHEET_ID = "1Fd978ThcVpCmGEbADILLbjpsGfpWtdKlJdnNdvnzOiw";
export const SHEET_NAMES = new Set(["Input KHS 2024", "Input KHS 2026"]);

const clean = (value) => String(value ?? "").trim();
export const normalise = (value) => clean(value).replace(/\s+/g, " ").toUpperCase();
export const normaliseRfq = (value) => normalise(value).replace(/^[SP]\s*-\s*/, "");
const keyName = (value) => normalise(value).replace(/[^A-Z0-9]+/g, "");

const aliases = {
  vendor: ["PENYEDIA MATERIAL", "VENDOR", "PROVIDER"],
  uptName: ["UPT"],
  ultgName: ["ULTG"],
  giName: ["GARDU INDUK", "GI/GITET", "GI/GIS/GITET", "GI", "GARDU INDUK / GI"],
  bayName: ["BAY"],
  mtuCode: ["KODE RFQ", "KODE MTU", "JENIS MTU", "MTU"],
  sifatPekerjaan: ["SIFAT PEKERJAAN"],
};

const fieldAliases = {
  vendor: aliases.vendor,
  noKontrak: ["KONTRAK KHS", "NO KONTRAK", "NOMOR KONTRAK"],
  tanggalKontrak: ["TANGGAL KONTRAK", "TGL KONTRAK"],
  noSpmk: ["NOMOR SPMK", "NO SPMK"],
  tanggalSerahTerima: ["TANGGAL SERAH TERIMA", "TGL SERAH TERIMA", "TANGGAL BASTB", "BATAS SERAH TERIMA (BASTB) KONTRAKTUAL"],
  mtuCode: aliases.mtuCode,
  onsiteDate: ["TANGGAL MATERIAL ON SITE", "TANGGAL MATERIAL ON SITE (SESUAI SPMK)", "MATERIAL ON SITE", "TANGGAL ONSITE"],
  installationPlanDate: ["RENCANA PASANG", "RENCANA TANGGAL PASANG"],
  installationDate: ["REALISASI PASANG", "TANGGAL REALISASI PASANG"],
  installedQty: ["JUMLAH TERPASANG", "QTY TERPASANG"],
  remainingQty: ["SISA", "SISA MATERIAL"],
  location: ["LOKASI PASANG", "LOKASI PEMASANGAN"],
};

function firstHeaderIndex(headers, names) {
  const wanted = new Set(names.map(keyName));
  return headers.findIndex((header) => wanted.has(keyName(header)));
}

function contractHeaderIndex(headers) {
  return headers.findIndex((header) => {
    const normalized = normalise(header);
    return normalized.startsWith("KONTRAK RINCI") && !normalized.endsWith("__HREF");
  });
}

function hrefHeaderIndex(headers, index) {
  if (index < 0) return -1;
  const source = clean(headers[index]);
  const exact = headers.findIndex((header) => clean(header) === `${source}__href`);
  if (exact >= 0) return exact;
  return headers.findIndex((header) => normalise(header).startsWith("KONTRAK RINCI") && normalise(header).endsWith("__HREF"));
}

export function headerIndex(headers, field) {
  if (field === "contractDetailNumber") return contractHeaderIndex(headers);
  if (field === "contractDetailUrl") return hrefHeaderIndex(headers, contractHeaderIndex(headers));
  return firstHeaderIndex(headers, fieldAliases[field] || aliases[field] || []);
}

export function detectHeaderRow(rows = []) {
  const candidates = [];
  // Source sheets place title/metadata rows before the actual header. Limiting detection
  // to the first ten rows avoids treating a repeated footer as a second header.
  rows.slice(0, 10).forEach((row, index) => {
    const headers = Array.isArray(row) ? row : [];
    if (headerIndex(headers, "vendor") >= 0 && headerIndex(headers, "mtuCode") >= 0 && headerIndex(headers, "sifatPekerjaan") >= 0) candidates.push({ rowNumber: index + 1, headers });
  });
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return { rowNumber: null, headers: [], error: "HEADER_NOT_FOUND", candidates: [] };
  return { rowNumber: null, headers: [], error: "HEADER_AMBIGUOUS", candidates: candidates.map(candidate => candidate.rowNumber) };
}

function raw(record) {
  return record?.rawData || record?.data?.rawData || {};
}

export function recordValue(record, field) {
  const direct = record?.[field] ?? record?.data?.[field];
  if (direct !== undefined && direct !== null && clean(direct) !== "") return direct;
  const row = raw(record);
  if (field === "contractDetailNumber" || field === "contractDetailUrl") {
    const found = extractContractDetail(row);
    return field === "contractDetailNumber" ? found.number : found.url;
  }
  const names = fieldAliases[field] || aliases[field] || [];
  const entry = Object.entries(row).find(([key, value]) => names.some((name) => keyName(key) === keyName(name)) && clean(value) !== "");
  return entry?.[1] ?? "";
}

export function extractContractDetail(rawData = {}) {
  const entry = Object.entries(rawData).find(([key, value]) => {
    const k = normalise(key);
    return k.startsWith("KONTRAK RINCI") && !k.endsWith("__HREF") && clean(value) !== "";
  });
  if (!entry) return { number: "", url: "" };
  const href = rawData[`${entry[0]}__href`] || Object.entries(rawData).find(([key]) => normalise(key).startsWith("KONTRAK RINCI") && normalise(key).endsWith("__HREF"))?.[1] || "";
  return { number: clean(entry[1]), url: clean(href) };
}

export function immutableKey(record) {
  return {
    procurementYear: Number(record?.procurementYear ?? record?.year ?? record?.data?.procurementYear ?? 0),
    vendor: normalise(recordValue(record, "vendor")),
    uptName: normalise(record?.uptName ?? record?.data?.uptName ?? recordValue(record, "uptName")),
    ultgName: normalise(record?.ultgName ?? record?.data?.ultgName ?? recordValue(record, "ultgName")),
    giName: normalise(record?.giName ?? record?.data?.giName ?? recordValue(record, "giName")),
    bayName: normalise(record?.bayName ?? record?.data?.bayName ?? recordValue(record, "bayName")),
    mtuCode: normaliseRfq(record?.mtuCode ?? record?.data?.mtuCode ?? recordValue(record, "mtuCode")),
    sifatPekerjaan: normalise(record?.sifatPekerjaan ?? record?.data?.sifatPekerjaan ?? recordValue(record, "sifatPekerjaan")),
  };
}

export function rowImmutableKey(headers, row, procurementYear) {
  const get = (field) => {
    const index = headerIndex(headers, field);
    return index < 0 ? "" : clean(row[index]);
  };
  return {
    procurementYear: Number(procurementYear || 0),
    vendor: normalise(get("vendor")),
    uptName: normalise(get("uptName")),
    ultgName: normalise(get("ultgName")),
    giName: normalise(get("giName")),
    bayName: normalise(get("bayName")),
    mtuCode: normaliseRfq(get("mtuCode")),
    sifatPekerjaan: normalise(get("sifatPekerjaan")),
  };
}

export function sameImmutableKey(left, right) {
  if (Number(left?.procurementYear) !== Number(right?.procurementYear)) return false;
  for (const key of ["vendor", "mtuCode", "sifatPekerjaan"]) {
    const same = key === "mtuCode" ? normaliseRfq(left?.[key]) === normaliseRfq(right?.[key]) : normalise(left?.[key]) === normalise(right?.[key]);
    if (!clean(left?.[key]) || !clean(right?.[key]) || !same) return false;
  }
  for (const key of ["uptName", "ultgName", "giName", "bayName"]) {
    const leftValue = clean(left?.[key]);
    const rightValue = clean(right?.[key]);
    // Hierarchy fields may be absent in both source and DB, but a one-sided blank is unsafe.
    if (!leftValue && !rightValue) continue;
    if (!leftValue || !rightValue || normalise(leftValue) !== normalise(rightValue)) return false;
  }
  return true;
}

function findByIdentity(headers, rows, record, sourceRow) {
  const expected = immutableKey(record);
  const candidates = [];
  if (Number.isInteger(Number(sourceRow)) && Number(sourceRow) > 1 && rows[Number(sourceRow) - 1]) {
    if (sameImmutableKey(expected, rowImmutableKey(headers, rows[Number(sourceRow) - 1], expected.procurementYear))) return { rowNumber: Number(sourceRow), method: "source-row" };
  }
  rows.forEach((row, index) => {
    if (sameImmutableKey(expected, rowImmutableKey(headers, row, expected.procurementYear))) candidates.push(index + 1);
  });
  return candidates.length === 1 ? { rowNumber: candidates[0], method: "unique-key" } : { rowNumber: null, method: candidates.length ? "ambiguous-key" : "not-found", candidates };
}

export function findSourceRow(headers, rows, beforeRecord, sourceRow, afterRecord = null) {
  const before = findByIdentity(headers, rows, beforeRecord, sourceRow);
  if (before.rowNumber) return before;
  if (afterRecord) {
    const after = findByIdentity(headers, rows, afterRecord, sourceRow);
    if (after.rowNumber) return { ...after, method: `after-${after.method}` };
  }
  return before;
}

export function preserveRfqPrefix(nextValue, previousValue) {
  const next = clean(nextValue);
  const previous = clean(previousValue);
  if (!next) return next;
  const explicit = next.match(/^([SP])\s*-\s*/i);
  if (explicit) return `${explicit[1].toUpperCase()} - ${next.slice(explicit[0].length).trim()}`;
  const prior = previous.match(/^([SP])\s*-\s*/i);
  return prior ? `${prior[1].toUpperCase()} - ${next}` : next;
}

export function buildCellChanges(headers, row, beforeRecord, afterRecord, patch) {
  const changes = [];
  for (const field of Object.keys(patch || {})) {
    if (field.startsWith("_") || field === "reason" || field === "documentId" || field === "garduIndukId" || field === "bayId" || field === "gudangId" || field === "lifecycleStatus") continue;
    const index = headerIndex(headers, field);
    if (index < 0) continue;
    let value = patch[field];
    if (field === "mtuCode") value = preserveRfqPrefix(value, recordValue(beforeRecord, field));
    if (value === null || value === undefined) value = "";
    const beforeValue = clean(row[index]);
    const expectedBefore = clean(recordValue(beforeRecord, field));
    const desiredValue = field === "mtuCode" ? preserveRfqPrefix(value, recordValue(beforeRecord, field)) : clean(value);
    // Retry safety: another attempt may have already written the desired value.
    if (field === "mtuCode" ? normaliseRfq(beforeValue) === normaliseRfq(desiredValue) : normalise(beforeValue) === normalise(desiredValue)) continue;
    // Conflict guard: only update a cell when the Sheet still contains the approved snapshot.
    const sameExpected = field === "mtuCode" ? normaliseRfq(beforeValue) === normaliseRfq(expectedBefore) : normalise(beforeValue) === normalise(expectedBefore);
    if (!sameExpected) return { conflict: true, field, expected: expectedBefore, actual: beforeValue, changes: [] };
    changes.push({ field, columnIndex: index, before: beforeValue, after: desiredValue });
  }
  return { conflict: false, changes };
}

export function columnLetter(index) {
  let n = Number(index) + 1;
  let result = "";
  while (n > 0) { const rem = (n - 1) % 26; result = String.fromCharCode(65 + rem) + result; n = Math.floor((n - 1) / 26); }
  return result;
}
