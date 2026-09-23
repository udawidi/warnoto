import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260923_tug_workflow_persistence.sql");
const rollback = read("supabase/migrations/20260923_tug_workflow_persistence.rollback.sql");
const verifier = read("supabase/verify_tug_workflow_persistence.sql");
const sync = read("src/lib/tugWorkflowSync.js");
const schema = read("supabase/schema.sql");
const transactions = read("src/hooks/useTugTransactions.js");
const approvals = read("src/hooks/useTugApprovals.js");

test("workflow table is scoped and direct writes are closed", () => {
  assert.match(migration, /create table if not exists public\.tug_workflow_transactions/i);
  assert.match(migration, /constraint tug_workflow_scope_one check \(num_nonnulls\(upt_id, uit_id\) = 1\)/i);
  assert.match(migration, /alter table public\.tug_workflow_transactions enable row level security/i);
  assert.match(migration, /revoke all on public\.tug_workflow_transactions from anon, authenticated/i);
  assert.match(migration, /create policy "Scoped read tug workflow"/i);
  assert.doesNotMatch(migration, /create policy .* for (insert|update|delete|all)/i);
});

test("versioned RPCs and server-issued numbers are present", () => {
  assert.match(migration, /create or replace function public\.save_tug_workflow_transaction/i);
  assert.match(migration, /create or replace function public\.delete_tug_workflow_transaction/i);
  assert.match(migration, /create or replace function public\.transition_tug_workflow_transaction/i);
  assert.match(migration, /create or replace function public\.issue_tug_workflow_document_number/i);
  assert.match(migration, /TUG_WORKFLOW_VERSION_MISMATCH/i);
  assert.match(migration, /TUG_DOCUMENT_UNIT_CONFIG_REQUIRED/i);
  assert.match(migration, /update public\.tug_global_document_counters/i);
  assert.match(migration, /tug_doc_number\(v_seq, r\.doc_type/i);
  assert.match(migration, /TUG_WORKFLOW_NUMBER_ONLY_ON_ISSUE/i);
  assert.match(verifier, /issue_number_rpc/i);
});

test("atomic workflow transitions close parent-child orphan paths", () => {
  assert.match(migration, /create or replace function public\.transition_tug_workflow_with_child\(\s*p_action text,\s*p_parent_id text,\s*p_expected_version integer,\s*p_child_id text,\s*p_child_data jsonb/i);
  assert.match(migration, /for update;[\s\S]*TUG_WORKFLOW_VERSION_MISMATCH/i);
  assert.match(migration, /parent_workflow_id text references public\.tug_workflow_transactions\(id\) on delete restrict/i);
  assert.match(migration, /create unique index if not exists tug_workflow_parent_unique_idx[\s\S]*where parent_workflow_id is not null/i);
  assert.match(migration, /TUG5_MANAGER_APPROVE/i);
  assert.match(migration, /TUG5_ULTG_ADOPT/i);
  assert.match(migration, /TUG7_MGR_LOG_APPROVE/i);
  assert.match(migration, /TUG_WORKFLOW_ULTG_PARENT_UPT_INVALID/i);
  assert.match(migration, /a\.upt_id is distinct from parent_row\.upt_id/i);
  assert.match(migration, /actor\.role = 'MANAGER' and actor\.upt_id = p_upt_id/i);
  assert.match(migration, /p_uit_id is not null and actor\.uit_id = p_uit_id and actor\.role in \('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT'\)/i);
  assert.match(migration, /select u\.uit_id into v_child_uit[\s\S]*from public\.upt u[\s\S]*where u\.id = parent_row\.upt_id/i);
  assert.doesNotMatch(migration, /parent_row\.data->>'uitId'/i);
  assert.match(migration, /v_reference_key/);
  assert.match(migration, /v_actor_key/);
  assert.match(migration, /v_timestamp_key/);
  assert.match(migration, /'idempotent', true/);
  assert.match(migration, /select \* into child_row[\s\S]*parent_workflow_id = parent_row\.id/i);
  assert.match(migration, /TUG_WORKFLOW_CHILD_ALREADY_EXISTS/i);
  assert.match(migration, /TUG_WORKFLOW_VERSION_MISMATCH/i);
  const authBeforeRetry = migration.indexOf("-- Authorize and validate the action scope before any retry response");
  const retryMarker = migration.indexOf("-- Safe retry: the first transaction committed both rows");
  assert.ok(authBeforeRetry >= 0 && authBeforeRetry < retryMarker, "atomic retry must authorize before returning snapshots");
  const childPayloadStart = migration.indexOf("v_child_data := p_child_data || jsonb_build_object(");
  const childPayloadEnd = migration.indexOf(");", childPayloadStart);
  assert.ok(childPayloadStart >= 0 && childPayloadEnd > childPayloadStart);
  assert.doesNotMatch(migration.slice(childPayloadStart, childPayloadEnd), /v_reference_key/);
  assert.match(migration, /'parent', to_jsonb\(parent_row\), 'child', to_jsonb\(child_row\)/i);
  assert.match(rollback, /transition_tug_workflow_with_child/i);
  assert.match(verifier, /atomic_transition_rpc/i);
  assert.match(verifier, /parent_unique_partial/i);
});

test("canonical draft constraints, legacy import, and no binary data URLs", () => {
  assert.match(migration, /doc_type not in \('TUG8','TUG9'\) or status = 'DRAFT'/i);
  assert.match(migration, /legacyImport/i);
  assert.match(migration, /TUG_WORKFLOW_DATA_URL_FORBIDDEN/i);
  assert.match(sync, /processTxnPhotos/);
  assert.match(sync, /TUG_WORKFLOW_PHOTO_NOT_STORED/);
  assert.match(sync, /migrateLegacyWorkflowDrafts/);
});

test("server wins and conflict is explicit in client sync", () => {
  assert.match(sync, /mergeWorkflowServerWins/);
  assert.match(sync, /serverIds/);
  assert.match(sync, /isTugWorkflowConflict/);
  assert.match(sync, /TUG_WORKFLOW_VERSION_MISMATCH/);
  assert.match(sync, /issueTugWorkflowDocumentNumber/);
});

test("schema mirror and rollback are shipped", () => {
  assert.match(schema, /tug_workflow_transactions/);
  assert.match(schema, /Scoped read tug workflow/);
  assert.match(rollback, /drop table if exists public\.tug_workflow_transactions/i);
  assert.match(rollback, /issue_tug_workflow_document_number/i);
  assert.match(schema, /parent_workflow_id text references public\.tug_workflow_transactions\(id\) on delete restrict/i);
  assert.match(schema, /tug_workflow_parent_unique_idx/i);
});

test("client and approval handlers use one atomic parent-child RPC", () => {
  assert.match(sync, /transitionTugWorkflowWithChild/);
  assert.match(sync, /transition_tug_workflow_with_child/);
  assert.match(approvals, /transitionTugWorkflowWithChild\(\{ action: "TUG5_MANAGER_APPROVE"/);
  assert.match(approvals, /transitionTugWorkflowWithChild\(\{ action: "TUG5_ULTG_ADOPT"/);
  assert.match(approvals, /transitionTugWorkflowWithChild\(\{ action: "TUG7_MGR_LOG_APPROVE"/);
});

test("saving a canonical TUG-8/9 edit keeps approval stage", () => {
  assert.match(transactions, /Existing canonical PENDING_TL\/PENDING_ASMAN rows are edited in-place/);
  assert.match(transactions, /editingTxnRef\.current\?\.canonical/);
  assert.match(transactions, /stage: editingTxnRef\.current\.stage/);
  assert.match(transactions, /status: editingTxnRef\.current\.status/);
  assert.match(transactions, /amendCanonicalTug/);
});

test("TUG-3 pending edit is not demoted by Save Draft", () => {
  assert.match(transactions, /docType === "TUG3" && targetStage === "DRAFT"/);
  assert.match(transactions, /editingTxnRef\.current\?\.stage === "PENDING_TL"/);
  assert.match(transactions, /targetStage = "PENDING_TL"/);
});

test("workflow scope maps TUG-7 and UIT TUG-5 children to UIT only", () => {
  assert.match(sync, /docType === "TUG7"/);
  assert.match(sync, /txn\.stage === "DRAFT_UIT"/);
  assert.match(sync, /p_upt_id: uitScoped \? null/);
  assert.match(sync, /p_uit_id: uitScoped \? \(txn\.uitId/);
});
