import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read("supabase/migrations/20261012_tug_mara_post_guard.sql");
const schema = read("supabase/schema.sql");
const verifier = read("supabase/verify_tug_mara_post_guard.sql");
const previousMigration = read("supabase/migrations/20261001_tug10_target_stock.sql");

test("migration is ordered after the last TUG-10 target-stock migration", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(migrations.indexOf("20261012_tug_mara_post_guard.sql") > migrations.indexOf("20261001_tug10_target_stock.sql"));
  assert.match(previousMigration, /approve_tug10_final\s*\(/i);
  assert.match(migration, /begin;[\s\S]*commit;/i);
});

test("MARA resolver is fail-closed and ignores only leading zeroes", () => {
  assert.match(migration, /ltrim\(btrim\(coalesce\(p_code, ''\)\), '0'\)/i);
  assert.match(migration, /MARA_CATALOG_REQUIRED/);
  assert.match(migration, /MARA_CATALOG_NOT_FOUND/);
  assert.match(migration, /MARA_CATALOG_AMBIGUOUS/);
  assert.match(migration, /MARA_CATALOG_INVALID/);
  assert.match(migration, /count\(\*\)[\s\S]*v_count <> 1/i);
  assert.match(migration, /'kode_material'[\s\S]*'nama'[\s\S]*'satuan'/i);
});

test("TUG-3 normal approval is atomic, idempotent, and RPC-only", () => {
  assert.match(migration, /create or replace function public\.approve_tug3_final/i);
  assert.match(migration, /p_tug3_id text,\s*p_idempotency_key uuid/i);
  assert.match(migration, /set_config\('app\.tug3_final_rpc', 'on', true\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /TUG3_FINAL_APPROVE/);
  assert.match(migration, /tug_idempotency_keys[\s\S]*insert into/i);
  assert.match(migration, /trg_tug3_guard_legacy_stock_write/);
  assert.match(migration, /TUG3_STOCK_RPC_REQUIRED/);
  assert.match(migration, /trg_tug3_guard_legacy_status_write/);
  assert.match(migration, /TUG3_APPROVAL_RPC_REQUIRED/);
  assert.match(migration, /coalesce\(current_setting\('app\.tug3_final_rpc', true\), ''\)/i);
  assert.match(migration, /create or replace function public\.tug3_source_part/i);
  assert.match(migration, /array_to_string\(array\[[\s\S]*public\.tug3_source_part\(v_txn\.upt_id\)[\s\S]*public\.tug3_source_part\(v_location_id\)[\s\S]*public\.tug3_source_part\(v_catalog_id\)[\s\S]*public\.tug3_source_part\(v_supplier\)[\s\S]*public\.tug3_source_part\(v_identity\)/i);
  assert.match(migration, /public\.tug3_source_part\(v_txn\.id\)[\s\S]*public\.tug3_source_part\(v_idx::text\)/i);
  assert.match(migration, /'kontrakRefs', jsonb_build_array\(jsonb_build_object\(/i);
  assert.match(migration, /'noKontrak', v_contract_no/);
  assert.match(migration, /'suratPesananNo', v_document_no/);
  assert.match(migration, /v_identity := case[\s\S]*v_contract_no <> ''[\s\S]*v_document_no <> ''/i);
  assert.match(migration, /'approvedByAsman',v_actor\.id,'approvedAtAsman',v_now/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('TUG3:MARA:' \|\| v_mara_key/i);
  assert.match(migration, /approvedByAsman',a\.id,'approvedAtAsman'/i);
});

test("MTU and TUG-10 paths pass through the same MARA write boundary", () => {
  assert.match(migration, /create or replace function public\.mtu_khs_apply_tug3_receipt/i);
  assert.match(migration, /p_tug3_transaction_id text,\s*p_idempotency_key text/i);
  assert.match(migration, /set_config\('app\.mtu_khs_receipt_rpc',\s*'on',\s*true\)/i);
  assert.match(migration, /approve_tug10_final\(text,\s*uuid\)/i);
  assert.match(migration, /app\.tug10_final_rpc/);
  assert.match(migration, /trg_tug_mara_catalog_write_guard/);
  assert.match(migration, /trg_tug_mara_stock_write_guard/);
  assert.match(migration, /public\.tug_mara_resolve\(code,\s*'MTU'\)/i);
  assert.match(migration, /public\.tug_mara_resolve\(v_code, v_prefix\)/i);
  assert.match(migration, /create or replace function public\.katalog_fill_satuan_from_mara/i);
  assert.match(migration, /'katalog', btrim\(v_mara\.kode_material\)/i);
  assert.match(migration, /v_count > 1 and v_tug_context/i);
  assert.match(migration, /v_mara_data := public\.tug_mara_resolve\(v_katalog_data->>'katalog', 'TUG10'\)/i);
  assert.match(migration, /select data into v_katalog_data from public\.katalog where id = v_katalog_id for update/i);
  assert.match(migration, /v_katalogs := v_katalogs \|\| jsonb_build_array\(v_katalog_data/i);
  assert.match(migration, /TUG10_NEW_CATALOG_INVALID[\s\S]*tug_mara_resolve\(v_code, 'TUG10'\)/i);
  assert.doesNotMatch(migration, /v_katalog_data := jsonb_build_object\([\s\S]*'name', v_item->>'namaBaru'/i);
  assert.doesNotMatch(migration, /'description', coalesce\(v_katalog_data->>'name', v_item->>'namaBaru'/i);
});

test("schema mirrors the guard contract and verifier is read-only", () => {
  for (const source of [schema, migration]) {
    assert.match(source, /tug_mara_resolve/);
    assert.match(source, /ltrim\(btrim/);
    assert.match(source, /TUG3_FINAL_APPROVE/);
    assert.match(source, /trg_tug3_guard_legacy_status_write/);
    assert.match(source, /tug3_source_part/);
    assert.match(source, /MARA_CATALOG_INVALID/);
  }
  assert.match(verifier, /tug_mara_resolve\(text,text\)/i);
  assert.match(verifier, /approve_tug3_final\(text,uuid\)/i);
  assert.match(verifier, /having count\(m\.kode_material\) <> 1/i);
  assert.doesNotMatch(verifier, /\b(insert|update|delete|alter|drop|create)\b/i);
});
