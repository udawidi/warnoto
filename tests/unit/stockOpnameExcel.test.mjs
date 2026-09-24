import test from "node:test";
import assert from "node:assert/strict";
import { stockOpnameExportRows, buildStockOpnameWorkbook, sanitizeStockOpnameFilename } from "../../src/lib/stockOpnameExcel.js";

const opname = {
  id: "OPN/1", semester: "2026-S1", jenisAlur: "SAP", kategori: "FULL", status: "SELESAI", approvedAtAsman: 1,
  items: [
    { katalogId: "A", namaBarang: "Material A", satuan: "PCS", qtySAP: 5, qtySistem: 4, qtsFisik: 4 },
    { katalogId: "A", namaBarang: "Material A", satuan: "PCS", qtySistem: 1, qtsFisik: 1 },
    { katalogId: "B", namaBarang: "Material B", satuan: "PCS", qtySAP: 2, qtySistem: 2, qtsFisik: 3 },
  ],
};

test("stock opname export aggregates lots and separates discrepancy", () => {
  const rows = stockOpnameExportRows(opname);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Qty System/WARNOTO"], 5);
  assert.equal(rows[0]["Status Rekonsiliasi"], "Sesuai");
  assert.equal(rows[1]["Status Rekonsiliasi"], "Selisih");
  const workbook = buildStockOpnameWorkbook(opname);
  assert.deepEqual(workbook.SheetNames, ["Ringkasan", "Selisih", "Sesuai"]);
});

test("non-SAP export leaves SAP quantities blank and sanitizes filename parts", () => {
  const rows = stockOpnameExportRows({ jenisAlur: "NON_SAP", items: [{ katalogId: "X", qtySistem: 2, qtsFisik: 2 }] });
  assert.equal(rows[0]["Qty SAP"], "—");
  assert.equal(sanitizeStockOpnameFilename("OPN/2026 01"), "OPN_2026_01");
});
