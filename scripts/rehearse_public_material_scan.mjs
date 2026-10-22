import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const docker = process.env.PUBLIC_SCAN_REHEARSAL_DOCKER || "docker";
const container = process.env.PUBLIC_SCAN_REHEARSAL_CONTAINER || `warnoto-public-scan-${process.pid}`;
const migration = await readFile(new URL("../supabase/migrations/20261022_public_material_scan.sql", import.meta.url), "utf8");

function run(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(docker, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${docker} ${args.join(" ")} exited ${code}: ${stderr}`)));
    child.stdin.end(input);
  });
}

async function psql(sql) {
  return (await run(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-U", "postgres", "-d", "postgres"], sql)).stdout.trim();
}

const bootstrap = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create table public.katalog(id text primary key, data jsonb not null);
create table public.upt(id text primary key, data jsonb not null);
create table public.gudang(id text primary key, upt_id text, data jsonb not null);
create table public.sub_gudang(id text primary key, gudang_id text, data jsonb not null);
create table public.lokasi(id text primary key, gudang_id text, data jsonb not null);
create table public.stocks(id text primary key, katalog_id text, lokasi_id text, upt_id text, data jsonb not null);
create table public.tug15_history(id bigint primary key, katalog_id text, tanggal date not null, jenis_transaksi text not null, qty numeric not null, lokasi_id text, lokasi_kode text, doc_type text, no_bon text, catatan text);
`;

try {
  await run(["run", "-d", "--rm", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16"]);
  for (let i = 0; i < 30; i++) {
    try { await run(["exec", container, "pg_isready", "-U", "postgres"]); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  await psql(bootstrap + migration);
  await psql(migration);
  await psql(`
    insert into public.katalog values ('KAT-SHARED', '{"katalog":"123","name":"Material shared","satuan":"BH"}'), ('KAT-ZERO', '{"katalog":"456","name":"Material zero","satuan":"BH"}'), ('KAT-ONLY', '{"katalog":"789","name":"Material one UPT","satuan":"BH"}');
    insert into public.upt values ('UPT-SBY', '{"nama":"UPT Surabaya"}'), ('UPT-PBG', '{"nama":"UPT Probolinggo"}');
    insert into public.gudang values ('G-SBY', 'UPT-SBY', '{"nama":"Gudang Surabaya"}'), ('G-PBG', 'UPT-PBG', '{"nama":"Gudang Probolinggo"}');
    insert into public.lokasi values ('L-SBY', 'G-SBY', '{"kode":"SBY-01","subGudangId":"SG-SBY"}'), ('L-PBG', 'G-PBG', '{"kode":"PBG-02","subGudangId":"SG-WRONG"}');
    insert into public.sub_gudang values ('SG-SBY', 'G-SBY', '{"nama":"Sub SBY"}'), ('SG-PBG', 'G-PBG', '{"nama":"Sub PBG"}'), ('SG-WRONG', 'G-SBY', '{"nama":"Sub Gudang UPT lain"}');
    insert into public.stocks values ('S-SBY', 'KAT-SHARED', 'L-SBY', 'UPT-SBY', '{"qty":4}'), ('S-PBG', 'KAT-SHARED', 'L-PBG', 'UPT-PBG', '{"qty":3}'), ('S-PBG-ZERO', 'KAT-ZERO', 'L-PBG', 'UPT-PBG', '{"qty":0}'), ('S-ONLY', 'KAT-ONLY', 'L-PBG', 'UPT-PBG', '{"qty":5}'), ('S-CONFLICT', 'KAT-SHARED', 'L-PBG', 'UPT-SBY', '{"qty":99}');
    insert into public.tug15_history values (1, 'KAT-SHARED', '2026-10-01', 'MASUK', 4, 'L-SBY', 'SBY-01', 'TUG3', 'SBY-1', null), (2, 'KAT-SHARED', '2026-10-02', 'MASUK', 2, 'L-PBG', 'PBG-02', 'TUG3', 'PBG-1', null), (3, 'KAT-SHARED', '2026-10-03', 'MASUK', 9, null, null, 'TUG3', 'UNKNOWN', null);
  `);
  const pbg = JSON.parse(await psql("select public.public_material_scan('KAT-SHARED','UPT-PBG');"));
  assert.equal(pbg.status, "READY");
  assert.equal(pbg.upt.id, "UPT-PBG");
  assert.equal(Number(pbg.qty), 3);
  assert.equal(pbg.locations.length, 1);
  assert.equal(pbg.locations[0].blok, "PBG-02");
  assert.equal(pbg.locations[0].subGudang, "");
  assert.equal(pbg.history.length, 1);
  const zero = JSON.parse(await psql("select public.public_material_scan('KAT-ZERO','UPT-PBG');"));
  assert.equal(zero.status, "READY");
  assert.equal(Number(zero.qty), 0);
  assert.equal(zero.locations.length, 0);
  const legacy = JSON.parse(await psql("select public.public_material_scan('KAT-SHARED',null);"));
  assert.equal(legacy.status, "SELECT_UPT");
  assert.equal(legacy.uptOptions.length, 2);
  const invalid = JSON.parse(await psql("select public.public_material_scan('KAT-SHARED','UPT-NOPE');"));
  assert.equal(invalid.status, "INVALID_UPT");
  const single = JSON.parse(await psql("select public.public_material_scan('KAT-ONLY',null);"));
  assert.equal(single.status, "READY");
  assert.equal(single.upt.id, "UPT-PBG");
  console.log("public material scan rehearsal passed: shared, qty-zero, location, conflict, history, legacy picker, single UPT, invalid UPT");
} finally {
  await run(["rm", "-f", container]).catch(() => {});
}
