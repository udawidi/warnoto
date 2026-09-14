import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const txns = fs.readFileSync(new URL("../../src/hooks/useTugTransactions.js", import.meta.url), "utf8");
const approval = fs.readFileSync(new URL("../../src/components/ApprovalTab.jsx", import.meta.url), "utf8");

test("TUG-10 has explicit TL then Asman stages", () => {
  assert.match(txns, /nextTug10Stage[\s\S]*?"PENDING_TL"/);
  assert.match(txns, /nextTug10Stage[\s\S]*?"PENDING_ASMAN"/);
  assert.match(app, /const approvalStage = txn\.stage \|\| \(txn\.requiredApprover === "ASMAN"/);
  assert.match(app, /approvalStage === "PENDING_TL"[\s\S]*?forwardedTxn[\s\S]*?stage: "PENDING_ASMAN"/);
  assert.match(app, /approvalStage !== "PENDING_ASMAN"/);
});

test("TUG-10 queue labels and actions distinguish TL from final Asman", () => {
  assert.match(approval, /TUG10[\s\S]*?Menunggu TL Logistik/);
  assert.match(approval, /TUG10[\s\S]*?Menunggu Asman Final/);
  assert.match(approval, /setTug10Previewed\(false\);setTug10ReviewTxn\(t\)/);
  assert.doesNotMatch(approval, /Setujui TL → Asman/);
  assert.match(approval, /Periksa & Teruskan ke Asman/);
  assert.match(approval, /tug10ReviewTxn\.stage===\"PENDING_TL\"\s*\?/);
  assert.match(approval, /Setujui — Stok Masuk/);
  assert.match(approval, /t\.docType!==\"TUG10\" \|\| tug10StageOf\(t\)===\"PENDING_TL\"/);
});
