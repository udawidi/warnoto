import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
const masterSyncSource = await readFile(new URL("../src/lib/masterSync.js", import.meta.url), "utf8");
const approvalsSource = await readFile(new URL("../src/hooks/useTugApprovals.js", import.meta.url), "utf8");
const tug10AtomicMigration = await readFile(new URL("../supabase/migrations/20261001_tug10_atomic_final_approval.sql", import.meta.url), "utf8");

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

test("TUG-10 final approval uses the atomic RPC and merges only touched rows", () => {
  const approval = transactionApprovalSource();
  const tug10 = approval.slice(approval.indexOf('if (txn.docType === "TUG10")'));
  assert.match(tug10, /approveTug10Final\(txn\.id, tug10ApprovalKeysRef\.current\[txn\.id\]\)/);
  assert.match(tug10, /setStocks\(prev => mergeRows\(prev, result\.stocks\)\)/);
  assert.match(tug10, /setKatalogList\(prev => mergeRows\(prev, result\.katalogs\)\)/);
  assert.match(tug10, /setAttbList\(prev => mergeRows\(prev, result\.attbDrafts\)\)/);
  assert.doesNotMatch(tug10, /loadMasterTable\("stocks"\)/);
  assert.doesNotMatch(tug10, /loadMasterTable\("katalog"\)/);
  assert.doesNotMatch(tug10, /saveToCloud\(saveOverrides/);
});

test("TUG-10 approval remains retry-safe and fail-closed", async () => {
  const approval = transactionApprovalSource();
  const tug10 = approval.slice(approval.indexOf('if (txn.docType === "TUG10")'));
  const sync = await readFile(new URL("../src/lib/tug10Sync.js", import.meta.url), "utf8");
  assert.match(sync, /supabase\.rpc\("approve_tug10_final"/);
  assert.match(sync, /p_idempotency_key: idempotencyKey/);
  assert.match(tug10, /tug10ApprovalKeysRef\.current\[txn\.id\] \|\|= crypto\.randomUUID\(\)/);
  assert.match(tug10, /approveTug10Final\(txn\.id, tug10ApprovalKeysRef\.current\[txn\.id\]\)/);
  assert.match(tug10, /delete tug10ApprovalKeysRef\.current\[txn\.id\]/);
  assert.match(tug10, /if \(!supabase\)/);
  assert.match(tug10, /tug10ApprovalInFlightRef\.current\.has\(txn\.id\)/);
  assert.match(tug10, /tug10ApprovalInFlightRef\.current\.delete\(txn\.id\)/);
  assert.match(tug10AtomicMigration, /new\.data->'_tug10Applied'\) is distinct from \(old\.data->'_tug10Applied'/);
  assert.match(tug10AtomicMigration, /> coalesce\(nullif\(old\.data->>'qty', ''\)::numeric, 0\)/);
  assert.doesNotMatch(tug10AtomicMigration, /new\.data->>'qty' is distinct from old\.data->>'qty'/);
});

test("TUG-10 ATTB approval posts stock and keeps the MRWI candidate", () => {
  const approval = transactionApprovalSource();
  assert.match(approval, /result\.attbDrafts/);
  assert.match(approval, /enqueueTugNotif\(\{[\s\S]*docType: "TUG10"/);
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
