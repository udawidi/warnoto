import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { activePairedGudangRows, dropCachedGiRows } from "../../src/lib/giWarehouse.js";

const migration = await readFile(new URL("../../supabase/migrations/20260918_gi_tug_warehouse.sql", import.meta.url), "utf8");
const app = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");
const masterSync = await readFile(new URL("../../src/lib/masterSync.js", import.meta.url), "utf8");
const forms = await readFile(new URL("../../src/components/TugFormModals.jsx", import.meta.url), "utf8");
const warehouseHook = await readFile(new URL("../../src/hooks/useWarehouseConfig.jsx", import.meta.url), "utf8");
const giWarehouse = await readFile(new URL("../../src/lib/giWarehouse.js", import.meta.url), "utf8");

test("GI shadow migration creates real FK locations and rejects ID collisions", () => {
  assert.match(migration, /'GI-' \|\| new\.id/);
  assert.match(migration, /'GILOK-' \|\| new\.id/);
  assert.match(migration, /GI_SHADOW_ID_CONFLICT:gudang/);
  assert.match(migration, /GI_SHADOW_ID_CONFLICT:lokasi/);
  assert.match(migration, /data->>'giId' is distinct from gi\.id/);
  assert.match(migration, /data->>'giId' is distinct from new\.id/);
  assert.match(migration, /trg_mtu_khs_sync_gi_shadow/);
});

test("GI lifecycle is fail-safe for used sites and immutable UPT history", () => {
  assert.match(migration, /mtu_khs_records where gardu_induk_id = p_gi_id/);
  assert.match(migration, /stocks s[\s\S]*?GILOK-/);
  assert.match(migration, /tug3_transactions t[\s\S]*?PENDING_ASMAN/);
  assert.match(migration, /tug10_transactions t[\s\S]*?PENDING_ASMAN/);
  assert.match(migration, /MTU_GI_UPT_IMMUTABLE/);
  assert.match(migration, /MTU_MASTER_IN_USE/);
  assert.match(migration, /revoke all on function public\.mtu_khs_gi_has_history\(text\) from public, authenticated/);
});

test("frontend reads active DB shadow rows and drops old virtual cache rows", () => {
  assert.match(giWarehouse, /export function dropCachedGiRows\(list\)/);
  assert.match(giWarehouse, /export function activeGiRows\(list\)/);
  assert.match(giWarehouse, /export function activePairedGudangRows\(gudangList, lokasiList\)/);
  assert.match(app, /gudangList: gudangList\.filter\(g => !g\?\.__gi\)/);
  assert.match(app, /const visibleTugGudangList = useMemo/);
  assert.match(app, /Tug98FormModal[\s\S]*?visibleGudangList=\{visibleTugGudangList\}/);
  assert.match(app, /Tug10FormModal[\s\S]*?visibleGudangList=\{visibleTugGudangList\}/);
  assert.match(app, /Tug3FormModal[\s\S]*?visibleGudangList=\{visibleTugGudangList\}/);
  assert.doesNotMatch(app, /pseudoGiGudang|pseudoGiLokasi|loadMtuKhsMaster/);
  assert.match(masterSync, /table === "gudang" \|\| table === "lokasi"/);
  assert.match(masterSync, /r\.data\?\.__gi === true/);
});

test("GI transaction choices fail closed on missing, inactive, or mismatched pairs", () => {
  const physical = { id: "GUD-1", nama: "Fisik" };
  const valid = { id: "GI-1", __gi: true, giId: "1", giActive: true, uptId: "UPT-1" };
  const validLocation = { id: "GILOK-1", __gi: true, giId: "1", giActive: true, gudangId: "GI-1", uptId: "UPT-1" };

  assert.deepEqual(
    activePairedGudangRows([physical, valid], [validLocation]),
    [physical, valid],
  );
  assert.deepEqual(
    activePairedGudangRows([physical, valid], []),
    [physical],
  );
  assert.deepEqual(
    activePairedGudangRows([physical, { ...valid, giActive: false }], [validLocation]),
    [physical],
  );
  assert.deepEqual(
    activePairedGudangRows([physical, valid], [{ ...validLocation, uptId: "UPT-2" }]),
    [physical],
  );
  assert.deepEqual(
    activePairedGudangRows([physical, { ...valid, id: "GI-other" }], [validLocation]),
    [physical],
  );
  assert.deepEqual(
    activePairedGudangRows([physical, { ...valid, uptId: null }], [validLocation]),
    [physical],
  );
});

test("GI fixture cache rows are fail-closed outside Vite e2e mode", () => {
  const fixture = { id: "GI-FIXTURE", __gi: true, __giFixture: true };
  assert.deepEqual(dropCachedGiRows([fixture]), []);
});

test("TUG forms use GI's real location and leave satpam empty", () => {
  assert.match(forms, /const isGI = !!selGud\?\.__gi/);
  assert.match(forms, /lokasiTujuanId:\s*giLokasi\.id/);
  assert.match(forms, /isLegacyGud\|\|isGI/);
  assert.match(app, /lokasiId:txn\.lokasiTujuanId, uptId:txn\.uptId \|\| currentUserUptId \|\| null/);
});

test("warehouse configuration cannot edit GI shadow rows", () => {
  assert.match(warehouseHook, /isGiShadow = row => row\?\.__gi === true/);
  assert.match(warehouseHook, /if \(isGiShadow\(lokasiForm\)/);
  assert.match(warehouseHook, /if \(isGiShadow\(gudangForm\)/);
  assert.match(warehouseHook, /ng\.filter\(g => !isGiShadow\(g\)\)/);
});
