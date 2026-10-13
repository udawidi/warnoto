import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../supabase/migrations/20261013_attb_unit_trace.sql", import.meta.url), "utf8");
const schema = await readFile(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const rehearsal = await readFile(new URL("../../scripts/rehearse_attb_unit_trace.mjs", import.meta.url), "utf8");

test("ATTB unit trace has scoped append-only tables and no legacy backfill", () => {
  for (const source of [migration, schema]) {
    assert.match(source, /create table if not exists public\.attb_public_links/);
    assert.match(source, /create table if not exists public\.attb_item_history/);
    assert.match(source, /public_token uuid[^\n]*not null/i);
    assert.match(source, /sourceTug10Key/);
    assert.match(source, /event_type text not null/);
    assert.match(source, /ATTB_PUBLIC_LINK_NOT_FOUND/);
    assert.match(source, /create unique index[^\n]*attb_public_links[^\n]*source/i);
    assert.match(source, /can_access_upt\(upt_id\)/);
    assert.match(source, /revoke all on (table )?public\.attb_item_history from public, anon, authenticated/i);
    assert.match(source, /revoke all on function public\.public_attb_material\(text, uuid\) from public, authenticated/i);
  }
  assert.match(rehearsal, /ATTB unit trace PostgreSQL rehearsal passed/);
  assert.match(rehearsal, /sourceItemIdx/);
});

test("ATTB final approval fails closed and creates one unit/token/history per ATTB item", () => {
  assert.match(migration, /TUG10_ATTB_QTY_INVALID/);
  assert.match(migration, /TUG10_ATTB_IDENTITY_REQUIRED/);
  assert.match(migration, /attb_public_links/);
  assert.match(migration, /attb_item_history/);
  assert.match(migration, /on conflict \(attb_id\) do nothing/i);
  assert.match(migration, /sourceTug10Key/);
  assert.match(migration, /select u\.data->>'nama'/);
});

test("public ATTB RPC is a token allowlist and keeps bearer token in capability lookup", () => {
  for (const source of [migration, schema]) {
    const start = source.indexOf("create or replace function public.public_attb_material");
    const end = source.indexOf("grant execute on function public.public_attb_material", start);
    const rpc = source.slice(start, end > start ? end : undefined);
    assert.match(rpc, /create or replace function public\.public_attb_material\(p_attb_id text, p_token uuid\)/);
    assert.match(rpc, /set search_path = pg_catalog/);
    assert.doesNotMatch(rpc, /set search_path = pg_catalog, public/);
    assert.match(rpc, /public_token is distinct from p_token/);
    assert.match(rpc, /jsonb_build_object\([\s\S]*trackingCode/);
    assert.match(source, /grant execute on function public\.public_attb_material\(text, uuid\) to anon/);
    assert.doesNotMatch(rpc, /'actorId'/);
    assert.doesNotMatch(rpc, /'raw'/i);
  }
});
