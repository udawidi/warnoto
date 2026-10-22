import assert from "node:assert/strict";
import test from "node:test";
import { canonicalRowToTxn } from "../../src/lib/tugCanonical.js";

test("canonical items use line_no order for stable item indexes", () => {
  const txn = canonicalRowToTxn({
    id: "T1", doc_type: "TUG10", version: 1, doc_sequence: 1,
    document: {}, tug_items: [
      { line_no: 2, snapshot: {}, katalog_id: "K2", qty: 2 },
      { line_no: 1, snapshot: {}, katalog_id: "K1", qty: 1 },
    ], tug_approvals: [], status: "PENDING", stage: "PENDING_TL",
  });
  assert.deepEqual(txn.stockItems.map(item => item.katalogId), ["K1", "K2"]);
});
