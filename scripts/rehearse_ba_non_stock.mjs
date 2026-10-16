import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261015_ba_non_stock.sql"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261016_ba_non_stock_draft_tl_review.sql"), "utf8");
const docker = process.env.BA_NON_STOCK_REHEARSAL_DOCKER || "docker";
const dockerHost = process.env.BA_NON_STOCK_REHEARSAL_DOCKER_HOST || "";
const container = `warnoto-ba-non-stock-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const password = crypto.randomBytes(16).toString("hex");
const ids = {
  admin: "00000000-0000-4000-8000-000000000001",
  tl: "00000000-0000-4000-8000-000000000002",
  otherTl: "00000000-0000-4000-8000-000000000003",
};

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr.slice(-3000)}`)));
    child.stdin.end(input ?? "");
  });
}

function dockerRun(args, input) {
  return dockerHost ? run("ssh", [dockerHost, docker, ...args], input) : run(docker, args, input);
}

async function psql(sql) {
  return (await dockerRun([
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-U", "postgres", "-d", "postgres",
  ], sql)).stdout;
}

async function scalar(sql) {
  const lines = (await psql(sql)).trim().split(/\r?\n/).filter(Boolean);
  return lines.at(-1) || "";
}

async function expectSqlError(sql, marker) {
  await assert.rejects(() => psql(sql), error => error.message.includes(marker));
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await dockerRun(["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"]);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error("Scratch PostgreSQL did not become ready");
}

const prerequisites = `
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.profiles (id uuid primary key, name text not null, role text not null, jabatan text, upt_id text);
create table public.gudang (id text primary key, upt_id text not null);
create table public.satpam (id text primary key, data jsonb not null, created_at bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, metadata jsonb);
create or replace function public.can_access_upt(p_upt_id text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='SUPERADMIN' or p.upt_id=p_upt_id));
$$;
insert into public.profiles(id,name,role,jabatan,upt_id) values
  ('${ids.admin}','Admin A','ADMIN','Admin Gudang','UPT-A'),
  ('${ids.tl}','TL A','TL','Team Leader','UPT-A'),
  ('${ids.otherTl}','TL B','TL','Team Leader','UPT-B');
insert into public.gudang(id,upt_id) values ('GD-A','UPT-A'),('GD-B','UPT-B');
insert into public.satpam(id,data) values ('SAT-A','{"nama":"Satpam A","gudangId":"GD-A"}'::jsonb);
`;

const payload = value => `$json$${JSON.stringify(value)}$json$::jsonb`;
function completePayload(id) {
  return {
    kind: "NON_STOCK", issueDate: "2026-10-15", warehouseId: "GD-A", securityGuardId: "SAT-A",
    sender: "Gudang A", destinationUnit: "Unit Tujuan", referenceDocument: `REF-${id}`, purpose: "Pekerjaan",
    recipientName: "Penerima", recipientTitle: "Jabatan", recipientUnit: "Unit",
    photoLabelUrl: `https://warnoto.com/storage/v1/object/public/tug-photos/ba-non-stock/${id}/label.jpg`,
    photoLoadedUrl: `https://warnoto.com/storage/v1/object/public/tug-photos/ba-non-stock/${id}/loaded.jpg`,
    items: [{ materialName: "Kabel", qty: 2, unit: "roll", description: "Manual" }],
  };
}

