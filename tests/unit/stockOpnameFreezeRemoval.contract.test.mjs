import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const [migration, verifier, app, stockOpname, tab, flow, tugTxn, tugApproval] = await Promise.all([
  read("supabase/migrations/20260921c_remove_stock_opname_freeze.sql"),
  read("supabase/verify_stock_opname_freeze_removal.sql"),
  read("App.jsx"),
  read("src/hooks/useStockOpname.js"),
  read("src/components/StockOpnameTab.jsx"),
  read("src/lib/stockOpnameFlow.js"),
  read("src/hooks/useTugTransactions.js"),
  read("src/hooks/useTugApprovals.js"),
]);

test("removal migration drops freeze objects and preserves freshness", () => {
  assert.match(migration, /drop trigger if exists trg_stock_opname_guard_freeze/i);
  assert.match(migration, /drop function if exists public\.guard_stock_opname_freeze_change/i);
  assert.match(migration, /drop function if exists public\.set_stock_opname_freeze\(text, boolean, text\[\]\)/i);
  assert.doesNotMatch(migration, /drop trigger if exists trg_stock_opname_set_updated_at/i);
  assert.doesNotMatch(migration, /alter publication supabase_realtime/i);
  assert.doesNotMatch(migration, /alter table public\.stock_opname/i);
  assert.match(migration, /begin;[\s\S]*commit;/i);
});

test("verifier asserts removal and retained realtime freshness", () => {
  for (const token of ["freeze_rpc_absent", "freeze_guard_function_absent", "freeze_guard_trigger_absent", "updated_at_column", "updated_at_trigger", "realtime_publication"]) {
    assert.match(verifier, new RegExp(token));
  }
  assert.doesNotMatch(verifier, /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i);
});

test("obsolete realtime freeze verifier is removed", async () => {
  await assert.rejects(
    access(new URL("../../supabase/verify_stock_opname_freeze_realtime.sql", import.meta.url)),
    /ENOENT/
  );
});

test("runtime contains no Stock Opname freeze action or TUG guard", () => {
  for (const source of [app, stockOpname, tab, flow, tugTxn, tugApproval]) {
    assert.doesNotMatch(source, /setOpnameFreeze|opnameFreeze|collectTxnGudangIds|findActiveFreezeSession|trg_stock_opname_guard_freeze/i);
  }
  assert.doesNotMatch(tab, /freezeSel|freezeBusy|toggleFreeze|FREEZE/);
});

test("heavy equipment fallback seed is TL-only", () => {
  assert.match(app, /heLocal\.length > 0 && hasRole\(currentUser, "TL"\)\)\s*syncMasterTable\("heavy_equipment"/);
});
