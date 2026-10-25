import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const maturitySamplingMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261025_maturity_sampling_evidence.sql"), "utf8");
const docker = process.env.SCHEMA_BOOTSTRAP_DOCKER || "docker";
const image = process.env.SCHEMA_BOOTSTRAP_IMAGE || "pgvector/pgvector:pg16";
const dockerHost = process.env.SCHEMA_BOOTSTRAP_DOCKER_HOST || "";
const container = `warnoto-schema-bootstrap-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const password = crypto.randomBytes(16).toString("hex");

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const detail = `${stderr}\n${stdout}`;
        const marker = detail.lastIndexOf("ERROR:");
        const concise = (marker >= 0 ? detail.slice(marker) : detail).slice(0, 3000);
        reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${concise}`));
      }
    });
    child.stdin.end(input ?? "");
  });
}

function runDocker(args, input) {
  return dockerHost ? run("ssh", [dockerHost, docker, ...args], input) : run(docker, args, input);
}

async function psql(sql) {
  return (await runDocker([
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "--echo-errors", "-q", "-t", "-A",
    "-U", "postgres", "-d", "postgres",
  ], sql)).stdout;
}

async function scalar(sql) {
  const lines = (await psql(sql)).trim().split(/\r?\n/).filter(Boolean);
  return lines.at(-1) || "";
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await runDocker(["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"]);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error("Scratch PostgreSQL did not become ready");
}

// Supabase Auth/Storage are external services in production. These are the
// smallest real table/function contracts required by this snapshot; no SQL
// extension is faked. The pgvector image is required because schema.sql owns
// the real vector extension and HNSW operator class.
const prerequisites = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;
create schema if not exists auth;
create schema if not exists storage;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text
language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner_id text,
  owner text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create or replace function storage.foldername(p_name text)
