import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261012_tug_mara_post_guard.sql"), "utf8");
const docker = process.env.TUG_REHEARSAL_DOCKER || "docker";
const dockerHost = process.env.TUG_REHEARSAL_DOCKER_HOST || "";
const container = `warnoto-tug-mara-rehearsal-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const password = crypto.randomBytes(16).toString("hex");
const ids = {
  asman: "00000000-0000-4000-8000-000000000003",
  actor: "00000000-0000-4000-8000-000000000004",
};

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
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr}\n${stdout}`));
    });
    child.stdin.end(input ?? "");
  });
}

function runDocker(args, input) {
  return dockerHost ? run("ssh", [dockerHost, docker, ...args], input) : run(docker, args, input);
}

async function psql(sql) {
  return (await runDocker([
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A",
    "-U", "postgres", "-d", "postgres",
  ], sql)).stdout;
}

async function scalar(sql) {
  const lines = (await psql(sql)).trim().split(/\r?\n/).filter(Boolean);
  return lines.at(-1) || "";
}

async function expectSqlError(sql, expected) {
  await assert.rejects(() => psql(sql), error => error.message.includes(expected));
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

const bootstrap = `
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;
create role anon;
create role authenticated;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.profiles (
  id uuid primary key,
  name text not null,
  role text not null,
  upt_id text,
  uit_id text,
  created_at timestamptz not null default now()
);
create table public.gudang (id text primary key, upt_id text not null);
create table public.lokasi (id text primary key, gudang_id text not null references public.gudang(id));
create table public.mara_catalog (
  kode_material text,
  nama text,
  satuan text,
  material_group text,
  material_group_desc text,
  status text
);
create table public.katalog (id text primary key, data jsonb not null default '{}'::jsonb, created_at bigint);
create table public.stocks (
  id text primary key,
  katalog_id text,
  lokasi_id text,
  upt_id text,
  data jsonb not null default '{}'::jsonb,
  created_at bigint not null default 0
);
create table public.tug_idempotency_keys (
  key uuid primary key,
  operation text not null check (operation in ('CREATE','SUBMIT','DECIDE','AMEND','TUG10_FINAL_APPROVE')),
  actor_id uuid not null,
  request_hash text not null,
  response jsonb not null
);
create table public.tug3_transactions (
  id text primary key,
  status text not null,
  stage text not null,
  upt_id text not null,
  data jsonb not null default '{}'::jsonb,
  doc_number text,
  mtu_record_id text,
  updated_at bigint not null default 0
);
create table public.tug10_transactions (
  id text primary key,
  status text not null,
  stage text not null,
  upt_id text not null,
  data jsonb not null default '{}'::jsonb,
  doc_number text,
  updated_at bigint not null default 0
);
create table public.mtu_khs_records (
  id text primary key,
  procurement_year integer not null,
  sifat_pekerjaan text not null,
  upt_id text not null,
  katalog_id text,
  qty numeric not null
);
create table public.mtu_khs_receipts (
  id uuid primary key default gen_random_uuid(),
  mtu_record_id text not null,
  tug3_transaction_id text not null,
  qty numeric not null,
  items jsonb not null,
  applied_by uuid not null,
  idempotency_key text not null
);
create table public.attb_list (
  id text primary key,
  data jsonb not null,
  created_at bigint not null,
  upt text,
  stage text
);
create table public.audit_log (
  user_id uuid,
  user_name text,
  role text,
  action text,
  entity text,
  entity_id text,
  detail jsonb
);
create table storage.objects (bucket_id text not null, name text not null);

create or replace function public.can_access_upt(p_upt_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'SUPERADMIN' or p.upt_id = p_upt_id)
  )
$$;
create or replace function public.mtu_khs_can_access_upt(p_upt_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_access_upt(p_upt_id)
$$;
create or replace function public.approve_tug10_final(p_tug10_id text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return '{}'::jsonb;
end;
$$;

create or replace function public.katalog_fill_satuan_from_mara()
returns trigger language plpgsql as $$ begin return new; end $$;
create trigger katalog_fill_satuan before insert or update on public.katalog
for each row execute function public.katalog_fill_satuan_from_mara();

insert into public.profiles(id, name, role, upt_id) values
  ('${ids.asman}', 'Asman Rehearsal', 'ASMAN', 'UPT-A'),
  ('${ids.actor}', 'Actor Rehearsal', 'SUPERADMIN', null);
insert into public.gudang(id, upt_id) values ('GD-A', 'UPT-A');
insert into public.lokasi(id, gudang_id) values ('LOC-A', 'GD-A');
insert into public.mara_catalog(kode_material,nama,satuan,material_group,material_group_desc,status) values
  ('000123','MARA Valid','EA','G1','Group Valid','SAP'),
  ('000456','MARA Stale Repair','SET','G2','Group Stale','SAP'),
  ('000555','','EA','G3','Group Invalid','SAP');
insert into public.katalog(id, data, created_at) values
  ('KAT-VALID','{"katalog":"000123","name":"Manual Name","satuan":"PCS"}'::jsonb,0),
  ('KAT-STALE','{"katalog":"0456","name":"Stale Name","satuan":"PCS"}'::jsonb,0),
  ('KAT-MISSING','{"katalog":"999999","name":"Missing","satuan":"EA"}'::jsonb,0),
  ('KAT-INVALID','{"katalog":"555","name":"Invalid","satuan":"EA"}'::jsonb,0);
insert into public.stocks(id,katalog_id,lokasi_id,upt_id,data,created_at)
values ('STK-BASE','KAT-VALID','LOC-A','UPT-A','{"qty":10}'::jsonb,0);
insert into storage.objects(bucket_id,name) values
  ('tug-photos','MTU-T3-VALID/item0-fotoBarang.jpg'),
  ('tug-photos','MTU-T3-BAD/item0-fotoBarang.jpg');
`;

async function main() {
  let started = false;
  try {
    await runDocker(["version", "--format", "{{.Server.Version}}"]);
    await runDocker(["run", "--rm", "-d", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, "postgres:16"]);
    started = true;
    await waitForPostgres();
    await psql(bootstrap);
    await psql(migration);

    await psql(`
insert into public.tug3_transactions(id,status,stage,upt_id,doc_number,data) values (
  'T3-VALID','PENDING','PENDING_ASMAN','UPT-A','DOC-T3-VALID',
  jsonb_build_object('stockItems', jsonb_build_array(jsonb_build_object(
    'katalogMode','existing','katalogId','KAT-VALID','lokasiTujuanId','LOC-A','qty',3,
    'hargaSatuan','10','sapStatus','SAP','fotoBarang','https://example.test/t3.jpg')),
    'judulKontrak',' KONTRAK/ABC ','dariSupplier','Acme & Co','suratPesananNo','PO-1',
    'suratPesananTgl','2026-10-12','amandemenNo','A0','docNumbers',jsonb_build_object('tug3','DOC-T3-VALID'),
    'lokasiTujuanId','LOC-A'));
`);
    const validResponse = JSON.parse(await scalar(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.approve_tug3_final('T3-VALID','10000000-0000-4000-8000-000000000001');`));
    assert.equal(validResponse.transaction.status, "APPROVED");
    assert.equal(await scalar("select data->>'name' from public.stocks where id like 'STK-TUG3-%';"), "MARA Valid");
    assert.equal(await scalar("select data->>'katalog' from public.stocks where id like 'STK-TUG3-%';"), "000123");
    assert.equal(await scalar("select data->>'unit' from public.stocks where id like 'STK-TUG3-%';"), "EA");
    assert.equal(await scalar("select data->'sourceLot'->>'key' from public.stocks where id like 'STK-TUG3-%';"), "tug3|upt-a|loc-a|kat-valid|acme-co|kontrak-abc");
    assert.equal(await scalar("select length(data->'kontrakRefs'->0->>'noKontrak') from public.stocks where id like 'STK-TUG3-%';"), "13");
    assert.equal(await scalar("select btrim(data->'kontrakRefs'->0->>'noKontrak') from public.stocks where id like 'STK-TUG3-%';"), "KONTRAK/ABC");
    assert.equal(await scalar("select data->>'approvedByAsman' from public.tug3_transactions where id='T3-VALID';"), ids.asman);
    const retry = JSON.parse(await scalar(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.approve_tug3_final('T3-VALID','10000000-0000-4000-8000-000000000001');`));
    assert.equal(retry.idempotent, true);
    assert.equal(await scalar("select data->>'qty' from public.stocks where id like 'STK-TUG3-%';"), "3");

    await psql(`
insert into public.tug3_transactions(id,status,stage,upt_id,data) values
  ('T3-MISSING','PENDING','PENDING_ASMAN','UPT-A',jsonb_build_object('stockItems',jsonb_build_array(jsonb_build_object('katalogMode','existing','katalogId','KAT-MISSING','lokasiTujuanId','LOC-A','qty',1)),'lokasiTujuanId','LOC-A')),
  ('T3-INVALID','PENDING','PENDING_ASMAN','UPT-A',jsonb_build_object('stockItems',jsonb_build_array(jsonb_build_object('katalogMode','existing','katalogId','KAT-INVALID','lokasiTujuanId','LOC-A','qty',1)),'lokasiTujuanId','LOC-A'));
`);
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.approve_tug3_final('T3-MISSING','10000000-0000-4000-8000-000000000002');`, "TUG3_MARA_CATALOG_NOT_FOUND");
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.approve_tug3_final('T3-INVALID','10000000-0000-4000-8000-000000000003');`, "TUG3_MARA_CATALOG_INVALID");
    assert.equal(await scalar("select status from public.tug3_transactions where id='T3-MISSING';"), "PENDING");
    assert.equal(await scalar("select status from public.tug3_transactions where id='T3-INVALID';"), "PENDING");
    assert.equal(await scalar("select count(*) from public.stocks where id like 'STK-TUG3-%' and id <> 'STK-TUG3-' || md5('T3-VALID:0');"), "0");

    await psql("insert into public.mara_catalog(kode_material,nama,satuan,material_group,material_group_desc,status) values ('123','Duplicate','EA','G1','Group Valid','SAP'); insert into public.katalog(id,data,created_at) values ('KAT-AMB','{\"katalog\":\"123\"}'::jsonb,0); insert into public.tug3_transactions(id,status,stage,upt_id,data) values ('T3-AMB','PENDING','PENDING_ASMAN','UPT-A',jsonb_build_object('stockItems',jsonb_build_array(jsonb_build_object('katalogMode','existing','katalogId','KAT-AMB','lokasiTujuanId','LOC-A','qty',1)),'lokasiTujuanId','LOC-A')); ");
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.approve_tug3_final('T3-AMB','10000000-0000-4000-8000-000000000004');`, "TUG3_MARA_CATALOG_AMBIGUOUS");
    assert.equal(await scalar("select status from public.tug3_transactions where id='T3-AMB';"), "PENDING");

    await psql(`
insert into public.tug10_transactions(id,status,stage,upt_id,doc_number,data) values
  ('T10-STALE','PENDING','PENDING_ASMAN','UPT-A','DOC-T10-STALE',jsonb_build_object(
    'lokasiTujuanId','LOC-A','stockItems',jsonb_build_array(jsonb_build_object(
      'katalogMode','existing','katalogId','KAT-STALE','qty',2,'statusMaterial','Material Sisa Baru',
      'fotoBarangRetur','https://example.test/t10.jpg','stockHandling','SEPARATE')))),
  ('T10-BAD','PENDING','PENDING_ASMAN','UPT-A','DOC-T10-BAD',jsonb_build_object(
    'lokasiTujuanId','LOC-A','stockItems',jsonb_build_array(jsonb_build_object(
      'katalogMode','existing','katalogId','KAT-MISSING','qty',2,'statusMaterial','Material Sisa Baru',
      'fotoBarangRetur','https://example.test/t10.jpg','stockHandling','SEPARATE'))));
`);
    const t10 = JSON.parse(await scalar(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.approve_tug10_final('T10-STALE','20000000-0000-4000-8000-000000000001');`));
    assert.equal(t10.transaction.status, "APPROVED");
    assert.equal(t10.katalogs[0].name, "MARA Stale Repair");
    assert.equal(t10.katalogs[0].katalog, "000456");
    assert.equal(t10.katalogs[0].satuan, "SET");
    assert.equal(await scalar("select data->>'name' from public.katalog where id='KAT-STALE';"), "MARA Stale Repair");
    assert.equal(await scalar("select data->>'katalog' from public.katalog where id='KAT-STALE';"), "000456");
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.approve_tug10_final('T10-BAD','20000000-0000-4000-8000-000000000002');`, "TUG10_MARA_CATALOG_NOT_FOUND");
    assert.equal(await scalar("select status from public.tug10_transactions where id='T10-BAD';"), "PENDING");

    await psql(`
