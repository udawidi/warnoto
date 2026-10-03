import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const dataStock = fs.readFileSync(new URL("../../src/components/DataStokTab.jsx", import.meta.url), "utf8");
const opnameTab = fs.readFileSync(new URL("../../src/components/StockOpnameTab.jsx", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../../supabase/migrations/20261003_stock_opname_photo_scoped.sql", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../../scripts/embed_stock_photos.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../../.github/workflows/embed-stock-photos.yml", import.meta.url), "utf8");
const backfill = fs.readFileSync(new URL("../../scripts/stock_opname_photo_history_backfill.mjs", import.meta.url), "utf8");

test("photo upload contract is UPT-scoped and never overwrites", () => {
  assert.match(app, /Foto stok wajib memiliki UPT/);
  assert.match(app, /upsert: false/);
  assert.match(app, /const uptFolder = String\(uptId\)/);
});

test("AI search and embeddings use scoped UPT identity", () => {
  assert.match(app, /match_stock_photos_scoped/);
  assert.match(app, /stocksByUpt/);
  assert.match(app, /matchNameplateAll\(text, \[\], uptStocks\)/);
  assert.match(app, /matchNameplateToKatalog\(text, katalogList\)/);
  assert.match(dataStock, /resultUpt/);
  assert.match(script, /upt_id: j\.uptId/);
  assert.match(script, /opname-nameplate/);
  assert.match(script, /headers: \{ apikey: OCRSPACE_API_KEY \}/);
  assert.match(workflow, /OCRSPACE_API_KEY/);
});

test("migration is fail-closed and service-role write only", () => {
  assert.match(migration, /alter column upt_id set not null/);
  assert.match(migration, /can_access_upt\(upt_id\)/);
  assert.match(migration, /revoke insert, update, delete/);
  assert.match(migration, /match_stock_photos_scoped/);
  assert.match(migration, /unique_names/);
  assert.match(migration, /unique_slugs/);
  assert.match(migration, /regexp_replace\(trim\(data->>'nama'/);
  assert.match(migration, /split_part\(e\.id, '_'\, 2\)/);
  assert.doesNotMatch(migration, /join public\.stocks s on s\.data->>'katalog'/);
});

test("backfill orders sessions and writes each final stock once", () => {
  assert.match(backfill, /sortedOpnameRows/);
  assert.match(backfill, /workingStocks = new Map/);
  assert.match(backfill, /finalUpdates = new Map/);
  assert.match(backfill, /workingStocks\.set\(currentKey, result\.stock\)/);
  assert.match(backfill, /\.eq\("id", id\)\.eq\("upt_id", next\.uptId\)/);
});

test("stock detail mounts Opname tab content conditionally", () => {
  assert.match(app, /stockDetailTab==="opname"/);
  assert.match(app, /loading="lazy" decoding="async"/);
  assert.match(app, /listScopedOpnameSessions/);
  assert.match(app, /opnamePhotoActiveId/);
  assert.match(app, /activeId === opname\.id/);
  assert.match(app, /showWork=\{tab==="opname"/);
  assert.match(opnameTab, /showWork && <div>/);
});
