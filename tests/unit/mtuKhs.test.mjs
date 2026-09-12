import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { applyMtuMappings, buildMtuImportHashes, parseMtuKhsWorkbook, summarizeMtuImport } from "../../src/features/mtu-khs/mtuKhsImport.js";
import { canAccessMtuRecord, deriveMtuLifecycle, formatMtuDate, jakartaTodayIso, mtuStatusDate, normalizeMtuCode, normalizeMtuRecord, parseMtuDates, physicalQuantity, resolveMtuScope, sameYearDrawing, validateMtuRecord } from "../../src/features/mtu-khs/mtuKhsModel.js";
import { filterMtuHierarchy } from "../../src/features/mtu-khs/mtuKhsHierarchy.js";
import { formatMtuContract } from "../../src/features/mtu-khs/mtuKhsApi.js";

test("GI hierarchy filters descendants and resets are represented by empty child selection", () => {
  const data = { uptList: [{ id: "UPT-1", uitId: "UIT-1" }, { id: "UPT-2", uitId: "UIT-2" }], ultgList: [{ id: "ULTG-1", parentUptId: "UPT-1" }, { id: "ULTG-2", parentUptId: "UPT-2" }], gis: [{ id: "GI-1", ultgId: "ULTG-1" }, { id: "GI-2", ultgId: "ULTG-2" }], bays: [{ id: "BAY-1", garduIndukId: "GI-1" }, { id: "BAY-2", garduIndukId: "GI-2" }] };
  assert.deepEqual(filterMtuHierarchy({ ...data, uitId: "UIT-1", uptId: "UPT-1", ultgId: "ULTG-1", giId: "GI-1" }).bays.map(item => item.id), ["BAY-1"]);
  assert.deepEqual(filterMtuHierarchy({ ...data, uitId: "UIT-1", uptId: "UPT-1", ultgId: "ULTG-1", giId: "" }).bays, []);
  assert.deepEqual(filterMtuHierarchy({ ...data, uitId: "UIT-2", uptId: "", ultgId: "", giId: "" }).gis.map(item => item.id), ["GI-2"]);
});

test("MTU model normalizes code, year, and service quantity", () => {
  const record = normalizeMtuRecord({ tahun: "KHS 2026", mtuCode: "S - CT150 001", qty: "4", sifatPekerjaan: "SUPERVISI" });
  assert.equal(record.procurementYear, 2026);
  assert.equal(normalizeMtuCode("S - CT150 001"), "CT150-001");
  assert.equal(physicalQuantity(record), 0);
  assert.equal(record.physicalQty, 0);
});

test("MTU contract detail is shortened without losing unusual references", () => {
  assert.equal(formatMtuContract("006.KR/DAN.01.01/F34000000/2026"), "006.KR");
  assert.equal(formatMtuContract("KONTRAK-KHUSUS"), "KONTRAK-KHUSUS");
  assert.equal(formatMtuContract("NOMOR-KONTRAK-TANPA-POLA-YANG-PANJANG"), "NOMOR-KONTRAK-TANPA-POLA-YANG-PANJANG");
  assert.equal(formatMtuContract(""), "-");
});

test("MTU lifecycle follows KHS onsite/install dates and quantities", () => {
  assert.deepEqual(parseMtuDates("18 May 2026\n7 Juli 2026"), { original: "18 May 2026\n7 Juli 2026", dates: ["2026-05-18", "2026-07-07"], last: "2026-07-07" });
  assert.equal(jakartaTodayIso(new Date("2026-09-12T00:00:00Z")), "2026-09-12");
  assert.equal(deriveMtuLifecycle({ procurementYear: 2024, qty: 3, onsiteDate: "18 May 2026", installationDate: "7 July 2026", installedQty: 1, remainingQty: 2 }, { now: new Date("2026-09-12T00:00:00Z") }), "ON_SITE");
  assert.equal(deriveMtuLifecycle({ procurementYear: 2024, qty: 1, installationDate: "7 Juli 2026", installedQty: 1, remainingQty: 0 }), "INSTALLED");
  assert.equal(deriveMtuLifecycle({ procurementYear: 2024, qty: 1, installationDate: "19 July 2926", installedQty: 1, remainingQty: 0 }), "INSTALLED");
  assert.equal(deriveMtuLifecycle({ procurementYear: 2024, qty: 1, onsiteDate: "18 September 2026" }, { now: new Date("2026-09-12T00:00:00Z") }), "PLANNED_ARRIVAL");
  assert.equal(normalizeMtuRecord({ procurementYear: 2026, qty: 1, onsiteDate: "18 September 2026" }).lifecycleStatus, "PLANNED_ARRIVAL");
  const normalizedTwice = normalizeMtuRecord(normalizeMtuRecord({ procurementYear: 2024, qty: 1, onsiteDate: "18 May 2026", onsiteDateOriginal: "18 May 2026 & berita acara" }));
  assert.equal(normalizedTwice.onsiteDateOriginal, "18 May 2026 & berita acara");
});

