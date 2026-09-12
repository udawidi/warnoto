import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { applyMtuMappings, parseMtuKhsWorkbook, summarizeMtuImport } from "../../src/features/mtu-khs/mtuKhsImport.js";
import { canAccessMtuRecord, normalizeMtuCode, normalizeMtuRecord, physicalQuantity, resolveMtuScope, sameYearDrawing, validateMtuRecord } from "../../src/features/mtu-khs/mtuKhsModel.js";
import { filterMtuHierarchy } from "../../src/features/mtu-khs/mtuKhsHierarchy.js";

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