insert into public.mtu_khs_records(id,procurement_year,sifat_pekerjaan,upt_id,katalog_id,qty) values
  ('MTU-REC-VALID',2026,'NORMAL','UPT-A','KAT-STALE',2),('MTU-REC-BAD',2026,'NORMAL','UPT-A','KAT-MISSING',2);
insert into public.tug3_transactions(id,status,stage,upt_id,mtu_record_id,data) values
  ('MTU-T3-VALID','PENDING','PENDING_ASMAN','UPT-A','MTU-REC-VALID',jsonb_build_object('stockItems',jsonb_build_array(jsonb_build_object('katalogId','KAT-STALE','lokasiTujuanId','LOC-A','qty',2,'fotoBarang','https://warnoto.com/storage/v1/object/public/tug-photos/MTU-T3-VALID/item0-fotoBarang.jpg')))),
  ('MTU-T3-BAD','PENDING','PENDING_ASMAN','UPT-A','MTU-REC-BAD',jsonb_build_object('stockItems',jsonb_build_array(jsonb_build_object('katalogId','KAT-MISSING','lokasiTujuanId','LOC-A','qty',2,'fotoBarang','https://warnoto.com/storage/v1/object/public/tug-photos/MTU-T3-BAD/item0-fotoBarang.jpg'))));
`);
    const mtu = JSON.parse(await scalar(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.mtu_khs_apply_tug3_receipt('MTU-T3-VALID','mtu-valid');`));
    assert.equal(mtu.deduped, false);
    assert.equal(await scalar("select data->>'name' from public.stocks where data->>'mtuTug3Id'='MTU-T3-VALID';"), "MARA Stale Repair");
    assert.equal(await scalar("select status from public.tug3_transactions where id='MTU-T3-VALID';"), "APPROVED");
    await expectSqlError(`select set_config('request.jwt.claim.sub','${ids.asman}',false); select public.mtu_khs_apply_tug3_receipt('MTU-T3-BAD','mtu-bad');`, "MTU_MARA_CATALOG_NOT_FOUND");
    assert.equal(await scalar("select status from public.tug3_transactions where id='MTU-T3-BAD';"), "PENDING");

    console.log("TUG MARA PostgreSQL rehearsal passed: compile, canonical TUG3, rollback, idempotency, TUG10 stale response, and MTU.");
  } finally {
    if (started) await runDocker(["rm", "-f", container]).catch(() => {});
  }
}

await main();
