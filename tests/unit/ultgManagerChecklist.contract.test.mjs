import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../src/components/ApprovalTab.jsx", import.meta.url), "utf8");

test("Manager ULTG approval is gated by the review checklist", () => {
  assert.match(source, /setTug5ReviewTxn\(t\)/);
  assert.match(source, /tug5Checks\.every\(Boolean\)/);
  assert.match(source, /disabled=\{!tug5Checks\.every\(Boolean\)\}/);
  assert.match(source, /approveTUG5_MgrULTG\(tug5ReviewTxn\)/);
  assert.doesNotMatch(source, /onClick=\{\(\)=>approveTUG5_MgrULTG\(t\)\}/);
});

test("Manager ULTG overview falls back to the stock source lot label", () => {
  assert.match(source, /formatKontrakSumber\(si\.sourceSnapshot,stock\?\.kontrakRefs\)\|\|sourceLotLabel\(stock\)/);
});