async function main() {
  let started = false;
  try {
    await dockerRun(["version", "--format", "{{.Server.Version}}"]);
    await dockerRun(["run", "--rm", "-d", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, "postgres:17-alpine"]);
    started = true;
    await waitForPostgres();
    await psql(prerequisites);
    await psql(baseMigration);
    await psql(migration);

    const partialId = "BA-REHEARSAL-TL-PARTIAL";
    await psql(`select set_config('request.jwt.claim.sub','${ids.tl}',false);
      select public.save_ba_non_stock_draft('${partialId}',null,'UPT-A',${payload({ kind: "NON_STOCK", items: [{ qty: 2 }] })});
    `);
    assert.equal(await scalar(`select coalesce(material_name, '') || ':' || qty::text from public.ba_non_stock_items where ba_id='${partialId}';`), ":2");
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.tl}',false); select public.submit_ba_non_stock('${partialId}',1);`, "BA_REQUIRED_FIELD");
    await psql(`insert into storage.objects(bucket_id,name) values ('tug-photos','ba-non-stock/${partialId}/label.jpg'),('tug-photos','ba-non-stock/${partialId}/loaded.jpg');
      select set_config('request.jwt.claim.sub','${ids.tl}',false);
      select public.save_ba_non_stock_draft('${partialId}',1,'UPT-A',${payload(completePayload(partialId))});
    `);
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.tl}',false); select public.save_ba_non_stock_draft('${partialId}',1,'UPT-A',${payload(completePayload(partialId))});`, "BA_VERSION_MISMATCH");
    await psql(`select set_config('request.jwt.claim.sub','${ids.tl}',false);
      select public.submit_ba_non_stock('${partialId}',2);
      select public.decide_ba_non_stock('${partialId}',3,'APPROVE',null);
    `);
    assert.equal(await scalar(`select doc_number from public.ba_non_stock where id='${partialId}';`), "001.BA/UPT-A/10/2026");

    const id = "BA-REHEARSAL-001";
    await psql(`insert into storage.objects(bucket_id,name,metadata) values
      ('tug-photos','ba-non-stock/${id}/label.jpg','{"mimetype":"image/jpeg"}'::jsonb),
      ('tug-photos','ba-non-stock/${id}/loaded.jpg','{"mimetype":"image/jpeg"}'::jsonb);
      select set_config('request.jwt.claim.sub','${ids.admin}',false);
      select public.save_ba_non_stock_draft('${id}',null,'UPT-A',${payload({ kind: "NON_STOCK" })});
    `);
    assert.equal(await scalar(`select status from public.ba_non_stock where id='${id}';`), "DRAFT");
    await psql(`select set_config('request.jwt.claim.sub','${ids.admin}',false);
      select public.save_ba_non_stock_draft('${id}',1,'UPT-A',${payload({
        kind: "NON_STOCK", issueDate: "2026-10-15", warehouseId: "GD-A", securityGuardId: "SAT-A",
        sender: "Gudang A", destinationUnit: "Unit Tujuan", referenceDocument: "REF-001", purpose: "Pekerjaan",
        recipientName: "Penerima", recipientTitle: "Jabatan", recipientUnit: "Unit", photoLabelUrl: `https://warnoto.com/storage/v1/object/public/tug-photos/ba-non-stock/${id}/label.jpg`, photoLoadedUrl: `https://warnoto.com/storage/v1/object/public/tug-photos/ba-non-stock/${id}/loaded.jpg`,
        items: [{ materialName: "Kabel", qty: 2, unit: "roll", description: "Manual" }],
      })});
      select public.submit_ba_non_stock('${id}',2);
    `);
    assert.equal(await scalar(`select stage from public.ba_non_stock where id='${id}';`), "PENDING_TL");
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.otherTl}',false); select public.decide_ba_non_stock('${id}',3,'APPROVE',null);`, "BA_SCOPE_DENIED");
    await psql(`select set_config('request.jwt.claim.sub','${ids.tl}',false); select public.decide_ba_non_stock('${id}',3,'APPROVE',null);`);
    assert.equal(await scalar(`select doc_number from public.ba_non_stock where id='${id}';`), "002.BA/UPT-A/10/2026");
    assert.equal(await scalar("select count(*) from public.ba_non_stock_counters where upt_id='UPT-A' and year=2026 and last_value=2;"), "1");

    const concurrentIds = ["BA-REHEARSAL-002", "BA-REHEARSAL-003"];
    await psql(`insert into storage.objects(bucket_id,name) values
      ('tug-photos','ba-non-stock/${concurrentIds[0]}/label.jpg'), ('tug-photos','ba-non-stock/${concurrentIds[0]}/loaded.jpg'),
      ('tug-photos','ba-non-stock/${concurrentIds[1]}/label.jpg'), ('tug-photos','ba-non-stock/${concurrentIds[1]}/loaded.jpg');
      select set_config('request.jwt.claim.sub','${ids.admin}',false);
      select public.save_ba_non_stock_draft('${concurrentIds[0]}',null,'UPT-A',${payload(completePayload(concurrentIds[0]))});
      select public.save_ba_non_stock_draft('${concurrentIds[1]}',null,'UPT-A',${payload(completePayload(concurrentIds[1]))});
      select public.submit_ba_non_stock('${concurrentIds[0]}',1);
      select public.submit_ba_non_stock('${concurrentIds[1]}',1);
    `);
    const approveSql = idToApprove => `select set_config('request.jwt.claim.sub','${ids.tl}',false); select public.decide_ba_non_stock('${idToApprove}',2,'APPROVE',null);`;
    await Promise.all(concurrentIds.map(idToApprove => psql(approveSql(idToApprove))));
    assert.equal(await scalar("select count(*) from public.ba_non_stock where doc_number in ('003.BA/UPT-A/10/2026','004.BA/UPT-A/10/2026');"), "2");
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.tl}',false); select public.decide_ba_non_stock('${id}',4,'REJECT',null);`, "BA_STAGE_INVALID");
    console.log("BA Non Stock PostgreSQL rehearsal passed: draft, submit validation, scope denial, atomic numbering, and final snapshot path.");
  } finally {
    if (started) await dockerRun(["rm", "-f", container]).catch(() => {});
  }
}

await main();
