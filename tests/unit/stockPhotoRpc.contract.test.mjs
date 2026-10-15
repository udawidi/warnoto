import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20261015_stock_photo_rpc.sql", "utf8");
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const app = fs.readFileSync("App.jsx", "utf8");
const masterSync = fs.readFileSync("src/lib/masterSync.js", "utf8");
const rehearsal = fs.readFileSync("scripts/rehearse_stock_photo_rpc.mjs", "utf8");

test("stock photo RPCs are security-definer, scoped, and narrowly writable", () => {
  for (const source of [migration, schema]) {
    assert.match(source, /create or replace function public\.update_stock_photo\(\s*p_stock_id text,\s*p_field text,\s*p_photo_url text\s*\)/i);
    assert.match(source, /create or replace function public\.update_stock_nameplate_ocr\(\s*p_stock_id text,\s*p_photo_url text,\s*p_ocr_text text\s*\)/i);
    assert.match(source, /returns jsonb[\s\S]*?language plpgsql[\s\S]*?security definer[\s\S]*?set search_path = public, pg_catalog/i);
    assert.match(source, /p_field is null or p_field not in \('fotoNameplate', 'fotoKeseluruhan'\)/i);
    assert.match(source, /role (?:in|not in) \('ADMIN', 'TL', 'SUPERADMIN'\)/i);
    assert.match(source, /public\.can_access_upt\(/i);
    assert.match(source, /from public\.stocks where id = p_stock_id for update/i);
    assert.match(source, /from storage\.objects[\s\S]*bucket_id = 'stock-photos'/i);
    assert.match(source, /TUG3_STOCK_RPC_REQUIRED/); // guard remains independent of this RPC
    assert.match(source, /revoke all on function public\.update_stock_photo/i);
    assert.match(source, /grant execute on function public\.update_stock_photo\(text, text, text\) to authenticated/i);
    assert.match(source, /create index if not exists idx_stocks_upt on public\.stocks\(upt_id\)/i);

    const helperStart = source.indexOf("create or replace function public.stock_photo_object_path");
    const helperEnd = source.indexOf("revoke all on function public.stock_photo_object_path", helperStart);
    const helper = source.slice(helperStart, helperEnd);
    assert.match(helper, /https:\/\/warnoto\[\.\]com\/storage\/v1\/object\/public\/stock-photos/);
    assert.doesNotMatch(helper, /api-staging[.]warnoto[.]com/);
  }
});

test("photo RPC preserves protected stock fields and records changed photos", () => {
  assert.match(migration, /photoHistory/);
  assert.match(migration, /before[\s\S]*p_field/);
  assert.match(migration, /fotoNameplateOcr/);
  assert.match(migration, /updatedAt/);
  assert.match(migration, /update public\.stocks set data = v_data where id = v_stock\.id/);
  assert.match(migration, /same photo|same URL|is not distinct from/i);
});

test("OCR RPC is compare-and-set and ignores stale results", () => {
  assert.match(migration, /STALE_PHOTO/);
  assert.match(migration, /p_photo_url[\s\S]*fotoNameplate[\s\S]*is distinct from/i);
  assert.match(migration, /updated["']?,\s*false|updated', false/i);
  assert.match(app, /update_stock_nameplate_ocr/);
  assert.match(app, /STALE_PHOTO/);
});

test("frontend photo and OCR paths use RPC, not full-row stock upsert", () => {
  assert.match(masterSync, /table === "stocks"\) item\.uptId = row\.upt_id/);
  const photoStart = app.indexOf("async function updateStockFoto");
  const photoEnd = app.indexOf("// Auto-OCR nameplate", photoStart);
  const photoPath = app.slice(photoStart, photoEnd);
  assert.ok(photoStart >= 0 && photoEnd > photoStart);
  assert.match(photoPath, /updateStockPhotoRpc/);
  assert.match(app, /supabase\.rpc\("update_stock_photo"/);
  assert.doesNotMatch(photoPath, /saveToCloud\(\{stocks:/);

  const ocrStart = app.indexOf("async function runAutoOcrNameplates");
  const ocrEnd = app.indexOf("// Pemicu auto-OCR", ocrStart);
  const ocrPath = app.slice(ocrStart, ocrEnd);
  assert.match(ocrPath, /updateStockNameplateOcrRpc/);
  assert.match(app, /supabase\.rpc\("update_stock_nameplate_ocr"/);
  assert.doesNotMatch(ocrPath, /saveToCloud\(\{ stocks: ns \}/);
});

test("edit save snapshots both photo URLs and skips upsert for photo-only changes", () => {
  const saveStart = app.indexOf("async function saveStock");
  const saveEnd = app.indexOf("// Foto Data Stok WAJIB", saveStart);
  const saveStock = app.slice(saveStart, saveEnd);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.match(saveStock, /const photoChanges[\s\S]*?\.map\(field => \(\{ field, url: sf\[field\] \}\)\)/);
  assert.match(saveStock, /for \(const \{ field, url \} of photoChanges\)/);
  assert.match(saveStock, /updateStockPhotoRpc\(sf\.id, field, url\)/);
  assert.match(saveStock, /const rowEditableFields = \[/);
  assert.match(saveStock, /rowEditableFields\.some\(field => JSON\.stringify\(savedRow\?\.\[field\]\)/);
  assert.doesNotMatch(saveStock, /JSON\.stringify\(ns\.find\(s => s\.id === sf\.id\)\) !== JSON\.stringify\(original\)/);
});

test("rehearsal is opt-in and does not apply production migration", () => {
  assert.match(rehearsal, /PROPOSAL ONLY|scratch|rehearsal/i);
  assert.match(rehearsal, /20261015_stock_photo_rpc\.sql/);
  assert.doesNotMatch(rehearsal, /warnoto\.com\/rest\/v1|ssh minipc-gudang|supabase db/i);
});
