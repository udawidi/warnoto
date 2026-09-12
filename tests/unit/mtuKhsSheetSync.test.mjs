import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCellChanges,
  columnLetter,
  detectHeaderRow,
  extractContractDetail,
  findSourceRow,
  headerIndex,
  immutableKey,
  rowImmutableKey,
  sameImmutableKey,
  preserveRfqPrefix,
} from "../../supabase/functions/push-mtu-khs/mapping.mjs";

const headers = ["PENYEDIA MATERIAL", "UPT", "ULTG", "GARDU INDUK", "BAY", "JENIS MTU", "SIFAT PEKERJAAN", "KONTRAK KHS", "LOKASI PASANG"];
const row = ["UNINDO", "UPT A", "ULTG A", "GI A", "BAY A", "S - CB150-007", "MATERIAL", "001.PJ/2024", "Lama"];
const record = {
  procurementYear: 2024,
  vendor: "UNINDO",
  uptName: "UPT A",
  ultgName: "ULTG A",
  giName: "GI A",
  bayName: "BAY A",
  mtuCode: "S - CB150-007",
  sifatPekerjaan: "MATERIAL",
  rawData: { "PENYEDIA MATERIAL": "UNINDO", UPT: "UPT A", ULTG: "ULTG A", "GARDU INDUK": "GI A", BAY: "BAY A", "JENIS MTU": "S - CB150-007", "SIFAT PEKERJAAN": "MATERIAL", "KONTRAK KHS": "001.PJ/2024", "LOKASI PASANG": "Lama" },
};

test("MTU Sheet mapping preserves S/P prefix", () => {
  assert.equal(preserveRfqPrefix("CB150-008", "S - CB150-007"), "S - CB150-008");
  assert.equal(preserveRfqPrefix("P-CB150-008", "S - CB150-007"), "P - CB150-008");
});

test("source row is verified before unique-key fallback", () => {
  assert.deepEqual(findSourceRow(headers, [headers, row], record, 2), { rowNumber: 2, method: "source-row" });
  assert.equal(findSourceRow(headers, [headers, ["OTHER", ...row.slice(1)], row], record, 2).rowNumber, 3);
  assert.equal(findSourceRow(headers, [headers, row, row], record, null).method, "ambiguous-key");
  const before = { ...record, vendor: "OLD", rawData: { ...record.rawData, "PENYEDIA MATERIAL": "OLD" } };
  const after = { ...record, vendor: "NEW", rawData: { ...record.rawData, "PENYEDIA MATERIAL": "NEW" } };
  const updatedRow = ["NEW", ...row.slice(1)];
  assert.deepEqual(findSourceRow(headers, [headers, updatedRow], before, 2, after), { rowNumber: 2, method: "after-source-row" });
});

test("cell mapping rejects Sheet drift and produces allowlisted cell changes", () => {
  assert.deepEqual(buildCellChanges(headers, row, record, record, { mtuCode: "CB150-008", location: "Baru" }).changes, [
    { field: "mtuCode", columnIndex: 5, before: "S - CB150-007", after: "S - CB150-008" },
    { field: "location", columnIndex: 8, before: "Lama", after: "Baru" },
  ]);
  const drifted = [...row]; drifted[8] = "Drift";
  assert.equal(buildCellChanges(headers, drifted, record, record, { location: "Baru" }).conflict, true);
  const alreadyApplied = [...row]; alreadyApplied[5] = "P - CB150-008";
  assert.deepEqual(buildCellChanges(headers, alreadyApplied, record, record, { mtuCode: "CB150-008" }).changes, []);
});

test("source identity ignores RFQ prefix and accepts exact operational aliases", () => {
  const aliasHeaders = ["PENYEDIA MATERIAL", "GI/GIS/GITET", "BATAS SERAH TERIMA (BASTB) KONTRAKTUAL", "TANGGAL MATERIAL ON SITE (SESUAI SPMK)", "JENIS MTU"];
  assert.equal(headerIndex(aliasHeaders, "giName"), 1);
  assert.equal(headerIndex(aliasHeaders, "tanggalSerahTerima"), 2);
  assert.equal(headerIndex(aliasHeaders, "onsiteDate"), 3);
  assert.equal(immutableKey({ ...record, mtuCode: "P - CB150-007" }).mtuCode, rowImmutableKey(aliasHeaders, ["UNINDO", "GI A", "", "", "S - CB150-007"], 2024).mtuCode);
});

test("header detection skips title rows while source row remains absolute", () => {
  const rows = [["MTU KHS 2024"], ["Perencanaan pengadaan"], [""], headers, row];
  const detected = detectHeaderRow(rows);
  assert.equal(detected.rowNumber, 4);
  assert.deepEqual(findSourceRow(detected.headers, rows, record, 5), { rowNumber: 5, method: "source-row" });
});

test("header detection fails closed when no business header exists", () => {
  assert.equal(detectHeaderRow([["judul"], ["catatan"]]).error, "HEADER_NOT_FOUND");
  assert.equal(detectHeaderRow([headers, ["title"], headers]).error, "HEADER_AMBIGUOUS");
});

test("optional hierarchy blanks match only when blank on both sides", () => {
  const left = { procurementYear: 2024, vendor: "UNINDO", mtuCode: "CB150-007", sifatPekerjaan: "MATERIAL", uptName: "", ultgName: "", giName: "", bayName: "" };
  const right = { ...left };
  assert.equal(sameImmutableKey(left, right), true);
  assert.equal(sameImmutableKey(left, { ...right, giName: "GI A" }), false);
  assert.equal(sameImmutableKey({ ...left, vendor: "" }, right), false);
});

test("contract detail extraction supports dynamic headers and links", () => {
  assert.deepEqual(extractContractDetail({ "KONTRAK RINCI 09KR/2026": "006.KR/DAN/2026", "KONTRAK RINCI 09KR/2026__href": "https://drive.google.com/file/d/x" }), { number: "006.KR/DAN/2026", url: "https://drive.google.com/file/d/x" });
});

test("column letters cover Google Sheet columns past Z", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
});
