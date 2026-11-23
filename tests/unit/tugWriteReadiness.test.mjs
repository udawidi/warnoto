import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createTugWriteGuard } from "../../src/lib/tugWriteGuard.js";

const app = readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
test("a TUG action checks the current scope and write readiness when the user invokes it", () => {
  const scope = { current: "one" };
  const state = { current: { tugWritesReady: false } };
  let calls = 0;
  const approve = createTugWriteGuard(() => scope.current === "one" && state.current.tugWritesReady, () => {})(amount => calls += amount);
  assert.equal(approve(2), false);
  assert.equal(calls, 0);
  state.current.tugWritesReady = true;
  assert.equal(approve(2), 2);
  scope.current = "two";
  assert.equal(approve(2), false);
  assert.equal(calls, 2);
});

test("transaction mutations are gated in both screens while preview and retry remain accessible", () => {
  assert.match(app, /const tugWritesReady = !loading && !dataRefreshing && txnScope === txnOwner/);
  assert.match(app, /writeRefs\.every\(table => printLoads\[table\] === "ready"\)/);
  assert.equal(app.match(/approveTUG3Final_Asman=\{guardTugWrite\(approveTUG3Final_Asman\)\}/g)?.length, 2);
  assert.match(app, /approveTxn=\{guardTugWrite\(approveTxn\)\}/);
  assert.match(app, /setDocPreview=\{setDocPreview\}/);
  assert.match(app, /retryPrintLoads\.current\?\.\(failedWriteRefs\)/);
});