returns text[] language sql immutable as $$ select string_to_array(coalesce(p_name, ''), '/') $$;
`;

async function main() {
  let started = false;
  try {
    await runDocker(["version", "--format", "{{.Server.Version}}"]);
    await runDocker(["run", "--rm", "-d", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, image]);
    started = true;
    await waitForPostgres();
    await psql(prerequisites);
    const hasVector = await scalar("select exists (select 1 from pg_available_extensions where name = 'vector');");
    if (hasVector !== "t") {
      throw new Error(`Scratch image ${image} has no real vector extension; use SCHEMA_BOOTSTRAP_IMAGE=pgvector/pgvector:pg16`);
    }
    await psql(schema);
    await psql(schema);
    await psql(maturitySamplingMigration);
    await psql(maturitySamplingMigration);
    assert.equal(await scalar("select string_agg(att.attname, ',' order by key.ordinality) from pg_constraint con join unnest(con.conkey) with ordinality key(attnum, ordinality) on true join pg_attribute att on att.attrelid=con.conrelid and att.attnum=key.attnum where con.conrelid='public.maturity_aspect_reviews'::regclass and con.contype='p';"), "audit_id,aspect_id,item_id,sample_id");
    assert.equal(await scalar("select count(*) from information_schema.columns where table_schema='public' and table_name='maturity_audit_evidence' and column_name in ('sample_id','sample_label','sample_group','supplementary_folder_id','supplementary_folder_name','is_supplementary');"), "6");
    assert.equal(await scalar("select position('FORM5S' in pg_get_constraintdef(oid)) > 0 from pg_constraint where conrelid='public.maturity_audit_drive_folders'::regclass and conname='maturity_audit_drive_folders_folder_type_check';"), "t");
    await assert.rejects(
      () => psql("select public.mtu_khs_apply_tug3_receipt('missing', 'bootstrap-negative');"),
      /MTU_RECEIPT_FORBIDDEN/,
    );
    await assert.rejects(
      () => psql("select public.mtu_khs_request_transfer('missing', 0, 1, 'UPT-X', null, null, null, null, null, '', 'bootstrap-negative');"),
      /MTU_SCOPE_DENIED/,
    );
    assert.equal(await scalar("select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'approve_tug10_final';"), "1");
    assert.equal(await scalar("select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'approve_tug3_final';"), "1");
    for (const table of [
      "tug_global_document_counters", "tug_transactions", "tug_items", "tug_approvals", "tug_review_tokens", "stock_movements", "tug3_transactions",
      "supplier", "mtu_khs_gardu_induk", "mtu_khs_gardu_induk_bay", "mtu_khs_specs", "mtu_khs_records", "mtu_khs_units", "mtu_khs_documents",
      "mtu_khs_record_documents", "mtu_khs_usage_links", "mtu_khs_change_requests", "mtu_khs_sheet_sync_jobs", "mtu_khs_import_batches",
      "mtu_khs_import_rows", "mtu_khs_reconciliations", "mtu_khs_stock_links", "mtu_khs_receipts", "mtu_khs_record_events",
      "mtu_khs_record_evidence", "mtu_khs_transfer_requests",
    ]) assert.equal(await scalar(`select to_regclass('public.${table}') is not null;`), "t", table);
    for (const [table, column] of [
      ["tug_global_document_counters", "document_unit_code"], ["tug_items", "source_snapshot"], ["tug3_transactions", "mtu_record_id"],
      ["mtu_khs_records", "lokasi_id"], ["mtu_khs_records", "search_text"], ["mtu_khs_sheet_sync_jobs", "before_sheet"],
      ["mtu_khs_transfer_requests", "target_record_id"], ["storage.buckets", "file_size_limit"], ["storage.buckets", "allowed_mime_types"],
    ]) assert.equal(await scalar(`select exists (select 1 from information_schema.columns where table_schema='${table.includes(".") ? table.split(".")[0] : "public"}' and table_name='${table.includes(".") ? table.split(".")[1] : table}' and column_name='${column}');`), "t", `${table}.${column}`);
    for (const fn of [
      "tug_actor", "tug_assert_upt_scope", "tug_hash", "tug_doc_code", "tug_doc_number", "tug_initial_stage", "tug_required_role", "tug_next_stage",
      "tug_stock_direction", "tug_assert_items", "tug_assert_canonical_item_refs", "tug_stock_snapshot", "tug_request_hash", "tug_idempotency_response",
      "tug_assert_outgoing_stock_scope", "mtu_khs_submit_change", "mtu_khs_decide_change", "mtu_khs_commit_import", "mtu_khs_decide_import",
      "mtu_khs_attach_document", "mtu_khs_register_document", "mtu_khs_link_approved_tug", "mtu_khs_upsert_gardu_induk", "mtu_khs_upsert_bay",
      "mtu_khs_deactivate_site_master", "mtu_khs_stage_import", "mtu_khs_update_import_row_mapping", "mtu_khs_set_reconciliation", "mtu_khs_link_stock",
      "mtu_khs_update_operational", "mtu_khs_request_transfer", "mtu_khs_decide_transfer", "mtu_khs_transfer_destinations", "mtu_khs_register_evidence",
      "mtu_khs_list_records", "mtu_khs_apply_tug3_receipt",
    ]) assert.equal(await scalar(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='${fn}';`), "1", fn);
    for (const trigger of ["trg_mtu_khs_refresh_search_text", "katalog_fill_satuan"]) {
      assert.equal(await scalar(`select count(*) from pg_trigger where tgname='${trigger}';`), "1", trigger);
    }
    for (const table of [
      "tug_global_document_counters", "tug_transactions", "tug_items", "tug_approvals", "tug_review_tokens", "stock_movements", "tug3_transactions",
      "mtu_khs_gardu_induk", "mtu_khs_gardu_induk_bay", "mtu_khs_specs", "mtu_khs_records", "mtu_khs_units", "mtu_khs_documents",
      "mtu_khs_record_documents", "mtu_khs_usage_links", "mtu_khs_change_requests", "mtu_khs_sheet_sync_jobs", "mtu_khs_import_batches", "mtu_khs_import_rows",
      "mtu_khs_reconciliations", "mtu_khs_stock_links", "mtu_khs_receipts", "mtu_khs_record_events", "mtu_khs_record_evidence", "mtu_khs_transfer_requests",
    ]) {
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='public.${table}'::regclass;`), "t", `${table} RLS`);
    }
    for (const table of [
      "tug_global_document_counters", "tug_transactions", "tug_items", "tug_approvals", "stock_movements", "tug3_transactions", "supplier",
      "mtu_khs_gardu_induk", "mtu_khs_gardu_induk_bay", "mtu_khs_specs", "mtu_khs_records", "mtu_khs_units", "mtu_khs_documents",
      "mtu_khs_record_documents", "mtu_khs_usage_links", "mtu_khs_change_requests", "mtu_khs_sheet_sync_jobs", "mtu_khs_import_batches", "mtu_khs_import_rows",
      "mtu_khs_reconciliations", "mtu_khs_stock_links", "mtu_khs_receipts", "mtu_khs_record_events", "mtu_khs_record_evidence", "mtu_khs_transfer_requests",
    ]) assert.equal(await scalar(`select has_table_privilege('authenticated', 'public.${table}', 'SELECT');`), "t", `${table} SELECT grant`);
    assert.equal(await scalar("select has_function_privilege('authenticated', 'public.mtu_khs_apply_tug3_receipt(text,text)', 'EXECUTE');"), "t");
    for (const [table, policy] of [
      ["supplier", "Authenticated read supplier"], ["tug_global_document_counters", "Scoped read tug_global_document_counters"], ["tug3_transactions", "Scoped read tug3_transactions"],
      ["tug_transactions", "Scoped read tug_transactions"], ["tug_items", "Scoped read tug_items"], ["tug_approvals", "Scoped read tug_approvals"], ["tug_review_tokens", "Scoped read tug_review_tokens"], ["stock_movements", "Scoped read stock_movements"],
      ["mtu_khs_gardu_induk", "MTU KHS GI scoped"], ["mtu_khs_gardu_induk_bay", "MTU KHS Bay scoped"], ["mtu_khs_specs", "MTU KHS specs read"],
      ["mtu_khs_records", "MTU KHS records scoped"], ["mtu_khs_records", "MTU KHS records controlled write"], ["mtu_khs_records", "MTU KHS records no direct update"], ["mtu_khs_records", "MTU KHS records no direct delete"], ["mtu_khs_units", "MTU KHS units scoped"], ["mtu_khs_documents", "MTU KHS documents read"],
      ["mtu_khs_record_documents", "MTU KHS record documents scoped"], ["mtu_khs_usage_links", "MTU KHS usage scoped"], ["mtu_khs_change_requests", "MTU KHS changes scoped"],
      ["mtu_khs_sheet_sync_jobs", "MTU KHS sheet sync scoped"], ["mtu_khs_import_batches", "MTU KHS import batches"], ["mtu_khs_import_rows", "MTU KHS import rows"],
      ["mtu_khs_reconciliations", "MTU KHS reconciliation scoped"], ["mtu_khs_stock_links", "MTU KHS stock links scoped"], ["mtu_khs_receipts", "MTU KHS receipts scoped"],
      ["mtu_khs_record_events", "MTU KHS events scoped"], ["mtu_khs_record_evidence", "MTU KHS evidence scoped"], ["mtu_khs_transfer_requests", "MTU KHS transfers scoped"],
    ]) assert.equal(await scalar(`select count(*) from pg_policies where schemaname='public' and tablename='${table}' and policyname='${policy}';`), "1", `${table}.${policy}`);
    assert.equal(await scalar("select to_regclass('public.idx_mara_catalog_resolver_code') is not null;"), "t");
    console.log("Schema bootstrap rehearsal passed: full snapshot and maturity sampling migration applied twice with real Auth/Storage contracts and pgvector.");
  } finally {
    if (started) await runDocker(["rm", "-f", container]).catch(() => {});
  }
}

await main();
