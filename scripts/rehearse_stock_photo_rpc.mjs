// Scratch PostgreSQL rehearsal for the stock-photo RPC proposal.
// It never connects to production and never applies a migration remotely.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn } from "node:child_process";

const docker = process.env.STOCK_PHOTO_REHEARSAL_DOCKER || "docker";
const host = process.env.STOCK_PHOTO_REHEARSAL_DOCKER_HOST || "";
const container = `warnoto-stock-photo-rehearsal-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const migration = fs.readFileSync("supabase/migrations/20261015_stock_photo_rpc.sql", "utf8");

function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr}`)));
    child.stdin.end(input);
  });
}

function dockerRun(args, input) {
  return host ? run("ssh", [host, docker, ...args], input) : run(docker, args, input);
}

async function psql(sql) {
  return (await dockerRun(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-U", "postgres", "-d", "postgres"], sql)).stdout;
}

async function scalar(sql) {
  const rows = (await psql(sql)).trim().split(/\r?\n/).filter(Boolean);
  return rows.at(-1) || "";
}

async function expectSqlError(sql, expected) {
  await assert.rejects(() => psql(sql), error => error.message.includes(expected));
}

const bootstrap = `
create schema auth;
create schema storage;
create role anon;
create role authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.profiles (id uuid primary key, role text not null, upt_id text);
create table public.upt (id text primary key);
create table public.stocks (id text primary key, katalog_id text, lokasi_id text, upt_id text, data jsonb not null default '{}', created_at bigint default 0);
create table storage.objects (bucket_id text not null, name text not null, metadata jsonb default '{}', primary key (bucket_id, name));
create or replace function public.can_access_upt(p_upt_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or p.upt_id = p_upt_id))
$$;
alter table public.stocks enable row level security;
create policy stock_scope on public.stocks for all to authenticated using (public.can_access_upt(upt_id)) with check (public.can_access_upt(upt_id));
grant usage on schema public, storage to authenticated;
grant select, insert, update on public.stocks to authenticated;
insert into public.upt(id) values ('UPT-1'), ('UPT-2');
insert into public.profiles(id, role, upt_id) values
 ('00000000-0000-4000-8000-000000000001', 'TL', 'UPT-1'),
 ('00000000-0000-4000-8000-000000000002', 'ADMIN', 'UPT-2'),
 ('00000000-0000-4000-8000-000000000003', 'SUPERADMIN', null);
insert into public.stocks(id, katalog_id, lokasi_id, upt_id, data, created_at) values
 ('STK-TUG3-1', 'KAT-1', 'LOK-1', 'UPT-1', jsonb_build_object(
   'qty', 108, 'sourceLot', jsonb_build_object('kind','TUG3_CONTRACT','noKontrak','K-1'),
   '_tug3Applied', jsonb_build_object('TUG3|K-1',108), 'uptId','UPT-1',
   'fotoNameplate','https://warnoto.com/storage/v1/object/public/stock-photos/upt-1/KAT-1/tambahan-old.jpg',
   'fotoKeseluruhan','https://warnoto.com/storage/v1/object/public/stock-photos/upt-1/KAT-1/utama-old.jpg'), 1);
insert into storage.objects(bucket_id, name) values
 ('stock-photos','upt-1/KAT-1/tambahan-old.jpg'), ('stock-photos','upt-1/KAT-1/utama-old.jpg'),
 ('stock-photos','upt-1/KAT-1/tambahan-new.jpg');
create or replace function public.tug3_guard_legacy_stock_write() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and (new.data->'_tug3Applied' is distinct from old.data->'_tug3Applied'
    or old.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT'
       and (new.data->>'qty' is distinct from old.data->>'qty' or new.data->'sourceLot' is distinct from old.data->'sourceLot')) then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_tug3_guard_legacy_stock_write before update on public.stocks for each row execute function public.tug3_guard_legacy_stock_write();
`;

async function main() {
  await dockerRun(["run", "-d", "--rm", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16"]);
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { await dockerRun(["exec", container, "pg_isready", "-U", "postgres"]); break; }
      catch { if (attempt === 59) throw new Error("Scratch PostgreSQL did not become ready"); await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    await psql(bootstrap + migration);
    const actor = "00000000-0000-4000-8000-000000000001";
    const session = sql => `set local role authenticated; select set_config('request.jwt.claim.sub','${actor}',true); ${sql}`;
    const newUrl = "https://warnoto.com/storage/v1/object/public/stock-photos/upt-1/KAT-1/tambahan-new.jpg";
    await psql("begin;" + session(`select public.update_stock_photo('STK-TUG3-1','fotoNameplate','${newUrl}');`) + "commit;");
    assert.equal(await scalar("select data->>'fotoNameplate' from public.stocks where id='STK-TUG3-1';"), newUrl);
    assert.equal(await scalar("select data->>'qty' from public.stocks where id='STK-TUG3-1';"), "108");
    assert.equal(await scalar("select data->'sourceLot'->>'noKontrak' from public.stocks where id='STK-TUG3-1';"), "K-1");
    assert.equal(await scalar("select jsonb_array_length(data->'photoHistory') from public.stocks where id='STK-TUG3-1';"), "1");
    const stale = await scalar("begin;" + session("select public.update_stock_nameplate_ocr('STK-TUG3-1','https://warnoto.com/storage/v1/object/public/stock-photos/upt-1/KAT-1/tambahan-old.jpg','old');") + "commit;");
    assert.match(stale, /STALE_PHOTO/);
    const fresh = await scalar("begin;" + session(`select public.update_stock_nameplate_ocr('STK-TUG3-1','${newUrl}','fresh');`) + "commit;");
    assert.match(fresh, /"updated": true/);
    await expectSqlError(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true); select public.update_stock_photo('STK-TUG3-1','fotoNameplate','${newUrl}'); commit;`, "STOCK_PHOTO_SCOPE_DENIED");
    await expectSqlError(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${actor}',true); update public.stocks set data=jsonb_set(data,'{qty}','109') where id='STK-TUG3-1'; commit;`, "TUG3_STOCK_RPC_REQUIRED");
    console.log("stock photo RPC rehearsal passed: role/scope, object validation, history, OCR CAS, and TUG-3 guard");
  } finally {
    await dockerRun(["rm", "-f", container]).catch(() => {});
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
