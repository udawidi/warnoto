import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveWarehouseCapacity, validateWarehouseCapacity } from "../../src/lib/warehouseCapacity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("derives sisa and utilization without rounding", () => {
  const value = deriveWarehouseCapacity({ luasLahanM2: 100, persediaanPct: .866 });
  assert.ok(Math.abs(value.sisaLuasM2 - 13.4) < 1e-9);
  assert.equal(value.persentaseTerpakai, 0.866);
  assert.equal(deriveWarehouseCapacity({ luasLahanM2: 10, persediaanPct: 1 }).persentaseTerpakai, 1);
  assert.equal(deriveWarehouseCapacity({ luasLahanM2: 100, persediaanPct: .5, cadangPct: .366 }).luasTerpakaiM2, 86.6);
});

test("validates physical and composition bounds", () => {
  const valid = validateWarehouseCapacity({ luasLahanM2: 100, persediaanPct: .2, cadangPct: .2, preMemoryPct: .2, attbPct: .2, lainnyaPct: .2 });
  assert.equal(valid.valid, true);
  assert.equal(validateWarehouseCapacity({ luasLahanM2: 100, persediaanPct: .20001, cadangPct: .2, preMemoryPct: .2, attbPct: .2, lainnyaPct: .2 }).valid, false);
  assert.equal(validateWarehouseCapacity({ luasLahanM2: 100, persediaanPct: .3, cadangPct: .3, preMemoryPct: .3, attbPct: .3, lainnyaPct: .3 }).valid, false);
  assert.equal(validateWarehouseCapacity({ luasLahanM2: 100, persediaanPct: -.01 }).valid, false);
  assert.equal(validateWarehouseCapacity({ luasLahanM2: 100, persediaanPct: 1.01 }).valid, false);
  assert.equal(validateWarehouseCapacity({ luasLahanM2: 0, persediaanPct: .01 }).valid, false);
  assert.equal(validateWarehouseCapacity({ luasLahanM2: 0 }).valid, true);
});

test("composition below 100% is valid without warning", () => {
  const result = validateWarehouseCapacity({ luasLahanM2: 100, persediaanPct: .2 });
  assert.equal(result.valid, true);
  assert.equal(result.warning, "");
});

test("capacity edit contract is DB-first, upsert-only, and one-confirm sheet flow", () => {
  const masterSync = fs.readFileSync(path.join(root, "src/lib/masterSync.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "App.jsx"), "utf8");
  const tab = fs.readFileSync(path.join(root, "src/components/KapasitasGudangTab.jsx"), "utf8");
  const saveFlow = tab.slice(tab.indexOf("async function saveEditRecord"), tab.indexOf("async function syncFromSheet"));
  assert.match(masterSync, /export async function syncWarehouseCapacityRows\(rows\)/u);
  assert.match(masterSync, /syncWarehouseCapacityRows[\s\S]*?\.upsert\(payload, \{ onConflict: "id" \}\)/u);
  const rowSyncStart = masterSync.indexOf("export async function syncWarehouseCapacityRows");
  const rowSyncEnd = masterSync.indexOf("// ═", rowSyncStart);
  assert.doesNotMatch(masterSync.slice(rowSyncStart, rowSyncEnd), /\.delete\(/u);
  assert.match(app, /const currentList = stateRef\.current\.gudangCapacityList \|\| gudangCapacityList/u);
  assert.match(saveFlow, /if \(saving \|\| pushing \|\| !editRecord\)/u);
  assert.match(saveFlow, /await onSaveCapacityRow\?\.\(updated\)/u);
  assert.match(saveFlow, /dryRun: true/u);
  assert.equal((saveFlow.match(/confirm\(/gu) || []).length, 1);
  assert.match(saveFlow, /Database sudah tersimpan/u);
  assert.match(saveFlow, /Sheet dibatalkan/u);
  assert.match(saveFlow, /Database tersimpan, tetapi Sheet gagal/u);
  assert.match(saveFlow, /waktuUpdate: jakartaTimestamp\(\)/u);
  assert.match(tab, /step="any"/u);
  assert.doesNotMatch(saveFlow, /Math\.round\(/u);
  assert.match(tab, /Terpakai otomatis/u);
  assert.match(tab, /areaLabel\(deriveWarehouseCapacity/u);
  assert.doesNotMatch(saveFlow, /editRecord\.luasTerpakaiM2/u);
});

test("canonical schema and migration carry the same capacity constraint", () => {
  const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260915b_warehouse_capacity_bounds.sql"), "utf8");
  for (const expression of [
    "warehouse_capacity_bounds_check",
    "luas_terpakai_m2 <= luas_lahan_m2 + 0.000001",
    "persentase_terpakai between 0 and 1",
    "coalesce(persediaan_pct, 0) + coalesce(cadang_pct, 0) + coalesce(pre_memory_pct, 0) + coalesce(attb_pct, 0) + coalesce(lainnya_pct, 0) <= 1.000001",
    "status_kapasitas = case when persentase_terpakai >= 0.90",
  ]) {
    assert.ok(schema.includes(expression), `schema.sql missing ${expression}`);
    assert.ok(migration.includes(expression), `migration missing ${expression}`);
  }
});

test("private capacity photo contract uses scoped immutable paths", () => {
  const photo = fs.readFileSync(path.join(root, "src/lib/warehouseCapacityPhoto.js"), "utf8");
  const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260915c_warehouse_capacity_photos.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(root, "supabase/migrations/20260915c_warehouse_capacity_photos.rollback.sql"), "utf8");
  assert.match(photo, /image\/jpeg.*image\/png.*image\/webp/su);
  assert.match(photo, /auth\.getUser\(\)/u);
  assert.match(photo, /user\.id/u);
  assert.match(photo, /\$\{safeSegment\(userId\)\}\/capacity\/\$\{safeSegment\(recordId\)\}\/\$\{randomId\}\.jpg/u);
  assert.match(photo, /createSignedUrl/u);
  assert.match(schema, /warehouse-capacity-photos.*false/su);
  assert.match(migration, /p\.role in \('ADMIN', 'TL', 'SUPERADMIN'\)/u);
  assert.doesNotMatch(rollback, /drop (column|bucket)|delete from storage\.buckets/iu);
});