test("MTU status shows its relevant operational date", () => {
  assert.equal(mtuStatusDate({ lifecycleStatus: "PLANNED_ARRIVAL", onsiteDate: "2026-09-18" }), "2026-09-18");
  assert.equal(mtuStatusDate({ lifecycleStatus: "ON_SITE", onsiteDate: "2026-05-18" }), "2026-05-18");
  assert.equal(mtuStatusDate({ lifecycleStatus: "INSTALLED", installationDate: "2026-07-07" }), "2026-07-07");
  assert.equal(mtuStatusDate({ lifecycleStatus: "VENDOR", onsiteDate: "2026-09-18" }), "");
  assert.match(formatMtuDate("2026-09-18"), /18 Sep 2026/i);
});

test("validation requires UPT and non-empty GI mapping", () => {
  const result = validateMtuRecord({ procurementYear: 2024, qty: 2, giName: "GI Ketintang" });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["UPT belum dipetakan ke UPT_ID", "GI belum dipetakan ke master GI"]);
  const mapped = validateMtuRecord({ procurementYear: 2024, qty: 2, uptId: "UPT-SBY", giName: "GI Ketintang", garduIndukId: "GI-1" });
  assert.equal(mapped.valid, true);
});

test("scope is hierarchical and PENGADAAN is national for MTU only", () => {
  const uptList = [{ id: "UPT-SBY", nama: "UPT Surabaya", uitId: "UIT-JBM" }, { id: "UPT-MLG", nama: "UPT Malang", uitId: "UIT-JBM" }, { id: "UPT-MKS", nama: "UPT Makassar", uitId: "UIT-SUL" }];
  assert.deepEqual(resolveMtuScope({ role: "TL", uptId: "UPT-SBY" }, uptList), ["UPT-SBY"]);
  assert.deepEqual(resolveMtuScope({ role: "ASMAN_LOG_UIT", uitId: "UIT-JBM" }, uptList), ["UPT-SBY", "UPT-MLG"]);
  assert.equal(resolveMtuScope({ role: "PENGADAAN" }, uptList), null);
  assert.equal(canAccessMtuRecord({ uptId: "UPT-MKS" }, { role: "ASMAN_LOG_UIT", uitId: "UIT-JBM" }, uptList), false);
});

test("drawing match requires exact vendor, code, and procurement year", () => {
  const record = { procurementYear: 2026, vendor: "UNINDO", mtuCode: "CT150-001" };
  assert.equal(sameYearDrawing(record, { documentType: "DRAWING", procurementYear: 2026, vendor: "UNINDO", mtuCode: "CT150-001", url: "https://drive.google.com/file/d/1/view" }), true);
  assert.equal(sameYearDrawing(record, { documentType: "DRAWING", procurementYear: 2024, vendor: "UNINDO", mtuCode: "CT150-001", url: "https://drive.google.com/file/d/1/view" }), false);
  assert.equal(sameYearDrawing(record, { documentType: "DRAWING", procurementYear: 2026, vendor: "HITACHI", mtuCode: "CT150-001", url: "https://drive.google.com/file/d/1/view" }), false);
});

test("parser uses 2024 header row 4, preserves rows and ignores blank extents", () => {
  const rows = Array.from({ length: 7 }, () => []);
  rows[3] = ["UPT", "GI", "JENIS MTU", "MATERIAL", "QTY", "SIFAT PEKERJAAN"];
  rows[4] = ["UPT Surabaya", "GI Ketintang", "CT150-001", "Current Transformer", "2", "MATERIAL"];
  rows[5] = ["UPT Surabaya", "-", "S - CT150-002", "Supervisi", "1", "SUPERVISI"];
  rows[6] = ["", "", "", "", "", ""];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Input KHS 2024");
  const parsed = parseMtuKhsWorkbook(workbook, { procurementYear: 2024 });
  assert.equal(parsed.headerRow, 4);
  assert.equal(parsed.rows.length, 2);
  assert.equal(summarizeMtuImport(parsed).physicalQty, 2);
  assert.equal(summarizeMtuImport(parsed).serviceRows, 1);
  const mapped = applyMtuMappings(parsed, { upt: { "UPT SURABAYA": "UPT-SBY" }, gi: { "GI KETINTANG": "GI-1" } });
  assert.equal(mapped[0].validation.valid, true);
});

