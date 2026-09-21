import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../supabase/migrations/20260921_stock_opname_freeze_realtime.sql", import.meta.url), "utf8");
const verifier = await readFile(new URL("../../supabase/verify_stock_opname_freeze_realtime.sql", import.meta.url), "utf8");
const hook = await readFile(new URL("../../src/hooks/useStockOpname.js", import.meta.url), "utf8");
const tab = await readFile(new URL("../../src/components/StockOpnameTab.jsx", import.meta.url), "utf8");
const stockScope = await readFile(new URL("../../src/lib/stockScope.js", import.meta.url), "utf8");

test("freeze migration is transactional, idempotent, and Realtime-ready", () => {
  assert.match(migration, /begin;[\s\S]*commit;/i);
  assert.match(migration, /add column if not exists updated_at timestamptz/i);
  assert.match(migration, /trg_stock_opname_set_updated_at/i);
  assert.match(migration, /trg_stock_opname_guard_freeze/i);
  assert.match(migration, /to_regclass|pg_publication_tables/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.stock_opname/i);
});

test("database rejects authenticated non-TL freeze changes and exposes a scoped TL RPC", () => {
  assert.match(migration, /p\.role = 'TL'/i);
  assert.match(migration, /STOCK_OPNAME_FREEZE_ROLE_DENIED/i);
  assert.match(migration, /v_opname\.upt_id is distinct from v_actor\.upt_id/i);
  assert.match(migration, /STOCK_OPNAME_FREEZE_GUDANG_SCOPE_DENIED/i);
  assert.match(migration, /set_stock_opname_freeze\(text, boolean, text\[\]\)/i);
  assert.match(migration, /grant execute on function public\.set_stock_opname_freeze[\s\S]*authenticated/i);
  assert.doesNotMatch(hook, /hasRole\(currentUser,\s*"ADMIN",\s*"TL",\s*"ASMAN"\)/);
  assert.match(hook, /rpc\("set_stock_opname_freeze"/);
  assert.match(tab, /hasRole\(currentUser,\s*"TL"\)/);
  assert.doesNotMatch(tab, /ensureAutoFreeze/);
});

test("verifier is read-only and checks all new invariants", () => {
  for (const token of ["updated_at_column", "freeze_rpc", "freeze_guard_trigger", "realtime_publication"]) {
    assert.match(verifier, new RegExp(token));
  }
  assert.doesNotMatch(verifier, /\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table)\b/i);
});

test("client resync and desktop autosave preserve newer or dirty edits", () => {
  assert.match(hook, /postgres_changes/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /SUBSCRIBED|CHANNEL_ERROR|TIMED_OUT/);
  assert.match(hook, /pendingSaveIdsRef/);
  assert.match(hook, /maybeSingle\(\)/);
  assert.match(hook, /mapStockScopeRow/);
  assert.match(stockScope, /row\?\.updated_at/);
  assert.match(tab, /mergeOpnameForSave\(prev, incoming/);
  assert.match(tab, /scheduleDesktopSave\(\)/);
  assert.match(tab, /scheduleDesktopSave\(0\)/);
  assert.match(tab, /onBlur=\{saveDesktopQty\}/);
  assert.match(tab, /Menyimpan\.\.\./);
  assert.match(tab, /Tersimpan/);
  assert.match(tab, /draft lokal dipertahankan/);
  assert.match(tab, /editGenerationRef/);
  assert.match(tab, /const isLatest = generation === null/);
  assert.match(tab, /if \(saved && isLatest\)/);
  assert.match(tab, /scheduleDesktopSave\(0\)/);
  assert.match(tab, /clearDesktopDraftTracking/);
  assert.match(tab, /Perubahan belum tersimpan/);
});
