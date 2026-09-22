import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const hook = fs.readFileSync("src/hooks/useStockOpname.js", "utf8");
const tab = fs.readFileSync("src/components/StockOpnameTab.jsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260922_stock_opname_approval_fail_closed.sql", "utf8");
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const backfill = fs.readFileSync("supabase/backfill_stock_opname_sap_20260922_upt_sby.sql", "utf8");
const rollback = fs.readFileSync("supabase/migrations/20260922_stock_opname_approval_fail_closed.rollback.sql", "utf8");
const verifier = fs.readFileSync("supabase/verify_stock_opname_approval_fail_closed.sql", "utf8");

test("Qty Fisik manual hanya dapat ditulis Admin/TL/Superadmin", () => {
  assert.match(tab, /canEditDraft/);
  assert.match(tab, /hasRole\(currentUser,\s*"ADMIN",\s*"TL",\s*"SUPERADMIN"\)/);
  assert.match(hook, /Hanya Admin, TL, atau Superadmin yang bisa mengubah Qty Fisik/);
  assert.match(migration, /Stock opname draft insert by warehouse roles/);
  assert.match(migration, /Stock opname draft update by warehouse roles/);
  assert.match(migration, /Stock opname draft delete by warehouse roles/);
  assert.match(schema, /Stock opname draft update by warehouse roles/);
  assert.doesNotMatch(schema, /create policy "Scoped write stock_opname"/);
});

test("penolakan Asman menggunakan RPC role-gated", () => {
  assert.match(hook, /reject_stock_opname_asman/);
  assert.match(migration, /create or replace function public\.reject_stock_opname_asman/);
  assert.match(migration, /OPNAME_REJECTION_ROLE_DENIED/);
  assert.match(migration, /OPNAME_REJECTION_REASON_REQUIRED/);
});

test("hapus draft memakai delete satu baris dan tidak full-sync dokumen selesai", () => {
  assert.match(hook, /from\("stock_opname"\)\.delete\(\)\.eq\("id", id\)/);
  const deleteBlock = hook.slice(hook.indexOf("async function deleteOpname"), hook.indexOf("async function addNonStockFoundItem"));
  assert.doesNotMatch(deleteBlock, /saveToCloud/);
});

test("backfill dibatasi UPT-SBY dan 22 September 2026 WIB", () => {
  assert.match(backfill, /UPT-SBY/);
  assert.match(backfill, /2026-09-22 00:00:00\+07/);
  assert.match(backfill, /2026-09-23 00:00:00\+07/);
  assert.match(backfill, /row_number\(\) over[\s\S]*approved_at_ms desc/i);
  assert.match(backfill, /sapBaselineQty/);
  assert.match(backfill, /sapBaselineAt/);
});

test("backfill tidak mengubah dokumen atau qty WARNOTO", () => {
  assert.doesNotMatch(backfill, /update\s+public\.stock_opname/i);
  assert.doesNotMatch(backfill, /jsonb_set\([^;]*'\{qty\}'/is);
  assert.match(backfill, /OPNAME_DOCUMENT_CHANGED_DURING_BACKFILL/);
  assert.match(backfill, /md5\(o\.data::text\)/);
});

test("approval memakai snapshot server dan mempertahankan identitas stock", () => {
  assert.match(migration, /v_opname\.data - 'approvedByAsman' - 'approvedAtAsman' - 'freeze'/);
  assert.match(migration, /OPNAME_APPROVAL_ALREADY_FINAL/);
  assert.match(migration, /OPNAME_APPROVAL_SNAPSHOT_MISMATCH/);
  assert.match(migration, /v_final_data := jsonb_set\(v_opname\.data/);
  assert.match(migration, /v_safe_row := jsonb_set/);
  assert.match(migration, /'\{gudangId\}'/);
  assert.match(migration, /'\{uptId\}'/);
  assert.match(migration, /'\{qty\}'/);
  assert.match(migration, /is distinct from v_upt_id/);
  assert.match(migration, /is distinct from v_catalog_id/);
  assert.match(migration, /OPNAME_APPROVAL_SAP_DUPLICATE_CONFLICT/);
  assert.doesNotMatch(migration, /update public\.stocks set data = v_row/);
  assert.doesNotMatch(migration, /update public\.stock_opname set data = p_opname_data/);
});

test("approval SQL memakai parser desimal PostgreSQL yang benar", () => {
  assert.match(migration, /\\\.\[0-9\]\+/);
  assert.doesNotMatch(migration, /\\\\\.\[0-9\]\+/);
});

test("rollback memulihkan approval RPC dan tidak meninggalkan fungsi rusak", () => {
  assert.match(rollback, /create or replace function public\.approve_stock_opname_asman/);
  assert.match(rollback, /grant execute on function public\.approve_stock_opname_asman/);
  assert.doesNotMatch(rollback, /drop function if exists public\.approve_stock_opname_asman/);
  assert.match(rollback, /drop function if exists public\.reject_stock_opname_asman/);
  assert.match(rollback, /drop function if exists public\.update_stock_opname_tug_reference/);
});

test("verifier memeriksa snapshot, parser desimal, identitas stock, dan anon deny", () => {
  assert.match(verifier, /approval_rpc_server_snapshot/);
  assert.match(verifier, /approval_rpc_decimal_quantity_parser/);
  assert.match(verifier, /approval_rpc_identity_preservation/);
  assert.match(verifier, /rpc_anon_denied/);
  assert.match(verifier, /OPNAME_APPROVAL_SNAPSHOT_MISMATCH/);
  assert.match(verifier, /OPNAME_APPROVAL_SAP_DUPLICATE_CONFLICT/);
});
