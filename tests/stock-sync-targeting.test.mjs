import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
const masterSyncSource = await readFile(new URL("../src/lib/masterSync.js", import.meta.url), "utf8");

function handlerSource(name) {
  const start = appSource.indexOf(`async function ${name}(id) {`);
  assert.notEqual(start, -1, `${name} must exist`);
  const nextHandler = appSource.indexOf("\n  async function ", start + 1);
  return appSource.slice(start, nextHandler === -1 ? undefined : nextHandler);
}

test("TL stock move and edit approvals use one-row upsert hints", () => {
  for (const name of ["approveStockMove", "rejectStockMove", "approveStockEdit", "rejectStockEdit"]) {
    assert.match(
      handlerSource(name),
      /saveToCloud\(\{stocks:\s*ns\},\s*\{stocksChangedRows:\s*ns\.filter\(s=>s\.id===id\)\}\)/,
      `${name} must sync only the affected stock row`,
    );
  }
});

test("approved stock deletion uses a one-row delete hint rather than reconciliation", () => {
  const approval = handlerSource("approveStockDelete");
  assert.match(approval, /saveToCloud\(\{stocks:\s*ns\},\s*\{stocksDeletedId:\s*id\}\)/);
  assert.doesNotMatch(approval, /saveToCloud\(\{stocks:\s*ns\}\)/);
  assert.match(masterSyncSource, /export async function deleteMasterTableRow\(table, id\)/);
  assert.match(masterSyncSource, /supabase\.from\(table\)\.delete\(\)\.eq\("id", id\)/);
});

test("stock delete hint selects the targeted delete path before full reconciliation", () => {
  assert.match(
    appSource,
    /const deletedStockId = hints\.stocksDeletedId;[\s\S]*?deleteMasterTableRow\("stocks", deletedStockId\)[\s\S]*?: syncMasterTable\("stocks", s, extraColsStocks\)/,
  );
});
