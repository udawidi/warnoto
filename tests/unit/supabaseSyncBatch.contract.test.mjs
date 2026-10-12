import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _syncBatches } from "../../src/lib/supabaseSync.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const syncSource = fs.readFileSync(path.join(root, "src/lib/supabaseSync.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(root, "supabase/migrations/20261012b_mara_catalog_resolver_index.sql"), "utf8");
const schemaSource = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const resolverExpression = "nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '')";

test("MARA resolver index uses the exact predicate and concurrent deployment", () => {
  assert.match(migrationSource, /create index concurrently if not exists idx_mara_catalog_resolver_code/i);
  assert.ok(migrationSource.includes(`on public.mara_catalog ((${resolverExpression}));`));
  assert.match(migrationSource, /analyze public\.mara_catalog\s*;/i);
  assert.doesNotMatch(migrationSource, /create unique index/i);
});

test("schema mirrors the MARA resolver index without CONCURRENTLY", () => {
  const marker = "-- Mirror of 20261012b_mara_catalog_resolver_index.sql.";
  const mirror = schemaSource.slice(schemaSource.indexOf(marker));
  assert.ok(mirror.includes("create index if not exists idx_mara_catalog_resolver_code"));
  assert.ok(mirror.includes(`on public.mara_catalog ((${resolverExpression}));`));
  assert.doesNotMatch(mirror, /concurrently/i);
});

test("stock sync batches every catalog/stock/read/enriched request at 100", () => {
  const syncStart = syncSource.indexOf("export async function syncStockQtyToSupabase");
  const syncEnd = syncSource.indexOf("// Balapan promise vs timeout", syncStart);
  const syncFunction = syncSource.slice(syncStart, syncEnd);
  assert.match(syncSource, /const SYNC_BATCH_SIZE = 100;/);
  assert.match(syncSource, /for \(const batch of _syncBatches\(payload\)\)/);
  assert.match(syncFunction, /postSyncBatches\(\s*`\$\{SUPABASE_URL\}\/rest\/v1\/katalog\?on_conflict=id`/);
  assert.match(syncFunction, /postSyncBatches\(\s*`\$\{SUPABASE_URL\}\/rest\/v1\/stock_current\?on_conflict=katalog_id`/);
  assert.match(syncFunction, /for \(const ids of _syncBatches\(katalogIds\)\)/);
  assert.match(syncFunction, /if \(!existRes\.ok\) throw/);
  assert.doesNotMatch(syncFunction, /existRes\.ok \? await existRes\.json\(\) : \[\]/);
  assert.match(syncFunction, /postSyncBatches\(\s*`\$\{SUPABASE_URL\}\/rest\/v1\/katalog\?on_conflict=id`[\s\S]*Gagal sync lokasi katalog/);
});

test("_syncBatches covers empty, exact, boundary, and large inputs", () => {
  for (const [size, expected] of [[0, []], [1, [1]], [100, [100]], [101, [100, 1]], [626, [100, 100, 100, 100, 100, 100, 26]]]) {
    const batches = _syncBatches(Array.from({ length: size }, (_, index) => index));
    assert.deepEqual(batches.map(batch => batch.length), expected);
    assert.equal(batches.flat().length, size);
  }
});

test("qty snapshot is committed only after all sync request paths", () => {
  const syncStart = syncSource.indexOf("export async function syncStockQtyToSupabase");
  const syncEnd = syncSource.indexOf("// Balapan promise vs timeout", syncStart);
  const syncFunction = syncSource.slice(syncStart, syncEnd);
  const snapshot = syncFunction.indexOf("katalogIds.forEach(kid => lastSyncedStockQty.set");
  assert.ok(snapshot > syncFunction.indexOf("postSyncBatches(") + 1);
  assert.ok(snapshot > syncFunction.indexOf("for (const ids of _syncBatches(katalogIds))") + 1);
  assert.ok(syncFunction.indexOf("return { katalogCount: katalogPayload.length") > snapshot);
});
