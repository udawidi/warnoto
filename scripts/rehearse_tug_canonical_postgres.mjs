import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260729_tug_canonical_approval.sql"), "utf8");
const stockWitnessMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261021_tug3_guard_canonical_stock_witness.sql"), "utf8");
const docker = process.env.TUG_REHEARSAL_DOCKER || "docker";
const dockerHost = process.env.TUG_REHEARSAL_DOCKER_HOST || "";
const postgresImage = process.env.TUG_REHEARSAL_POSTGRES_IMAGE || "postgres:17-alpine";
const container = `warnoto-tug-rehearsal-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const postgresPassword = crypto.randomBytes(16).toString("hex");
const ids = {
  adminA: "00000000-0000-4000-8000-000000000001",
  tlA: "00000000-0000-4000-8000-000000000002",
  asmanA: "00000000-0000-4000-8000-000000000003",
  adminB: "00000000-0000-4000-8000-000000000004",
  tlB: "00000000-0000-4000-8000-000000000005",
};

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => reject(error));
    child.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr}\n${stdout}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function runDocker(args, input) {
  return dockerHost
    ? run("ssh", [dockerHost, docker, ...args], input)
    : run(docker, args, input);
}

async function psql(sql) {
  return (await runDocker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-U", "postgres", "-d", "postgres"], sql)).stdout;
}

function sqlJson(value) {
  return `$json$${JSON.stringify(value)}$json$::jsonb`;
}

async function expectSqlError(sql, expected) {
  await assert.rejects(() => psql(sql), error => error.message.includes(expected));
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
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
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'authenticated')
$$;
create role anon;
create role authenticated;
create table public.profiles (
  id uuid primary key,
  name text not null,
  role text not null,
  upt_id text,
  created_at timestamptz not null default now()
);
create table public.katalog (id text primary key);
create table public.gudang (id text primary key, upt_id text not null);
create table public.lokasi (id text primary key, gudang_id text not null references public.gudang(id));
create table public.stocks (
  id text primary key,
  katalog_id text,
  lokasi_id text,
  data jsonb not null default '{}'::jsonb,
  created_at bigint not null default 0
);
insert into public.profiles(id,name,role,upt_id) values
  ('${ids.adminA}','Admin A','ADMIN','UPT-A'),
  ('${ids.tlA}','TL A','TL','UPT-A'),
  ('${ids.asmanA}','Asman A','ASMAN','UPT-A'),
  ('${ids.adminB}','Admin B','ADMIN','UPT-B'),
  ('${ids.tlB}','TL B','TL','UPT-B');
insert into public.gudang(id,upt_id) values ('GD-A','UPT-A'),('GD-B','UPT-B');
insert into public.lokasi(id,gudang_id) values ('LOC-A','GD-A'),('LOC-B','GD-B');
insert into public.katalog(id) values ('KAT-A'),('KAT-B');
insert into public.stocks(id,katalog_id,lokasi_id,data) values
  ('STK-A','KAT-A','LOC-A','{"qty":10,"sourceLot":{"kind":"TUG3_CONTRACT"}}'::jsonb),
  ('STK-B','KAT-B','LOC-B','{"qty":10}'::jsonb),
  ('STK-C','KAT-A','LOC-A','{"qty":5,"sourceLot":{"kind":"TUG3_CONTRACT"}}'::jsonb);
`;

const legacyStockGuard = `
create or replace function public.tug3_guard_legacy_stock_write()
returns trigger language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on'
     or coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.data ? '_tug3Applied' or new.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT') then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
       new.data->'_tug3Applied' is distinct from old.data->'_tug3Applied'
       or old.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT'
          and (new.data->>'qty' is distinct from old.data->>'qty'
            or new.data->'sourceLot' is distinct from old.data->'sourceLot')
     ) then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_tug3_guard_legacy_stock_write
before insert or update on public.stocks
for each row execute function public.tug3_guard_legacy_stock_write();
`;

