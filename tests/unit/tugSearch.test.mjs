import test from "node:test";
import assert from "node:assert/strict";
import { matchesTugHistorySearch } from "../../src/lib/tugSearch.js";

const katalogList = [{ id: "KAT-1", name: "Kabel Tembaga", katalog: "000123" }];
const enrichedStocks = [{ id: "STK-1", name: "Kabel Tembaga", katalog: "000123", kontrakRefs: [{ supplier: "Vendor Lama" }] }];

test("TUG history search covers party, material, job, and lowercase document numbers", () => {
  assert.equal(matchesTugHistorySearch({ docType: "TUG3", dariSupplier: "PT Penyedia", namaPekerjaan: "Jaringan Baru", docNumbers: { tug3: "BA-123" }, stockItems: [{ katalogId: "KAT-1" }] }, "penyedia jaringan ba-123", { katalogList }), true);
  assert.equal(matchesTugHistorySearch({ docType: "TUG10", menyerahkanUnit: "Unit A", menyerahkanNama: "Budi", stockItems: [{ namaBaru: "Trafo Baru" }] }, "budi trafo", {}), true);
});

test("TUG-8/9 source snapshot supplier wins over current stock fallback", () => {
  const txn = { docType: "TUG8", stockItems: [{ stockId: "STK-1", sourceSnapshot: { contracts: [{ supplier: "Vendor Snapshot" }] } }] };
  assert.equal(matchesTugHistorySearch(txn, "vendor snapshot", { enrichedStocks }), true);
  assert.equal(matchesTugHistorySearch(txn, "vendor lama", { enrichedStocks }), false);
  assert.equal(matchesTugHistorySearch({ docType: "TUG8", stockItems: [{ stockId: "STK-1" }] }, "vendor lama", { enrichedStocks }), true);
});

test("TUG search supports snapshot/new material and typo/case matching", () => {
  assert.equal(matchesTugHistorySearch({ docType: "TUG9", pekerjaan: "Pemeliharaan Gardu", stockItems: [{ snapshot: { name: "Transformator Distribusi" } }] }, "pemeliharaan transformatr", {}), true);
  assert.equal(matchesTugHistorySearch({ docType: "TUG10", stockItems: [{ namaBaru: "Material Khusus" }] }, "material khusus", {}), true);
});
