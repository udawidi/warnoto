import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20261020_tug5_asman_atomic_approval.sql", "utf8");
const rollback = fs.readFileSync("supabase/migrations/20261020_tug5_asman_atomic_approval.rollback.sql", "utf8");
const verifier = fs.readFileSync("supabase/verify_tug5_asman_atomic_approval.sql", "utf8");
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const approvals = fs.readFileSync("src/hooks/useTugApprovals.js", "utf8");
const sync = fs.readFileSync("src/lib/tugWorkflowSync.js", "utf8");

test("TUG-5 Asman approval is an atomic, scoped, idempotent parent-child RPC", () => {
  assert.match(migration, /create or replace function public\.approve_tug5_asman_with_child\(/i);
  assert.match(migration, /a\.role not in \('ASMAN', 'SUPERADMIN', 'ADMIN_LOG_PUSAT'\)/i);
  assert.match(migration, /a\.upt_id is distinct from parent_row\.upt_id/i);
  assert.match(migration, /parent_row\.stage <> 'PENDING_ASMAN' or parent_row\.status <> 'PENDING'/i);
  assert.match(migration, /parent_row\.ultg_id is not null/i);
  assert.match(migration, /parent_row\.uit_id is not null/i);
  assert.match(migration, /p_child_data - ARRAY\[/i);
  assert.match(migration, /'docType', 'uptId', 'uitId', 'ultgId'/i);
  assert.match(migration, /'uptPengirimId', 'tug5Id', 'tug5UptId'/i);
  assert.match(migration, /'docSubType', 'sourceType', 'stockItems'/i);
  assert.match(migration, /parent_row\.data->'stockItems'/i);
  assert.match(migration, /item->'permintaan'/i);
  assert.match(migration, /jsonb_set\(v_child_data, '\{docSubType\}', '"UIT_INTERCOMPANY"'/i);
  assert.match(migration, /then jsonb_build_object\('tug5Id', parent_row\.id\)/i);
  assert.match(migration, /set stage = 'APPROVED', status = 'APPROVED'/i);
  assert.match(migration, /insert into public\.tug_workflow_transactions/i);
  assert.match(migration, /'TUG_WORKFLOW_CHILD_ALREADY_EXISTS'/i);
  assert.match(migration, /'idempotent', true/i);
  assert.match(migration, /grant execute on function public\.approve_tug5_asman_with_child\(text, integer, text, jsonb\) to authenticated/i);
  assert.match(migration, /guard_tug5_asman_final_stage/i);
  assert.match(migration, /TUG_WORKFLOW_ASMAN_FINAL_ONLY/i);
  assert.match(verifier, /approve_tug5_asman_with_child\(text,integer,text,jsonb\)/i);
  assert.match(verifier, /tug5_asman_final_stage_guard/i);
  assert.match(rollback, /drop function if exists public\.approve_tug5_asman_with_child/i);
  assert.match(rollback, /drop trigger if exists tug5_asman_final_stage_guard/i);
  assert.match(schema, /create or replace function public\.approve_tug5_asman_with_child\(/i);
  assert.match(schema, /create or replace function public\.tug_workflow_scope_allowed\(/i);
  assert.match(schema, /create or replace function public\.tug_workflow_contains_data_url\(/i);
  assert.match(schema, /revoke all on function public\.tug_workflow_scope_allowed\(text, text, text\)/i);
  assert.match(schema, /grant execute on function public\.approve_tug5_asman_with_child\(text, integer, text, jsonb\) to authenticated/i);
});

test("the client calls the new RPC for Asman and keeps Manager legacy handling", () => {
  assert.match(sync, /approve_tug5_asman_with_child/);
  assert.match(approvals, /approveTug5AsmanWithChild\(\{ parent: txn, child \}\)/);
  const asman = approvals.slice(approvals.indexOf("async function approveTUG5_Asman"), approvals.indexOf("async function rejectTUG5_Asman"));
  assert.match(asman, /stage:\"APPROVED\"/);
  assert.doesNotMatch(asman, /stage:\"PENDING_MANAGER\"/);
  const manager = approvals.slice(approvals.indexOf("async function approveTUG5_Manager"), approvals.indexOf("async function rejectTUG5_Manager"));
  assert.match(manager, /transitionTugWorkflowWithChild\(\{ action: "TUG5_MANAGER_APPROVE"/);
});