async function main() {
  let started = false;
  try {
    await runDocker(["version", "--format", "{{.Server.Version}}"]);
    await runDocker(["run", "--rm", "-d", "--name", container, "-e", `POSTGRES_PASSWORD=${postgresPassword}`, postgresImage]);
    started = true;
    await waitForPostgres();
    await psql(bootstrap);
    await psql(migration);
    await psql(legacyStockGuard);
    await psql(stockWitnessMigration);
    await psql("insert into public.tug_global_document_counters(upt_id,document_unit_code,last_value) values ('UPT-A','UPTA',0),('UPT-B','UPTB',0);");

    const setupAndFlow = `
select set_config('request.jwt.claim.sub','${ids.adminA}',false);
do $$
declare r jsonb; tx uuid; review jsonb; stale_token uuid; fresh_token uuid; too_large uuid; bad_review jsonb;
begin
  -- Canonical creation is closed to other document types; baseline keeps them.
  begin
    perform public.tug_create_transaction('{"docType":"TUG3","uptId":"UPT-A"}'::jsonb, '[{"stockId":"STK-A","qty":1}]'::jsonb, '10000000-0000-4000-8000-000000000001');
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_CANONICAL_DOC_TYPE_FORBIDDEN' then raise; end if; end;
  begin
    perform public.tug_create_transaction('{"docType":"TUG8","uptId":"UPT-A"}'::jsonb, null, '10000000-0000-4000-8000-000000000002');
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_ITEMS_REQUIRED' then raise; end if; end;
  begin
    perform public.tug_create_transaction('{"docType":"TUG8","uptId":"UPT-A"}'::jsonb, '[{"stockId":"STK-A","qty":"bad"}]'::jsonb, '10000000-0000-4000-8000-000000000003');
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_ITEMS_INVALID' then raise; end if; end;
  begin
    perform public.tug_create_transaction('{"docType":"TUG8","uptId":"UPT-A"}'::jsonb, '[{"stockId":"STK-A","katalogId":"KAT-B","qty":1}]'::jsonb, '10000000-0000-4000-8000-000000000004');
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_ITEM_REFERENCE_MISMATCH' then raise; end if; end;
  begin
    perform public.tug_create_transaction('{"docType":"TUG8","uptId":"UPT-A"}'::jsonb, '[{"stockId":"STK-A","lokasiId":"LOC-B","qty":1}]'::jsonb, '10000000-0000-4000-8000-000000000005');
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_ITEM_REFERENCE_MISMATCH' then raise; end if; end;
  if (select last_value from public.tug_global_document_counters where upt_id='UPT-A') <> 0
     or (select (data->>'qty')::numeric from public.stocks where id='STK-A') <> 10
     or exists (select 1 from public.stock_movements) then raise exception 'reference mismatch changed stock or counter'; end if;
  perform public.tug_import_legacy_baseline('legacy-tug3','{"docType":"TUG3","uptId":"UPT-A","docNumber":"LEGACY-3"}'::jsonb,'[{"qty":1}]'::jsonb);
  if (select count(*) from public.stock_movements) <> 0 then raise exception 'legacy changed stock'; end if;

  r := public.tug_create_transaction('{"docType":"TUG8","uptId":"UPT-A"}'::jsonb, '[{"stockId":"STK-A","qty":2}]'::jsonb, '20000000-0000-4000-8000-000000000001');
  tx := (r->>'id')::uuid;
  if not exists (
    select 1 from public.tug_items
    where transaction_id=tx and stock_id='STK-A' and katalog_id='KAT-A' and lokasi_id='LOC-A'
      and snapshot->>'stockId'='STK-A' and snapshot->>'katalogId'='KAT-A' and snapshot->>'lokasiId'='LOC-A'
  ) then raise exception 'canonical item references were not server-derived'; end if;
  if public.tug_create_transaction('{"docType":"TUG8","uptId":"UPT-A"}'::jsonb, '[{"stockId":"STK-A","qty":2}]'::jsonb, '20000000-0000-4000-8000-000000000001') <> r then
    raise exception 'serial idempotency failed';
  end if;
  begin
    perform public.tug_create_transaction('{"docType":"TUG8","uptId":"UPT-A"}'::jsonb, '[{"stockId":"STK-A","qty":3}]'::jsonb, '20000000-0000-4000-8000-000000000001');
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_IDEMPOTENCY_REUSE_FORBIDDEN' then raise; end if; end;
  begin
    perform public.tug_submit_transaction(tx,1,'20000000-0000-4000-8000-000000000001');
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_IDEMPOTENCY_REUSE_FORBIDDEN' then raise; end if; end;
  perform public.tug_submit_transaction(tx,1,'20000000-0000-4000-8000-000000000002');
end $$;

select set_config('request.jwt.claim.sub','${ids.adminB}',false);
do $$ begin
  begin
    perform public.tug_create_transaction('{"docType":"TUG8","uptId":"UPT-B"}'::jsonb, '[{"stockId":"STK-B","qty":1}]'::jsonb, '20000000-0000-4000-8000-000000000001');
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_IDEMPOTENCY_REUSE_FORBIDDEN' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub','${ids.tlB}',false);
do $$ declare tx uuid; begin
  select id into tx from public.tug_transactions where legacy_id is null and doc_number not like 'LEGACY%';
  begin
    perform public.tug_prepare_review(tx,2);
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_UPT_SCOPE_FORBIDDEN' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub','${ids.tlA}',false);
do $$ declare tx uuid; begin
  select id into tx from public.tug_transactions where legacy_id is null and doc_number not like 'LEGACY%';
  perform public.tug_decide(tx,2,'APPROVE',null,null,'20000000-0000-4000-8000-000000000003',null);
  if not exists (select 1 from public.tug_transactions where id=tx and status='PENDING' and stage='PENDING_ASMAN' and version=3) then raise exception 'TL did not hand off to Asman'; end if;
  if not exists (select 1 from public.tug_approvals where transaction_id=tx and decision='APPROVE' and stage='PENDING_TL') then raise exception 'approval stage was not preserved'; end if;
end $$;

select set_config('request.jwt.claim.sub','${ids.asmanA}',false);
do $$ declare tx uuid; review jsonb; stale_token uuid; fresh_token uuid; r jsonb; begin
  select id into tx from public.tug_transactions where legacy_id is null and doc_number not like 'LEGACY%';
  review := public.tug_prepare_review(tx,3);
  stale_token := (review->>'reviewToken')::uuid;
  update public.stocks set katalog_id='KAT-B' where id='STK-A';
  begin
    perform public.tug_decide(tx,3,'APPROVE',stale_token,null,'20000000-0000-4000-8000-000000000004','{"items":true,"parties":true,"document":true,"impact":true}'::jsonb);
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG_REVIEW_STALE' then raise; end if; end;
  if exists (select 1 from public.tug_review_tokens where token=stale_token and consumed_at is not null)
     or exists (select 1 from public.stock_movements where transaction_id=tx)
     or (select data->>'qty' from public.stocks where id='STK-A') <> '10' then raise exception 'stale review was not atomic'; end if;
  update public.stocks set katalog_id='KAT-A' where id='STK-A';
  review := public.tug_prepare_review(tx,3);
  fresh_token := (review->>'reviewToken')::uuid;
  r := public.tug_decide(tx,3,'APPROVE',fresh_token,null,'20000000-0000-4000-8000-000000000005','{"items":true,"parties":true,"document":true,"impact":true}'::jsonb);
  if r->>'status' <> 'FINAL_APPROVED' or (select (data->>'qty')::numeric from public.stocks where id='STK-A') <> 8
     or (select count(*) from public.stock_movements where transaction_id=tx) <> 1 then raise exception 'final stock movement failed'; end if;
  if not exists (select 1 from public.tug_approvals where transaction_id=tx and decision='APPROVE' and stage='PENDING_ASMAN') then raise exception 'final approval stage was not preserved'; end if;
end $$;

select set_config('request.jwt.claim.sub','${ids.adminA}',false);
do $$ declare r jsonb; tx uuid; begin
  begin
    update public.stocks
    set data=jsonb_set(data,'{qty}',to_jsonb(4::numeric),true)
    where id='STK-C';
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG3_STOCK_RPC_REQUIRED' then raise; end if; end;
  if (select (data->>'qty')::numeric from public.stocks where id='STK-C') <> 5 then
    raise exception 'direct TUG-3 lot write changed stock';
  end if;
  r := public.tug_create_transaction(
    '{"docType":"TUG9","uptId":"UPT-A","rehearsal":"tug3-witness"}'::jsonb,
    '[{"stockId":"STK-C","qty":2}]'::jsonb,
    '30000000-0000-4000-8000-000000000001'
  );
  tx := (r->>'id')::uuid;
  perform public.tug_submit_transaction(tx,1,'30000000-0000-4000-8000-000000000002');
end $$;
select set_config('request.jwt.claim.sub','${ids.tlA}',false);
do $$ declare tx uuid; begin
  select id into tx from public.tug_transactions where document->>'rehearsal'='tug3-witness';
  perform public.tug_decide(tx,2,'APPROVE',null,null,'30000000-0000-4000-8000-000000000003',null);
end $$;
select set_config('request.jwt.claim.sub','${ids.asmanA}',false);
do $$ declare tx uuid; review jsonb; r jsonb; begin
  select id into tx from public.tug_transactions where document->>'rehearsal'='tug3-witness';
  review := public.tug_prepare_review(tx,3);
  r := public.tug_decide(tx,3,'APPROVE',(review->>'reviewToken')::uuid,null,'30000000-0000-4000-8000-000000000004','{"items":true,"parties":true,"document":true,"impact":true}'::jsonb);
  if r->>'status' <> 'FINAL_APPROVED'
     or (select (data->>'qty')::numeric from public.stocks where id='STK-C') <> 3
     or (select count(*) from public.stock_movements where transaction_id=tx) <> 1
     or not exists (select 1 from public.stock_movements where transaction_id=tx and xact_id is not null) then
    raise exception 'TUG-9 TUG-3 witness approval failed';
  end if;
end $$;

do $$ begin
  begin
    update public.stocks
    set data=jsonb_set(data,'{qty}',to_jsonb(2::numeric),true)
    where id='STK-C';
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm <> 'TUG3_STOCK_RPC_REQUIRED' then raise; end if; end;
  if (select (data->>'qty')::numeric from public.stocks where id='STK-C') <> 3
     or (select count(*) from public.stock_movements where stock_id='STK-C') <> 1 then
    raise exception 'post-approval direct provenance write changed stock';
  end if;
end $$;

select set_config('request.jwt.claim.sub','${ids.adminA}',false);
do $$ declare r jsonb; tx uuid; review jsonb; begin
  r := public.tug_create_transaction('{"docType":"TUG9","uptId":"UPT-A","rehearsal":"insufficient"}'::jsonb, '[{"stockId":"STK-A","qty":20}]'::jsonb, '31000000-0000-4000-8000-000000000001');
  tx := (r->>'id')::uuid;
  perform public.tug_submit_transaction(tx,1,'31000000-0000-4000-8000-000000000002');
end $$;
select set_config('request.jwt.claim.sub','${ids.tlA}',false);
do $$ declare tx uuid; begin select id into tx from public.tug_transactions where document->>'rehearsal'='insufficient'; perform public.tug_decide(tx,2,'APPROVE',null,null,'31000000-0000-4000-8000-000000000003',null); end $$;
select set_config('request.jwt.claim.sub','${ids.asmanA}',false);
do $$ declare tx uuid; review jsonb; begin
  select id into tx from public.tug_transactions where document->>'rehearsal'='insufficient'; review := public.tug_prepare_review(tx,3);
  begin
    perform public.tug_decide(tx,3,'APPROVE',(review->>'reviewToken')::uuid,null,'31000000-0000-4000-8000-000000000004','{"items":true,"parties":true,"document":true,"impact":true}'::jsonb);
    raise exception 'TUG_TEST_EXPECTED_ERROR_NOT_RAISED';
  exception when others then if sqlerrm not like 'TUG_INSUFFICIENT_STOCK%' then raise; end if; end;
  if (select (data->>'qty')::numeric from public.stocks where id='STK-A') <> 8
     or exists (select 1 from public.stock_movements where transaction_id=tx)
     or exists (select 1 from public.tug_review_tokens where transaction_id=tx and consumed_at is not null) then raise exception 'insufficient stock was not atomic'; end if;
end $$;

do $$ begin
  if has_function_privilege('anon','public.tug_actor()','EXECUTE')
     or has_function_privilege('authenticated','public.tug_actor()','EXECUTE')
     or has_function_privilege('anon','public.tug_create_transaction(jsonb,jsonb,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.tug_create_transaction(jsonb,jsonb,uuid)','EXECUTE') then
    raise exception 'TUG function grants are unsafe';
  end if;
end $$;
`;
    await psql(setupAndFlow);

    const concurrencyKey = "40000000-0000-4000-8000-000000000001";
    const concurrencySql = `select set_config('request.jwt.claim.sub','${ids.adminA}',false); select public.tug_create_transaction(${sqlJson({ docType: "TUG8", uptId: "UPT-A", rehearsal: "parallel" })},${sqlJson([{ stockId: "STK-A", qty: 1 }])},'${concurrencyKey}'::uuid);`;
    const [first, second] = await Promise.all([psql(concurrencySql), psql(concurrencySql)]);
    const response = output => output.trim().split(/\r?\n/).at(-1);
    assert.equal(response(first), response(second), "parallel same-key calls must return the same response");
    assert.equal((await psql("select count(*) from public.tug_transactions where document->>'rehearsal'='parallel';")).trim(), "1");

    console.log("TUG canonical PostgreSQL rehearsal passed: security, idempotency, stale review, cross-UPT, TL-to-Asman, TUG-3 lot witness, and stock atomicity.");
  } finally {
    if (started) await runDocker(["rm", "-f", container]).catch(() => {});
  }
}

await main();
