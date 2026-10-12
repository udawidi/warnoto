import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const transactions = fs.readFileSync("src/hooks/useTugTransactions.js", "utf8");
const modals = fs.readFileSync("src/components/TugFormModals.jsx", "utf8");
const approvals = fs.readFileSync("src/hooks/useTugApprovals.js", "utf8");
const canonical = fs.readFileSync("src/lib/tugCanonical.js", "utf8");

test("new TUG-3/TUG-10 material requires a locked MARA identity", () => {
  assert.match(transactions, /si\._maraLocked\s*&&\s*si\.namaBaru\?\.trim\(\)\s*&&\s*si\.katalogBaru\?\.trim\(\)\s*&&\s*si\.satuanBaru\?\.trim\(\)/);
  assert.match(transactions, /pilih material dari MARA/);
});

test("new-item forms disable manual identity editing and unlock fallback", () => {
  assert.doesNotMatch(modals, /Lepas kunci/);
  assert.match(modals, /value=\{si\.namaBaru\} readOnly/);
  assert.match(modals, /value=\{si\.katalogBaru\} readOnly/);
  assert.doesNotMatch(modals, /isi manual di bawah/);
});

test("final approval uses atomic RPC response rows and UUID helper", () => {
  assert.match(approvals, /approveTug3Final\(txn\.id/);
  assert.match(approvals, /result\.stocks/);
  assert.match(approvals, /result\.katalogs/);
  assert.match(canonical, /export function newTugIdempotencyKey\(\)/);
  assert.match(canonical, /return \"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx\"/);
});
