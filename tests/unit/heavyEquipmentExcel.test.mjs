import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { unzipSync, strFromU8 } from "fflate";
import { scopeHeavyEquipmentForExport, exportHeavyEquipmentXlsx } from "../../src/lib/heavyEquipmentExcel.js";

const uptList = [
  { id: "UPT-SBY", nama: "UPT Surabaya", uitId: "UIT-JBM" },
  { id: "UPT-GRS", nama: "UPT Gresik", uitId: "UIT-JBM" },
  { id: "UPT-MLG", nama: "UPT Malang", uitId: "UIT-BALI" },
];
const equipment = [
  { id: "SBY-1", upt: "Surabaya", uptId: "UPT-SBY", nama: "Crane", nomorSeri: "000123", foto: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/3D8iWQAAAABJRU5ErkJggg==" },
  { id: "GRS-1", upt: "Gresik", uptId: "UPT-GRS", nama: "Forklift", isCrossUptBorrowable: true },
  { id: "MLG-1", upt: "Malang", uptId: "UPT-MLG", nama: "Manlift" },
  { id: "BAD-1", upt: "Tidak Dikenal", nama: "Unknown" },
];

test("UPT scope excludes cross-borrowable equipment owned by other UPT", () => {
  assert.deepEqual(scopeHeavyEquipmentForExport(equipment, { role: "ADMIN", uptId: "UPT-SBY" }, uptList).map(x => x.id), ["SBY-1"]);
});

test("UIT scope includes owned UPTs only and fails closed for unresolved owner", () => {
  assert.deepEqual(scopeHeavyEquipmentForExport(equipment, { role: "ADMIN_UIT", uitId: "UIT-JBM" }, uptList).map(x => x.id), ["SBY-1", "GRS-1"]);
});

test("UIT without uitId and unknown role fail closed", () => {
  assert.deepEqual(scopeHeavyEquipmentForExport(equipment, { role: "ADMIN_UIT" }, uptList), []);
  assert.deepEqual(scopeHeavyEquipmentForExport(equipment, { role: "UNKNOWN", uptId: "UPT-SBY" }, uptList), []);
});

test("typed owner id is authoritative over display UPT text", () => {
  const misleading = { id: "MISLEADING", upt: "Surabaya", uptId: "UPT-GRS", nama: "Forklift" };
  assert.deepEqual(scopeHeavyEquipmentForExport([misleading], { role: "ADMIN", uptId: "UPT-SBY" }, uptList), []);
  assert.deepEqual(scopeHeavyEquipmentForExport([misleading], { role: "ADMIN", uptId: "UPT-GRS" }, uptList).map(x => x.id), ["MISLEADING"]);
});

test("national scope includes all rows and workbook keeps serial leading zero", async () => {
  assert.deepEqual(scopeHeavyEquipmentForExport(equipment, { role: "SUPERADMIN" }, uptList).map(x => x.id), ["SBY-1", "GRS-1", "MLG-1", "BAD-1"]);
  const result = await exportHeavyEquipmentXlsx({ equipmentList: equipment.slice(0, 1), currentUser: { role: "SUPERADMIN" }, uptList });
  const zip = unzipSync(new Uint8Array(result.bytes));
  const workbook = XLSX.read(result.bytes, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Inventaris, { defval: "" });
  assert.equal(String(rows[0]["No. Seri"]), "000123");
  assert.ok(workbook.SheetNames.includes("Lampiran Foto"));
  assert.ok(Object.keys(zip).some(key => /^xl\/media\/image/.test(key)));
  const drawing = strFromU8(zip["xl/drawings/drawing1.xml"]);
  assert.match(drawing, /oneCellAnchor/);
  assert.match(drawing, /cx="2667000" cy="1333500"/);
  assert.match(strFromU8(zip["xl/worksheets/sheet2.xml"]), /drawing r:id=/);
});

test("missing and invalid photo are reported without failing workbook", async () => {
  const result = await exportHeavyEquipmentXlsx({ equipmentList: [{ ...equipment[0], foto: "data:text/html;base64,PGh0bWw+eDwvaHRtbD4=" }, { ...equipment[1], foto: null }], currentUser: { role: "SUPERADMIN" }, uptList });
  assert.equal(result.count, 2);
  assert.equal(result.failedPhotos, 1);
});
