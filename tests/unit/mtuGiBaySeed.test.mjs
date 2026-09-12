import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSeed, dedupeRows, deterministicId, parseWorkbook } from "../../scripts/generate_mtu_gi_bay_seed.mjs";
import { mtuKhsMasterQuery } from "../../src/features/mtu-khs/mtuKhsApi.js";

const workbook = "D:/CLAUDE/WARNOTO data/Data Material HAR/BAY GI.xlsx";

test("BAY GI workbook transforms to complete scoped master", { skip: !fs.existsSync(workbook) }, () => {
  const rows = parseWorkbook(workbook);
  const seed = buildSeed(rows);
  assert.equal(rows.length, 2429);
  assert.equal(seed.length, 185);
  assert.equal(seed.reduce((total, gi) => total + gi.bays.length, 0), 2427);
  assert.equal(new Set(seed.map(gi => gi.uptId)).size, 6);
  assert.equal(new Set(seed.map(gi => `${gi.uptId}|${gi.ultgName}`)).size, 15);
  assert.equal(seed.flatMap(gi => gi.bays).filter(bay => !bay.active).length, 80);
  assert.equal(rows.filter(row => !row.bayExternalId).length, 118);
  assert.equal(rows.filter(row => !row.giExternalId).length, 120);
  assert.equal(rows.length - dedupeRows(rows).length, 2);
});

test("dedupe keeps complete source rows and distinct bays with duplicate external IDs", () => {
  const rows = [
    { sourceRow: 2, uptId: "UPT-MLG", ultgName: "KRIAN", giName: "GITET 500KV KRIAN", bayName: "IBT#5", bayExternalId: "TRS-3612-360.360-B0029", giExternalId: "484", status: "OPERASI", active: true },
    { sourceRow: 3, uptId: "UPT-MLG", ultgName: "KRIAN", giName: "GITET 500KV KRIAN", bayName: "IBT#6", bayExternalId: "TRS-3612-360.360-B0029", giExternalId: "484", status: "OPERASI", active: true },
    { sourceRow: 4, uptId: "UPT-GRS", ultgName: "GRESIK", giName: "GI 70KV MANYAR", bayName: "IBT#4", bayExternalId: "TRS-1", giExternalId: "10", status: "OPERASI", active: true },
    { sourceRow: 5, uptId: "UPT-GRS", ultgName: "GRESIK", giName: "GI 70KV MANYAR", bayName: "IBT#4", bayExternalId: "", giExternalId: "", status: "1/1/90", active: true },
  ];
  const seed = buildSeed(rows);
  assert.equal(seed.flatMap(gi => gi.bays).length, 3);
  assert.equal(dedupeRows(rows).find(row => row.bayName === "IBT#4").sourceRows.length, 2);
});

test("NGIMBANG is pinned to BABAT", { skip: !fs.existsSync(workbook) }, () => {
  const gi = buildSeed(parseWorkbook(workbook)).find(item => item.name === "GI 150KV NGIMBANG");
  assert.equal(gi.ultgName, "BABAT");
});

test("generated migration is complete, auditable, additive, and idempotent", () => {
  const migrationPath = "supabase/migrations/20260912b_mtu_gi_bay_full_seed.sql";
  const migration = fs.readFileSync(migrationPath, "utf8");
  const payloadText = migration.match(/\$json\$([\s\S]*?)\$json\$/)?.[1];
  assert.ok(payloadText, "migration JSON payload is present");
  const seed = JSON.parse(payloadText);
  assert.equal(seed.length, 185);
  assert.equal(seed.reduce((total, gi) => total + gi.bays.length, 0), 2427);
  assert.equal(seed.some(gi => "sourceItems" in gi), false);

  const ngimbang = seed.find(gi => gi.name === "GI 150KV NGIMBANG");
  assert.equal(ngimbang.ultgName, "BABAT");
  assert.deepEqual(ngimbang.sourceImport.sourceUltgNames, ["BABAT", "MADIUN"]);
  assert.equal(ngimbang.sourceImport.anomalies[0].type, "ULTG_CONFLICT");

  const duplicateExternalId = seed.flatMap(gi => gi.bays).filter(bay => bay.externalId === "TRS-3612-360.360-B0029");
  assert.deepEqual(duplicateExternalId.map(bay => bay.name).sort(), ["IBT#5 500/150KV (HV)", "IBT#6 500/150KV (HV)"]);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
  assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE|DROP)\b/i);
  assert.doesNotMatch(migration, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(migration, /MTU_FULL_SEED_ULTG_NOT_UNIQUE/);
  assert.match(migration, /MTU_FULL_SEED_GI_ID_COLLISION/);
  assert.match(migration, /MTU_FULL_SEED_BAY_ID_COLLISION/);
});

test("long deterministic IDs remain bounded and collision-resistant", () => {
  const left = deterministicId("MTU-BAY", "UPT-X", "A".repeat(250), "B");
  const right = deterministicId("MTU-BAY", "UPT-X", "A".repeat(250), "C");
  assert.ok(left.length <= 180);
  assert.ok(right.length <= 180);
  assert.notEqual(left, right);
});

test("short natural-key punctuation and spacing variants remain distinct", () => {
  const compact = deterministicId("MTU-BAY", "UPT-X", "GI 70KV TEST", "IBT#2 150/70KV (LV)");
  const spaced = deterministicId("MTU-BAY", "UPT-X", "GI 70KV TEST", "IBT #2 150/70KV (LV)");
  assert.notEqual(compact, spaced);
  assert.ok(compact.length <= 180);
  assert.ok(spaced.length <= 180);
});

test("only GI and Bay master tables receive the active filter", () => {
  assert.deepEqual(mtuKhsMasterQuery("mtu_khs_gardu_induk"), { active: true });
  assert.deepEqual(mtuKhsMasterQuery("mtu_khs_gardu_induk_bay"), { active: true });
  assert.deepEqual(mtuKhsMasterQuery("mtu_khs_specs"), {});
});
