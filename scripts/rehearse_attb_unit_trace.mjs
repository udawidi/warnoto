import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = await fs.readFile(path.join(root, "supabase/migrations/20261013_attb_unit_trace.sql"), "utf8");
const docker = process.env.ATTB_TRACE_DOCKER || "docker";
const container = "warnoto-attb-trace-" + process.pid + "-" + crypto.randomBytes(3).toString("hex");
const password = crypto.randomBytes(16).toString("hex");
function run(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(docker, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", x => { out += x; });
    p.stderr.on("data", x => { err += x; });
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve(out) : reject(new Error(args.join(" ") + " failed (" + code + ")\n" + err)));
    p.stdin.end(input || "");
  });
}
const psql = sql => run(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-U", "postgres", "-d", "postgres"], sql);
const scalar = async sql => (await psql(sql)).trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
const expectError = async (sql, code) => assert.rejects(() => psql(sql), error => error.message.includes(code));
const bootstrap = `
create extension if not exists pgcrypto;
create schema if not exists auth;
create role anon;
create role authenticated;
create role service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.profiles (id uuid primary key, name text, role text, upt_id text);
create table public.upt (id text primary key, data jsonb not null);
create table public.gudang (id text primary key, upt_id text, data jsonb not null default '{}');
create table public.sub_gudang (id text primary key, gudang_id text, data jsonb not null default '{}');
create table public.lokasi (id text primary key, gudang_id text, data jsonb not null default '{}');
create table public.katalog (id text primary key, data jsonb not null default '{}');
create table public.tug10_transactions (id text primary key, upt_id text not null, created_by uuid, doc_number text, stage text not null default 'DRAFT', status text not null default 'DRAFT', data jsonb not null default '{}', created_at bigint, updated_at bigint);
create table public.attb_list (id text primary key, data jsonb not null default '{}', created_at bigint, upt text, stage text);
create or replace function public.can_access_upt(p_upt_id text) returns boolean language sql stable security definer set search_path = public as $$ select true $$;
create or replace function public.can_access_upt_nama(p_upt_id text) returns boolean language sql stable security definer set search_path = public as $$ select true $$;
`;
await run(["run", "--rm", "--name", container, "-e", "POSTGRES_PASSWORD=" + password, "-d", "postgres:16"]);
try {
  for (let i = 0; i < 60; i++) { try { await run(["exec", container, "pg_isready", "-U", "postgres"]); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); } }
  await psql(bootstrap);
  await psql(migration);
  await psql(migration);
  const actor = "00000000-0000-4000-8000-000000000001";
  await psql(`
insert into public.profiles(id,name,role,upt_id) values ('${actor}','Asman','ASMAN','UPT-1');
insert into public.upt(id,data) values ('UPT-1','{"nama":"UPT Satu"}');
insert into public.gudang(id,upt_id,data) values ('G-1','UPT-1','{"nama":"Gudang Satu"}');
insert into public.sub_gudang(id,gudang_id,data) values ('SG-1','G-1','{"nama":"Sub Satu"}');
insert into public.lokasi(id,gudang_id,data) values ('L-1','G-1','{"kode":"B-01","subGudangId":"SG-1"}');
insert into public.katalog(id,data) values ('K-1','{"katalog":"MAT-1","name":"Material Satu","satuan":"unit"}');
insert into public.tug10_transactions(id,upt_id,created_by,doc_number,stage,status,data) values ('T10-1','UPT-1','${actor}','TUG10/001','PENDING_ASMAN','PENDING','{"docNumbers":{"tug10":"TUG10/001"},"lokasiTujuanId":"L-1","stockItems":[{"statusMaterial":"Bongkaran ATTB (MTU)","qty":1,"noSeri":"SER-1","noAsset":"","katalogId":"K-1","fotoBarangRetur":"https://warnoto.com/storage/v1/object/public/tug-photos/T10-1/item0-fotoBarangRetur.jpg","fotoNameplate":"https://warnoto.com/storage/v1/object/public/tug-photos/T10-1/item0-fotoNameplate.jpg"},{"statusMaterial":"Bongkaran ATTB (MTU)","qty":1,"noSeri":"SER-2","noAsset":"","katalogId":"K-1","fotoBarangRetur":"https://warnoto.com/storage/v1/object/public/tug-photos/T10-1/item1-fotoBarangRetur.jpg","fotoNameplate":"https://warnoto.com/storage/v1/object/public/tug-photos/T10-1/item1-fotoNameplate.jpg"}]}');
insert into public.attb_list(id,data,created_at,upt,stage) values ('ATTB-1','{"source":"TUG10","sourceTxnId":"T10-1","sourceItemIdx":0,"createdBy":"${actor}"}',1000,'UPT-1','USULAN_AE1');
insert into public.attb_list(id,data,created_at,upt,stage) values ('ATTB-2','{"source":"TUG10","sourceTxnId":"T10-1","sourceItemIdx":1,"createdBy":"${actor}"}',1001,'UPT-1','USULAN_AE1');
`);
  assert.equal(await scalar("select count(*) from public.attb_public_links"), "2");
  assert.equal(await scalar("select count(*) from public.attb_item_history where event_type='RECEIVED_TUG10'"), "2");
  assert.equal(await scalar("select count(distinct public_token) from public.attb_public_links"), "2");
  assert.equal(await scalar("select upt from public.attb_list where id='ATTB-1'"), "UPT Satu");
  const token = await scalar("select public_token from public.attb_public_links where attb_id='ATTB-1'");
  assert.notEqual(token, "");
  const payload = await scalar("select public.public_attb_material('ATTB-1','" + token + "')");
  assert.match(payload, /"trackingCode"\s*:\s*"ATTB-1"/);
  assert.match(payload, /"TUG10\/001"/);
  assert.equal(await scalar("select public.public_attb_material('ATTB-1',gen_random_uuid()) is null"), "t");
  await expectError("insert into public.attb_item_history(attb_id,upt_id,event_type,occurred_at) values ('ATTB-1','UPT-1','BAD',1)", "ATTB_HISTORY_APPEND_ONLY");
  await psql(`update public.profiles set role='TL' where id='${actor}'; insert into public.attb_list(id,data,created_at,upt,stage) values ('ATTB-LEGACY','{}',999,'UPT Satu','USULAN_AE1');`);
  await expectError(`select set_config('request.jwt.claim.sub','${actor}',false); select public.rotate_attb_public_token('ATTB-LEGACY');`, "ATTB_PUBLIC_LINK_NOT_FOUND");
  assert.equal(await scalar("select count(*) from public.attb_item_history where attb_id='ATTB-LEGACY'"), "0");
  await expectError("update public.tug10_transactions set data=jsonb_set(data,'{stockItems,0,qty}','2'),stage='APPROVED',status='APPROVED' where id='T10-1';", "TUG10_ATTB_QTY_INVALID");
  await psql("update public.tug10_transactions set stage='APPROVED',status='APPROVED' where id='T10-1';");
  console.log("ATTB unit trace PostgreSQL rehearsal passed: compile, idempotent link/history, normalized UPT, public token allowlist, append-only guard, and approval validation.");
} finally { await run(["rm", "-f", container]).catch(() => {}); }

