import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  getInspectionIdentity,
  getInspectionScope,
  getVisibleGudangForInspection,
} from "../../src/lib/inspectionScope.mjs";

const migrationSource = await readFile(
  new URL("../../supabase/migrations/20260802_material_inspection_multi_upt_security.sql", import.meta.url),
  "utf8",
);
const followupMigrationSource = await readFile(
  new URL("../../supabase/migrations/20260913b_material_inspection_unlocated_executor.sql", import.meta.url),
  "utf8",
);
const clientSource = await readFile(new URL("../../src/supabaseClient.js", import.meta.url), "utf8");

const uptList = [
  { id: "UPT-SBY", nama: "UPT Surabaya", uitId: "UIT-JBM" },
  { id: "UPT-MLG", nama: "UPT Malang", uitId: "UIT-JBM" },
  { id: "UPT-BLI", nama: "UPT Bali", uitId: "UIT-DJT" },
];
const gudangList = [
  { id: "GDG-SBY-A", uptId: "UPT-SBY" },
  { id: "GDG-SBY-B", uptId: "UPT-SBY" },
  { id: "GDG-MLG", uptId: "UPT-MLG" },
  { id: "GDG-BLI", uptId: "UPT-BLI" },
];
const lokasiList = [
  { id: "LOK-SBY", gudangId: "GDG-SBY-A" },
  { id: "LOK-MLG", gudangId: "GDG-MLG" },
  { id: "LOK-BLI", gudangId: "GDG-BLI" },
];

test("UPT actor cannot see stocks, gudang, or BA from another UPT", () => {
  const scope = getInspectionScope({
    currentUser: { role: "ADMIN", uptId: "UPT-SBY", gudangIds: ["GDG-SBY-A"] },
    currentUserUptId: "UPT-SBY",
    uptList,
    gudangList,
    lokasiList,
    stocks: [
      { id: "STK-SBY", lokasiId: "LOK-SBY" },
      { id: "STK-MLG", lokasiId: "LOK-MLG" },
      { id: "STK-BLI", lokasiId: "LOK-BLI" },
    ],
    materialInspectionBatches: [
      { id: "BA-SBY", uptId: "UPT-SBY", gudangId: "GDG-SBY-A" },
      { id: "BA-MLG", uptId: "UPT-MLG", gudangId: "GDG-MLG" },
    ],
  });

  assert.deepEqual(scope.gudangList.map(item => item.id), ["GDG-SBY-A"]);
  assert.deepEqual(scope.stocks.map(item => item.id), ["STK-SBY"]);
  assert.deepEqual(scope.materialInspectionBatches.map(item => item.id), ["BA-SBY"]);
});

test("SUPERADMIN stays global while UIT and ULTG scopes retain their hierarchy", () => {
  assert.deepEqual(
    getVisibleGudangForInspection({ currentUser: { role: "SUPERADMIN" }, currentUserUptId: "UPT-SBY", gudangList, uptList }).map(item => item.id),
    gudangList.map(item => item.id),
  );
  assert.deepEqual(
    getVisibleGudangForInspection({ currentUser: { role: "ADMIN_UIT", uitId: "UIT-JBM" }, currentUserUptId: "UPT-SBY", gudangList, uptList }).map(item => item.id),
    ["GDG-SBY-A", "GDG-SBY-B", "GDG-MLG"],
  );
  assert.deepEqual(
    getVisibleGudangForInspection({ currentUser: { role: "MGR_ULTG", ultgId: "ULTG-SBY" }, currentUserUptId: "UPT-SBY", gudangList, uptList }).map(item => item.id),
    ["GDG-SBY-A", "GDG-SBY-B"],
  );
});

test("UIT inspection history follows every authorized UPT-gudang pair", () => {
  const scope = getInspectionScope({
    currentUser: { role: "ADMIN_UIT", uitId: "UIT-JBM" },
    currentUserUptId: "UPT-SBY",
    uptList,
    gudangList,
    lokasiList,
    materialInspectionBatches: [
      { id: "BA-SBY", uptId: "UPT-SBY", gudangId: "GDG-SBY-A" },
      { id: "BA-MLG", uptId: "UPT-MLG", gudangId: "GDG-MLG" },
      { id: "BA-FORGED", uptId: "UPT-BLI", gudangId: "GDG-MLG" },
      { id: "BA-BLI", uptId: "UPT-BLI", gudangId: "GDG-BLI" },
    ],
  });

  assert.deepEqual(scope.materialInspectionBatches.map(item => item.id), ["BA-SBY", "BA-MLG"]);
});