test("parser safely maps MATERIAL, excludes footer rows, and preserves source metadata", () => {
  const rows = Array.from({ length: 8 }, () => []);
  rows[3] = ["PROVIDER", "UPT", "PENYEDIA MATERIAL", "MATERIAL", "JENIS MTU", "QTY"];
  rows[4] = ["UNINDO", "UPT Surabaya", "UNINDO", "Current Transformer", "CT150-001", "2"];
  rows[5] = ["", "", "", "", "", ""];
  rows[6] = ["TOTAL", "", "", "", "", "2"];
  rows[7] = ["UNINDO", "UPT Surabaya", "UNINDO", "Current Transformer", "", "1"];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet.E8.l = { Target: "https://example.test/material-8" };
  XLSX.utils.book_append_sheet(workbook, sheet, "Input KHS 2024");

  const parsed = parseMtuKhsWorkbook(workbook, { procurementYear: 2024 });
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].rowNumber, 5);
  assert.equal(parsed.rows[0].source.materialName, "Current Transformer");
  assert.equal(parsed.rows[1].rowNumber, 8);
  assert.deepEqual(parsed.rows[1].hyperlinks, [{ field: "JENIS MTU", url: "https://example.test/material-8" }]);
  assert.equal(parsed.rows[1].validation.valid, false);
  assert.deepEqual(parsed.rows[1].validation.errors, ["MTU_CODE_REQUIRED"]);
});

test("parser maps provider from PENYEDIA MATERIAL when PENYEDIA PASANG also exists", () => {
  const rows = [
    [], [], [], ["PENYEDIA MATERIAL", "PENYEDIA PASANG", "UPT", "MATERIAL", "JENIS MTU", "QTY"],
    ["HITACHI", "KONTRAKTOR X", "UPT Surabaya", "Current Transformer", "CT150-001", "1"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Input KHS 2024");
  const parsed = parseMtuKhsWorkbook(workbook, { procurementYear: 2024 });
  assert.equal(parsed.rows[0].source.provider, "HITACHI");
});

test("parser maps the actual KHS contract and placement headers", () => {
  const rows = [
    [],
    ["PROVIDER", "UPT", "MATERIAL", "KONTRAK KHS", "NOMOR SPMK", "BATAS SERAH TERIMA (BASTB) KONTRAKTUAL", "TANGGAL MATERIAL ON SITE", "LOKASI PASANG", "NO SERI"],
    ["UNINDO", "UPT Surabaya", "Current Transformer", "KHS-01", "SPMK-01", "2026-12-01", "2026-11-01", "GI Ketintang", "SN-01"],
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet.F3 = { v: 46160, w: "2026-06-17", t: "n" };
  sheet.G3 = { v: 46130, w: "2026-05-18", t: "n" };
  XLSX.utils.book_append_sheet(workbook, sheet, "Input KHS 2026");
  const parsed = parseMtuKhsWorkbook(workbook, { procurementYear: 2026, headerRow: 2 });
  const source = parsed.rows[0].source;
  assert.equal(source.noKontrak, "KHS-01");
  assert.equal(source.noSpmk, "SPMK-01");
  assert.equal(source.tanggalSerahTerima, "2026-06-17");
  assert.equal(source.onsiteDate, "2026-05-18");
  assert.equal(source.location, "GI Ketintang");
  assert.equal(source.serialNumber, "SN-01");
});

test("import hashes are deterministic and mark only repeated raw rows", async () => {
  const parsed = { sheetName: "Input KHS 2024", rows: [
    { rawData: { A: "1" }, source: { procurementYear: 2024 } },
    { rawData: { A: "1" }, source: { procurementYear: 2024 } },
    { rawData: { A: "2" }, source: { procurementYear: 2024 } },
  ] };
  const first = await buildMtuImportHashes(new TextEncoder().encode("file"), parsed);
  const second = await buildMtuImportHashes(new TextEncoder().encode("file"), parsed);
  assert.equal(first.fileSha256, "3b9c358f36f0a31b6ad3e14f309c7cf198ac9246e8316f9ce543d5b19ac02b80");
  assert.equal(first.fileSha256, second.fileSha256);
  assert.deepEqual(first.rawRowSha256, second.rawRowSha256);
  assert.deepEqual(first.duplicateCandidate, [true, true, false]);
  assert.equal(first.batchId, `MTU-BATCH-2024-${first.fileSha256.slice(0, 16)}`);
});
