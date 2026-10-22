import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scanUrlFor } from "../../src/lib/utils.js";

test("material QR carries UPT and preserves legacy URL", () => {
  assert.match(scanUrlFor("KAT-PBG", "UPT-PBG"), /[?&]scan=KAT-PBG&upt=UPT-PBG$/);
  assert.match(scanUrlFor("KAT-OLD"), /[?&]scan=KAT-OLD$/);
  assert.doesNotMatch(scanUrlFor("KAT-OLD"), /[?&]upt=/);
});

test("public scan UI is dynamic and does not hardcode Surabaya", async () => {
  const source = await readFile(new URL("../../src/components/ScanPublicView.jsx", import.meta.url), "utf8");
  assert.match(source, /public_material_scan/);
  assert.match(source, /upt\?\.nama/);
  assert.match(source, /Lokasi belum diisi/);
  assert.doesNotMatch(source, /UPT SURABAYA|UPT Surabaya/);
});

test("public scan migration keeps RPC contract and fail-closed scope", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/20261022_public_material_scan.sql", import.meta.url), "utf8");
  for (const marker of ["returns jsonb", "stable security definer set search_path = pg_catalog", "SELECT_UPT", "INVALID_UPT", "revoke all on function public.public_material_scan", "grant execute on function public.public_material_scan(text, text) to anon, authenticated"]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(migration, /nullif\(s\.upt_id, ''\).*nullif\(g\.upt_id, ''\)/s);
  assert.match(migration, /join public\.lokasi l[\s\S]*join public\.gudang g[\s\S]*g\.upt_id = c\.upt_id/);
});
