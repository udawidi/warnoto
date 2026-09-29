import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
const masterSyncSource = await readFile(new URL("../src/lib/masterSync.js", import.meta.url), "utf8");
const approvalsSource = await readFile(new URL("../src/hooks/useTugApprovals.js", import.meta.url), "utf8");

function handlerSource(name) {
  const start = appSource.indexOf(`async function ${name}(id) {`);
  assert.notEqual(start, -1, `${name} must exist`);
  const nextHandler = appSource.indexOf("\n  async function ", start + 1);
  return appSource.slice(start, nextHandler === -1 ? undefined : nextHandler);
}

function transactionApprovalSource() {
  const start = appSource.indexOf("async function approveTxn(txn, review = null)");
  assert.notEqual(start, -1, "approveTxn must exist");
  const end = appSource.indexOf("\n  async function rejectTxn", start + 1);
  assert.notEqual(end, -1, "rejectTxn must follow approveTxn");
  return appSource.slice(start, end);
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

test("catalog sync completes before stock sync and TUG-3 rolls back on save failure", () => {
  assert.match(
    appSource,
    /let katalogSyncPromise = null;[\s\S]*?katalogSyncPromise = [\s\S]*?syncTasks\.push\(\{ label: "Data Stok", promise: \(async \(\) => \{[\s\S]*?await katalogSyncPromise/,
  );
  assert.match(approvalsSource, /const saveOverrides = \{ txns: newTxns \};[\s\S]*?if \(touchedStockIds\.size\) saveOverrides\.stocks = newStocks[\s\S]*?if \(touchedKatalogIds\.size\) saveOverrides\.katalogList = newKatalog[\s\S]*?saveToCloud\(saveOverrides/);
  assert.match(approvalsSource, /if \(savedOk === false\) \{[\s\S]*?setTxns\(txns\); setStocks\(stocks\); setKatalogList\(katalogList\);[\s\S]*?return;/);
  assert.match(approvalsSource, /_tug3Applied/);
  assert.match(approvalsSource, /txn\.stockItems\.forEach\(\(si, itemIdx\) =>/);
  assert.doesNotMatch(approvalsSource, /txn\.stockItems\.indexOf\(si\)/);
  assert.match(approvalsSource, /const dedicatedSaved = false|let dedicatedSaved = false/);
  assert.match(approvalsSource, /if \(!dedicatedSaved\) \{[\s\S]*?CLOUD\.set\("pln_txns_v3", prevTxns\)/);
});

test("master table loader paginates beyond the PostgREST 1000-row limit", () => {
  assert.match(masterSyncSource, /const pageSize = 1000/);
  assert.match(masterSyncSource, /for \(let from = 0; ; from \+= pageSize\)/);
  assert.match(masterSyncSource, /\.order\("id", \{ ascending: true \}\)\.range\(from, from \+ pageSize - 1\)/);
  assert.match(masterSyncSource, /if \(!data \|\| data\.length < pageSize\) return rows/);
});

test("TUG-10 approval syncs only resources changed by the approved items", () => {
  const approval = transactionApprovalSource();
  assert.match(approval, /const saveOverrides = \{txns: newTxns\}/);
  assert.match(approval, /if \(touchedStockIds\.size\) saveOverrides\.stocks = newStocks/);
  assert.match(approval, /if \(touchedKatalogIds\.size\) saveOverrides\.katalogList = newKatalog/);
  assert.match(approval, /if \(newAttbItems\.length\) saveOverrides\.attbList = nextAttb/);
  assert.doesNotMatch(approval, /saveToCloud\(\{stocks: newStocks, txns: newTxns, katalogList: newKatalog, attbList: nextAttb\}/);
});

test("TUG-10 approval is retry-safe after a partial stock write", () => {
  const approval = transactionApprovalSource();
  assert.match(approval, /loadMasterTable\("stocks"\)/);
  assert.match(approval, /loadMasterTable\("katalog"\)/);
  assert.match(approval, /_tug10Applied/);
  assert.match(approval, /const effectKey = `\$\{txn\.id\}:\$\{itemIdx\}`/);
  assert.match(approval, /const qtyToApply = Math\.max\(0, qty - alreadyApplied\)/);
  assert.match(approval, /dedicatedSaved = await upsertTug10Transaction\(approvedTxn\)/);
  assert.match(approval, /if \(!dedicatedSaved\)/);
  assert.match(approval, /tug10ApprovalInFlightRef\.current\.has\(txn\.id\)/);
  assert.match(approval, /tug10ApprovalInFlightRef\.current\.delete\(txn\.id\)/);
});

test("TUG-10 ATTB approval posts stock and keeps the MRWI candidate", () => {
  const approval = transactionApprovalSource();
  assert.doesNotMatch(approval, /if \(si\.statusMaterial === "Bongkaran ATTB \(MTU\)"\) return/);
  assert.match(approval, /const jenisBarangFinal = STATUS_RETUR_TO_JENIS\[si\.statusMaterial\]/);
  assert.match(approval, /jenisBarang:jenisBarangFinal, sapStatus:"Non-SAP"/);
  assert.match(approval, /if \(si\.statusMaterial !== "Bongkaran ATTB \(MTU\)"\) return/);
  assert.match(approval, /sourceTxnId: txn\.id,\s*sourceItemIdx: idx/);
});

test("TUG-10 ATTB backfill is dry-run, canonical, and DB-payload safe", async () => {
  const source = await readFile(new URL("../scripts/backfill_tug10_attb_stock.mjs", import.meta.url), "utf8");
  assert.match(source, /sourceLotKey\(/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /stage: row\.stage/);
  assert.match(source, /katalog_id:kat\.id, lokasi_id:txn\.lokasiTujuanId, data:next/);
  assert.match(source, /id:kat\.id, data:kat, created_at/);
  assert.match(source, /sourceLot cocok tanpa marker; perlu review/);
  assert.match(source, /katalogMode === "existing" && !kat/);
  assert.match(source, /canonicalKatalogCode\(k\.katalog\)/);
  assert.match(source, /some\(si => si\.statusMaterial === "Bongkaran ATTB \(MTU\)"\)/);
  assert.match(source, /sourceDate:txn\.approvedAt \|\| txn\.updatedAt \|\| txn\.createdAt/);
  assert.match(source, /changes/);
  assert.match(source, /if \(!APPLY\)/);
});
