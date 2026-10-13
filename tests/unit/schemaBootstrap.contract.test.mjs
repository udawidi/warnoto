import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const repairMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261012c_mara_orphan_1004160255.sql"),
  "utf8",
);

const criticalFunctions = [
  "tug_actor",
  "tug_assert_upt_scope",
  "tug_hash",
  "tug_doc_code",
  "tug_doc_number",
  "tug_initial_stage",
  "tug_required_role",
  "tug_next_stage",
  "tug_stock_direction",
  "tug_assert_items",
  "tug_assert_canonical_item_refs",
  "tug_stock_snapshot",
  "tug_request_hash",
  "tug_idempotency_response",
  "tug_assert_outgoing_stock_scope",
  "tug_mara_resolve",
  "katalog_fill_satuan_from_mara",
  "approve_tug3_final",
  "mtu_khs_apply_tug3_receipt",
  "approve_tug10_final",
];

const executableSchema = schema
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");

function countDefinitions(source, name) {
  return source.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "gi"))?.length ?? 0;
}

test("schema is an empty-database bootstrap snapshot", () => {
  assert.match(schema, /^-- WARNOTO .*Bootstrap snapshot/m);
  assert.match(schema, /final state\. Bukan runner upgrade\/repair produksi\./);
  assert.doesNotMatch(schema, /20261012c_mara_orphan_1004160255/);
  assert.doesNotMatch(schema, /MARA_ORPHAN_REPAIR_/);
  assert.doesNotMatch(schema, /KAT-1004160255|STK-SAP-3615-1004160255/);
  assert.doesNotMatch(schema, /MAH-UPT-SBY-202[4-6]-S[12]/);
  assert.match(schema, /20261012b_mara_catalog_resolver_index/);
  assert.doesNotMatch(schema, /create index concurrently/i);
  assert.match(repairMigration, /MARA_ORPHAN_REPAIR_CANDIDATE_INVALID/);
});

test("critical final functions have one definition and expected grants", () => {
  for (const name of criticalFunctions) {
    assert.equal(countDefinitions(executableSchema, name), 1, `${name} must have one snapshot definition`);
  }
  assert.equal(
    (executableSchema.match(/grant execute on function public\.approve_tug10_final\(text, uuid\)/gi) ?? []).length,
    1,
  );
  assert.match(schema, /grant execute on function public\.approve_tug3_final\(text, uuid\) to authenticated;/i);
  assert.match(schema, /grant execute on function public\.mtu_khs_apply_tug3_receipt\(text,text\) to authenticated;/i);
});

test("canonical app dependency DDL is present once and topological", () => {
  assert.equal((schema.match(/CANONICAL TUG-3 \+ MTU KHS FINAL STATE/g) ?? []).length, 1);
  for (const table of [
    "tug_global_document_counters", "tug_transactions", "tug_items", "tug_approvals", "tug_review_tokens", "stock_movements", "tug3_transactions",
    "supplier", "mtu_khs_gardu_induk", "mtu_khs_gardu_induk_bay", "mtu_khs_specs", "mtu_khs_records", "mtu_khs_units", "mtu_khs_documents",
    "mtu_khs_record_documents", "mtu_khs_usage_links", "mtu_khs_change_requests", "mtu_khs_sheet_sync_jobs", "mtu_khs_import_batches",
    "mtu_khs_import_rows", "mtu_khs_reconciliations", "mtu_khs_stock_links", "mtu_khs_receipts", "mtu_khs_record_events", "mtu_khs_record_evidence", "mtu_khs_transfer_requests",
  ]) assert.match(executableSchema, new RegExp(`create table if not exists public\\.${table}\\b`, "i"), table);
  for (const column of [
    "source_snapshot", "mtu_record_id", "lokasi_id", "search_text", "before_sheet", "target_record_id", "document_unit_code",
  ]) assert.match(executableSchema, new RegExp(`\\b${column}\\b`, "i"), column);
  assert.match(schema, /alter table public\.mtu_khs_records enable row level security;/i);
  assert.match(schema, /create policy "MTU KHS records scoped"/i);
  assert.match(schema, /grant select on public\.tug_global_document_counters/i);
  assert.match(schema, /create trigger trg_mtu_khs_refresh_search_text/i);
  assert.ok(schema.indexOf("CANONICAL TUG-3 + MTU KHS FINAL STATE") < schema.indexOf("20261012_tug_mara_post_guard.sql"));
});
