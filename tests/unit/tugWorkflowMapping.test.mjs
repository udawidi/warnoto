import assert from "node:assert/strict";
import test from "node:test";
import { rowToTxn } from "../../src/lib/tugWorkflowSync.js";

const row = {
  id: "TEST-TUG5", doc_type: "TUG5", upt_id: "UPT-A", uit_id: null,
  stage: "DRAFT", status: "DRAFT", version: 1, data: { uitId: "UIT-TUJUAN" },
};

test("TUG-5 UPT keeps the destination UIT after database reload", () => {
  assert.equal(rowToTxn(row).uitId, "UIT-TUJUAN");
});

test("UIT-scoped workflow keeps the authoritative scope column", () => {
  assert.equal(rowToTxn({ ...row, upt_id: null, uit_id: "UIT-PEMILIK" }).uitId, "UIT-PEMILIK");
  assert.equal(rowToTxn({ ...row, doc_type: "TUG7", upt_id: null, uit_id: "UIT-PEMILIK" }).uitId, "UIT-PEMILIK");
});
