import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261012c_mara_orphan_1004160255.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");

test("orphan repair is narrow, exact, fail-closed, and idempotent", () => {
  assert.match(migration, /do \$migration\$/);
  assert.match(migration, /v_candidate_count <> 1/);
  assert.match(migration, /'000000004160255'/);
  assert.match(migration, /'CABLE CTRL;NYY;1X50mm2;0\.6\/1kV;UG'/);
  assert.match(migration, /'KAT-1004160255'/g);
  assert.match(migration, /'STK-SAP-3615-1004160255'/g);
  assert.match(migration, /coalesce\(data, '\{\}'::jsonb\) \|\| jsonb_build_object/);
  assert.match(migration, /'maraCode', btrim\(v_mara\.kode_material\)/);
  assert.match(migration, /'unit', btrim\(v_mara\.satuan\)/);
  assert.match(migration, /'_maraLocked', true/);
  assert.match(migration, /where id = 'KAT-1004160255';/);
  assert.match(migration, /where id = 'STK-SAP-3615-1004160255';/);
  assert.doesNotMatch(migration, /update public\.(katalog|stocks)\s+set\s+(qty|lokasi_id|created_at)/i);
});

test("schema excludes the production orphan repair", () => {
  assert.doesNotMatch(schema, /20261012c_mara_orphan_1004160255/);
  assert.doesNotMatch(schema, /MARA_ORPHAN_REPAIR_/);
  assert.doesNotMatch(schema, /KAT-1004160255|STK-SAP-3615-1004160255/);
});
