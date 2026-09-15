import test from "node:test";
import assert from "node:assert/strict";
import {
  SAP_OPNAME_CATEGORIES,
  getSapOpnameCategory,
  isSapOpnameItem,
  opnameProgress,
  childOpnameMatches,
} from "../../src/lib/stockOpnameFlow.js";

test("SAP opname hanya mengenal tiga kategori dan menolak Non-SAP", () => {
  assert.deepEqual(SAP_OPNAME_CATEGORIES, ["Cadang", "Persediaan", "Pre Memory"]);
  assert.equal(getSapOpnameCategory("SAP - Cadang"), "Cadang");
  assert.equal(getSapOpnameCategory("SAP - Persediaan"), "Persediaan");
  assert.equal(getSapOpnameCategory("SAP - Pre Memory"), "Pre Memory");
  assert.equal(getSapOpnameCategory("Non-SAP"), null);
  assert.equal(isSapOpnameItem({ sapCategory: "Cadang" }), true);
  assert.equal(isSapOpnameItem({ sapCategory: "Non-SAP" }), false);
});

test("progress opname dapat dihitung total dan per kategori", () => {
  const items = [
    { sapCategory: "Cadang", qtsFisik: 2 },
    { sapCategory: "Cadang", qtsFisik: null },
    { sapCategory: "Persediaan", qtsFisik: 1 },
  ];
  assert.deepEqual(opnameProgress(items), { filled: 2, total: 3, pct: 67 });
  assert.deepEqual(opnameProgress(items, "Cadang"), { filled: 1, total: 2, pct: 50 });
});

test("child Non-SAP hanya dicocokkan ke parent SAP, gudang, dan semester", () => {
  const parent = { id: "SAP-1", flowVersion: 2, jenisAlur: "SAP", gudangId: "G-1", semester: "2026-S2" };
  assert.equal(childOpnameMatches({ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-1", semester: "2026-S2" }, parent), true);
  assert.equal(childOpnameMatches({ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-2", semester: "2026-S2" }, parent), false);
  assert.equal(childOpnameMatches({ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-1", semester: "2026-S1" }, parent), false);
  assert.equal(childOpnameMatches({ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-1", semester: "2026-S2" }, { ...parent, flowVersion: 1 }), false);
});
