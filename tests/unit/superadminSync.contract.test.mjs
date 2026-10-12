import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { buildStockQtySnapshot } from "../../src/lib/supabaseSync.js";

const app = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");

test("stock snapshot aggregates quantities per katalog", () => {
  assert.deepEqual(buildStockQtySnapshot([
    { katalogId: "K1", qty: 2 },
    { katalogId: "K1", qty: 3 },
    { katalogId: "K2", qty: 0 },
    { qty: 99 },
  ]), { K1: 5, K2: 0 });
});

test("bootstrap guard baselines server state before auto-sync", () => {
  assert.match(app, /loading \|\| dataRefreshing \|\| !supabase/);
  assert.match(app, /bootstrapBaselinePendingRef\.current/);
  assert.match(app, /primeStockQtySyncSnapshot\(stocks\)/);
});

test("TUG and material cadang loaders share the three-request scheduler", () => {
  assert.match(app, /const domainTasks = \[/);
  assert.match(app, /runBootstrapTasks\(\[\.\.\.masterTasks, \.\.\.maturityTasks, \.\.\.domainTasks\], \{ limit: 3/);
  assert.match(app, /normalizeDomainLoad = value => value && Array\.isArray\(value\.rows\)/);
  assert.match(app, /\{ unavailable:true, rows:\[\] \}/);
  assert.match(app, /bootstrap TUG canonical/);
  assert.match(app, /bootstrap material cadang/);
});

test("MARA satuan query is lazy and session-cached", () => {
  assert.match(app, /const maraSatuanLoadedRef = useRef\(false\)/);
  assert.match(app, /ensureMaraSatuanOptions\(\)/);
  assert.doesNotMatch(app, /useEffect\(\(\) => \{\s*if \(!supabase\) return;[\s\S]{0,300}mara_catalog/);
});
