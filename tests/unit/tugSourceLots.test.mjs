import test from "node:test";
import assert from "node:assert/strict";
import { aggregateStocksByKatalog, getSourceLot, isLegacySourceAllocation, legacySourceCandidates, sourceLotKey, sourceLotLabel, sourceLotRowsForCatalog } from "../../src/lib/sap.js";

test("TUG-3 source key separates suppliers and reuses identical contract", () => {
  const a = sourceLotKey({ kind: "TUG3_CONTRACT", uptId: "UPT-SBY", lokasiId: "L1", katalogId: "K1", supplier: "PT A", contractNo: "SP-1" });
  const b = sourceLotKey({ kind: "TUG3_CONTRACT", uptId: "UPT-SBY", lokasiId: "L1", katalogId: "K1", supplier: "PT B", contractNo: "SP-2" });
  assert.notEqual(a, b);
  assert.equal(a, sourceLotKey({ kind: "TUG3_CONTRACT", uptId: "UPT-SBY", lokasiId: "L1", katalogId: "K1", supplier: "PT A", contractNo: "SP-1" }));
  assert.notEqual(
    sourceLotKey({ kind: "TUG3_CONTRACT", uptId: "UPT-SBY", lokasiId: "L1", katalogId: "K1", supplier: "PT A", transactionId: "T1", itemIndex: 0 }),
    sourceLotKey({ kind: "TUG3_CONTRACT", uptId: "UPT-SBY", lokasiId: "L1", katalogId: "K1", supplier: "PT A", transactionId: "T2", itemIndex: 0 }),
  );
});

test("TUG-10 source key is item-specific", () => {
  assert.notEqual(sourceLotKey({ kind: "TUG10_RETURN", transactionId: "T10", itemIndex: 0 }), sourceLotKey({ kind: "TUG10_RETURN", transactionId: "T10", itemIndex: 1 }));
  assert.equal(sourceLotLabel({ sourceLot: { key: "T10", kind: "TUG10_RETURN" } }), "Retur TUG-10");
});

test("legacy multi-source stocks are blocked and catalog totals aggregate lots", () => {
  const legacy = { id: "S1", qty: 7, kontrakRefs: [{ docNo: "A" }, { docNo: "B" }] };
  assert.equal(isLegacySourceAllocation(legacy), true);
  assert.equal(isLegacySourceAllocation({ kontrakRefs: [{ docNo: "A", noKontrak: "K" }, { docNo: "A", noKontrak: "K" }] }), false);
  assert.equal(isLegacySourceAllocation({ kontrakRefs: [{ supplier:"PT A", docNo: "A", noKontrak: "K" }, { supplier:"PT B", docNo: "A", noKontrak: "K" }] }), true);
  assert.equal(isLegacySourceAllocation({ kontrakRefs: [{ docNo: "A", noKontrak: "K" }], _tug10Applied: { "T10:0": 2 } }), true);
  assert.equal(isLegacySourceAllocation({ _tug10Applied: { "T10:0": 2 }, source: "TUG10" }), false);
  assert.equal(legacySourceCandidates({ _tug10Applied: { "T10:0": 2 }, source: "legacy" }).length, 2);
  assert.equal(legacySourceCandidates({ _tug10Applied: { "T10:0": 2 }, source: "legacy" })[0].kind, "TUG10_RETURN");
  assert.equal(sourceLotLabel(legacy), "Perlu alokasi sumber");
  assert.deepEqual(aggregateStocksByKatalog([{ katalogId: "K", qty: 3 }, { katalogId: "K", qty: 4 }]), [{ katalogId: "K", qty: 7, lots: 2 }]);
  assert.equal(getSourceLot({ sourceLot: { key: "L" } }).key, "L");
});

test("Stock Opname lot rows keep two stock identities and catalog total", () => {
  const rows = sourceLotRowsForCatalog([
    { id: "LOT-A", katalogId: "K", qty: 3 },
    { id: "LOT-B", katalogId: "K", qty: 4 },
    { id: "OTHER", katalogId: "X", qty: 9 },
  ], "K");
  assert.deepEqual(rows.map(row => row.id), ["LOT-A", "LOT-B"]);
  assert.equal(rows.reduce((total, row) => total + Number(row.qty || 0), 0), 7);
});