test("inspection identity is derived from UPT and manager profile, never hardcoded", () => {
  assert.deepEqual(
    getInspectionIdentity({
      currentUser: { role: "ADMIN", upt: "Surabaya" },
      currentUserUptId: "UPT-MLG",
      uptList,
      users: [{ role: "MANAGER", uptId: "UPT-MLG", name: "Manager Malang" }],
    }),
    { uptId: "UPT-MLG", namaUpt: "UPT Malang", managerUpt: "Manager Malang" },
  );
});

test("migration rejects forged cross-UPT header, gudang, and stock paths; RLS scopes BA/items/photos", () => {
  assert.match(migrationSource, /v_upt <> v_actor_upt/);
  assert.match(migrationSource, /g\.id = v_gudang and g\.upt_id = v_actor_upt/);
  assert.match(migrationSource, /v_actor_gudang_ids \? v_gudang/);
  assert.match(migrationSource, /join public\.stocks s[\s\S]*?left join public\.lokasi l[\s\S]*?left join public\.gudang g/);
  assert.match(migrationSource, /g\.id <> v_gudang or g\.upt_id <> v_actor_upt/);
  assert.match(migrationSource, /can_access_material_inspection_scope\(upt_id, gudang_id\)/);
  assert.match(migrationSource, /material_inspection_batches b[\s\S]*?can_access_material_inspection_scope\(b\.upt_id, b\.gudang_id\)/);
  assert.match(migrationSource, /coalesce\(mi\.data->'photoPaths', '\[\]'::jsonb\) \? name/);
});

test("non-E2E client guard also rejects a non-canonical production Supabase host", () => {
  assert.match(clientSource, /if \(!E2E_MODE && SUPABASE_URL\)/);
  assert.doesNotMatch(clientSource, /if \(import\.meta\.env\.DEV && !E2E_MODE && SUPABASE_URL\)/);
});

test("follow-up RPC permits unlocated stock only within actor UPT and snapshots logistik server-side", () => {
  assert.match(followupMigrationSource, /create or replace function public\.create_material_inspection_batch\(p_items jsonb, p_header jsonb\)/);
  assert.match(followupMigrationSource, /s\.lokasi_id is null[\s\S]*?s\.upt_id is distinct from v_actor_upt/);
  assert.match(followupMigrationSource, /s\.lokasi_id is not null[\s\S]*?g\.id <> v_gudang or g\.upt_id <> v_actor_upt/);
  assert.match(followupMigrationSource, /v_logistik_requested/);
  assert.match(followupMigrationSource, /role in \('ADMIN', 'TL'\)[\s\S]*?upt_id = v_actor_upt/);
  assert.match(followupMigrationSource, /jsonb_build_object\([\s\S]*?'pelaksanaLogistikId', v_logistik_id[\s\S]*?'pelaksanaLogistik', v_logistik_name/);
  assert.match(followupMigrationSource, /insert into public\.material_inspection_batches[\s\S]*?v_header_data/);
  assert.match(followupMigrationSource, /v_count < 1 or v_count > 10/);
  assert.match(followupMigrationSource, /count\(distinct e\.value->>'stock_id'\)/);
  assert.match(followupMigrationSource, /not exists \(select 1 from public\.stocks s/);
  assert.match(followupMigrationSource, /returns jsonb[\s\S]*?security definer set search_path = public/);
  assert.match(followupMigrationSource, /revoke all on function public\.create_material_inspection_batch\(jsonb, jsonb\) from public/);
  assert.match(followupMigrationSource, /grant execute on function public\.create_material_inspection_batch\(jsonb, jsonb\) to authenticated/);
  assert.doesNotMatch(followupMigrationSource, /drop table|delete from public\.stocks|update public\.stocks/);
});
