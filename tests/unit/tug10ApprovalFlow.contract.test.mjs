import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const txns = fs.readFileSync(new URL("../../src/hooks/useTugTransactions.js", import.meta.url), "utf8");
const approval = fs.readFileSync(new URL("../../src/components/ApprovalTab.jsx", import.meta.url), "utf8");

test("TUG-10 final button stays open and reports server submission", () => {
  assert.match(approval, /const \[tug10SubmittingId, setTug10SubmittingId\]/);
  assert.match(approval, /const ok = await approveTxn\(tug10ReviewTxn\)/);
  assert.match(approval, /if \(ok\) setTug10ReviewTxn\(null\)/);
  assert.match(approval, /Menyetujui…/);
  assert.match(approval, /disabled=\{!tug10Previewed \|\| tug10SubmittingId===tug10ReviewTxn\.id(?: \|\| tug10HasAmbiguousTarget)?\}/);
  assert.doesNotMatch(approval, /onClick=\{\(\)=>\{approveTxn\(tug10ReviewTxn\);setTug10ReviewTxn\(null\);\}\}/);
});

test("TUG-10 TL forwarding persists server-first and only caches the transaction", () => {
  const forwarding = app.match(/const forwardedTxn = \{[\s\S]*?\n          \}/)?.[0] || "";
  assert.match(app, /tug10ApprovalInFlightRef\.current\.has\(txn\.id\)/);
  assert.match(app, /await upsertTug10Transaction\(forwardedTxn\)/);
  assert.match(app, /const latestTxns = stateRef\.current\.txns \|\| txns/);
  assert.match(app, /CLOUD\.set\("pln_txns_v3", newTxns\)/);
  assert.ok(!forwarding.includes("saveToCloud"), "TUG-10 TL forwarding must not full-sync before server ack");
});

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
