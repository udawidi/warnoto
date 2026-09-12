import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../supabase/migrations/20260911_mtu_khs.sql", import.meta.url), "utf8");
const seedSql = readFileSync(new URL("../../supabase/migrations/20260912_mtu_gi_master_seed.sql", import.meta.url), "utf8");
const seedStart = seedSql.indexOf("[", seedSql.indexOf("$mtu_data$"));
const seedEnd = seedSql.lastIndexOf("]$mtu_data$") + 1;
const seedRows = JSON.parse(seedSql.slice(seedStart, seedEnd));

test("MTU migration keeps canonical tables SELECT-only for authenticated clients", () => {
  assert.match(sql, /grant select on public\.mtu_khs_gardu_induk/);
  assert.match(sql, /revoke insert, update, delete on public\.mtu_khs_gardu_induk/);
  assert.match(sql, /create policy "MTU KHS records no direct update"/);
  assert.match(sql, /create policy "MTU KHS records no direct delete"/);
});

test("MTU migration has scoped role helper and approval routing", () => {
  assert.match(sql, /create or replace function public\.mtu_khs_can_access_upt/);
  assert.match(sql, /p\.role in \('SUPERADMIN', 'ADMIN_LOG_PUSAT', 'PENGADAAN'\)/);
  assert.match(sql, /target_role := 'ASMAN_LOG_UIT'/);
  assert.match(sql, /target_role := 'ASMAN'/);
  assert.match(sql, /for update/);
  assert.match(sql, /MTU_VERSION_CONFLICT/);
});

test("MTU migration makes import retry idempotent and validates mappings", () => {
  assert.match(sql, /create or replace function public\.mtu_khs_stage_import/);
  assert.match(sql, /create or replace function public\.mtu_khs_commit_import/);
  assert.match(sql, /MTU_IMPORT_ALREADY_COMMITTED/);
  assert.match(sql, /MTU_MAPPING_REQUIRED/);
  assert.match(sql, /file_sha256/);
  assert.match(sql, /raw_row_sha256/);
  assert.match(sql, /create or replace function public\.mtu_khs_update_import_row_mapping/);
  assert.match(sql, /MTU_MAPPING_REQUIRED:SITE/);
  assert.match(sql, /MTU_HIERARCHY_INVALID:GUDANG/);
  assert.match(sql, /MTU_MAPPING_REQUIRED:SUPPLIER/);
  assert.match(sql, /MTU_MAPPING_REQUIRED:SPEC/);
  assert.match(sql, /p_mapping jsonb/);
  assert.match(sql, /mtu_spec_id, katalog_id, supplier_id/);
  assert.match(sql, /MTU_QTY_INVALID/);
});

test("MTU migration contains hierarchy and master deactivation guards", () => {
  assert.match(sql, /references public\.gudang\(id\)/);
  assert.match(sql, /public\.mtu_khs_deactivate_site_master/);
  assert.match(sql, /MTU_MASTER_IN_USE/);
  assert.match(sql, /public\.mtu_khs_upsert_gardu_induk/);
  assert.match(sql, /public\.mtu_khs_upsert_bay/);
  assert.match(sql, /upt_id text references public\.upt\(id\)/);
  assert.match(sql, /normalized_name text/);
  assert.match(sql, /uq_mtu_khs_gi_upt_name/);
  assert.match(sql, /uq_mtu_khs_bay_gi_name/);
  assert.match(sql, /public\.mtu_khs_can_access_upt\(upt_id\)/);
});

test("MTU approval supports superadmin override and explicit clear semantics", () => {
  assert.match(sql, /p\.role <> 'SUPERADMIN' and c\.approver_role = 'ASMAN'/);
  assert.match(sql, /case when c\.patch \? 'garduIndukId' then nullif/);
  assert.match(sql, /case when c\.patch \? 'bayId' then nullif/);
});

test("MTU master seed is deterministic and matches approved scope", () => {
  assert.equal(seedRows.length, 82);
  assert.equal(seedRows.reduce((total, row) => total + row.bays.length, 0), 195);
  assert.equal(new Set(seedRows.map(row => row.id)).size, 82);
  assert.equal(new Set(seedRows.flatMap(row => row.bays.map(bay => bay.id))).size, 195);
  assert.deepEqual(new Set(seedRows.map(row => row.uptId)), new Set(["UPT-BLI", "UPT-GRS", "UPT-MDN", "UPT-MLG", "UPT-PBG", "UPT-SBY"]));
  assert.equal(new Set(seedRows.map(row => `${row.uptId}|${row.name}`)).size, 82);
  assert.equal(seedRows.find(row => row.name === "GI 150KV KASIHJATIM")?.ultgName, "KRIAN");
  assert.match(seedSql, /20260912-lapor-upt-disesuaikan-v1/);
  assert.match(seedSql, /on conflict \(seed_key\) do update/);
  assert.match(seedSql, /fafd42356153abc962e0b3130529478789da29ff12ea23f5bbd8c6faaf977127/);
  assert.match(seedSql, /MTU_KHS_MASTER_SEED/);
  assert.match(seedSql, /alter table public\.mtu_khs_master_seed_runs enable row level security/);
  assert.match(seedSql, /revoke all on table public\.mtu_khs_master_seed_runs from anon, authenticated/);
  assert.match(seedSql, /grant select, insert, update on table public\.mtu_khs_master_seed_runs to service_role/);
});
