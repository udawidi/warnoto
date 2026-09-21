import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeOpnamePhotos } from "../../src/lib/stockOpnamePhotoSecurity.js";

const hook = fs.readFileSync("src/hooks/useStockOpname.js", "utf8");
const photoHelper = fs.readFileSync("src/lib/stockOpnamePhotoSecurity.js", "utf8");
const tab = fs.readFileSync("src/components/StockOpnameTab.jsx", "utf8");
const policy = fs.readFileSync("supabase/migrations/20260919_stock_opname_photo_security.sql", "utf8");
const constraint = fs.readFileSync("supabase/migrations/20260919_stock_opname_photo_data_constraint.sql", "utf8");
const verifier = fs.readFileSync("supabase/verify_stock_opname_photo_security.sql", "utf8");
const backfill = fs.readFileSync("scripts/stock_opname_photo_backfill.mjs", "utf8");
const rpc = fs.readFileSync("supabase/migrations/20260919_stock_opname_asman_approval_rpc.sql", "utf8");
const rpcClient = fs.readFileSync("src/lib/stockOpnameApproval.js", "utf8");

test("Stock Opname normalizes data URLs with the session UPT", () => {
  assert.match(hook, /normalizeOpnamePhotos/);
  assert.match(photoHelper, /opn\?\.uptId \|\| opn\?\.upt_id/);
  assert.match(photoHelper, /uploadStockFoto\(katalogId, field, value, sessionUptId\)/);
  assert.match(hook, /saveToCloud\(\{opnameList: nl\}\)/);
  assert.match(tab, /handleOpnamePhoto/);
  assert.match(tab, /uploadStockFoto\(katalogId, field, dataUrl, sessionUptId\)/);
  assert.match(hook, /mergeOpnameForSave\(toSave, serverOpn, touchedLokasiIds\)/);
});

test("photo normalizer uses session UPT and replaces data URL", async () => {
  const calls = [];
  const draft = { id: "OPN-1", uptId: "UPT-SBY", items: [{ katalogId: "KAT-1", fotoKeseluruhan: "data:image/jpeg;base64,AAA" }] };
  const result = await normalizeOpnamePhotos(draft, async (...args) => {
    calls.push(args);
    return "https://warnoto.test/storage/stock-photos/upt-sby/utama.jpg";
  });
  assert.deepEqual(calls, [["KAT-1", "fotoKeseluruhan", "data:image/jpeg;base64,AAA", "UPT-SBY"]]);
  assert.equal(result.items[0].fotoKeseluruhan, "https://warnoto.test/storage/stock-photos/upt-sby/utama.jpg");
  assert.equal(draft.items[0].fotoKeseluruhan, "data:image/jpeg;base64,AAA");
});

test("photo normalizer rejects upload failure and leaves data URL untouched", async () => {
  const draft = { id: "OPN-1", upt_id: "UPT-SBY", items: [{ katalogId: "KAT-1", fotoNameplate: "data:image/jpeg;base64,BBB" }] };
  await assert.rejects(
    () => normalizeOpnamePhotos(draft, async () => { throw new Error("storage down"); }),
    /storage down/
  );
  assert.match(draft.items[0].fotoNameplate, /^data:/);
});

test("Stock Opname transitions rollback on cloud failure", () => {
  assert.match(hook, /if \(saved === false\) \{/);
  assert.match(hook, /Status tetap Draft/);
  assert.match(hook, /Status tetap menunggu Asman/);
  assert.match(hook, /failClosed = false/);
  assert.match(hook, /forceMerge: true, failClosed: true/);
  assert.doesNotMatch(hook, /catch \(e\) \{ console\.warn\("Upload foto opname gagal"/);
  assert.match(tab, /if \(saved === false\) \{ setActiveOpname\(next\); return; \}/);
});

test("Asman approval uses the transactional RPC without unsafe fallback", () => {
  assert.match(rpcClient, /rpc\("approve_stock_opname_asman"/);
  assert.match(hook, /approveStockOpnameAtomically/);
  assert.match(hook, /changedKatalogRows/);
  assert.match(hook, /changedStockRows/);
  assert.match(hook, /rpcStockRows = changedStockRows\.map/);
  assert.doesNotMatch(hook, /saveToCloud\(\{opnameList: nl, stocks: newStocks, katalogList: newKatalogList\}\)/);
  assert.match(rpc, /security definer/);
  assert.match(rpc, /set search_path = public, pg_temp/);
  assert.match(rpc, /v_profile_role not in \('ASMAN', 'SUPERADMIN'\)/);
  assert.match(rpc, /public\.can_access_upt\(v_upt_id\)/);
  assert.match(rpc, /v_opname\.status <> 'PENDING_ASMAN'/);
  assert.match(rpc, /insert into public\.katalog/);
  assert.match(rpc, /insert into public\.stocks/);
  assert.match(rpc, /update public\.stock_opname/);
  assert.ok(rpc.indexOf("insert into public.katalog") < rpc.indexOf("insert into public.stocks"));
  assert.ok(rpc.indexOf("insert into public.stocks") < rpc.indexOf("update public.stock_opname"));
  assert.match(rpc, /OPNAME_APPROVAL_PHOTO_NOT_NORMALIZED/);
  assert.match(rpc, /OPNAME_APPROVAL_LOCATION_SCOPE_DENIED/);
  assert.match(rpc, /OPNAME_APPROVAL_NEW_STOCK_UPT_REQUIRED/);
  assert.match(rpc, /jsonb_set\(v_row, '\{uptId\}'/);
  assert.match(hook, /materialBaruKatalogByCode/);
  assert.match(hook, /items: approvedItems/);
  assert.match(hook, /uptId: sessionUptId/);
});

test("Storage policy is UPT scoped and QR public read is preserved", () => {
  assert.match(policy, /public\.can_access_upt/);
  assert.match(policy, /exists \([\s\S]*from public\.upt u[\s\S]*public\.can_access_upt\(u\.id\)/);
  assert.doesNotMatch(policy, /public\.can_access_upt\(\(\s*select/);
  assert.match(policy, /p\.role in \('ADMIN', 'TL', 'ASMAN', 'SUPERADMIN'\)/);
  assert.match(policy, /for update to authenticated[\s\S]*using[\s\S]*with check/);
  assert.match(policy, /Public-read is intentionally unchanged/);
  assert.match(constraint, /stock_opname_has_photo_data_url/);
  assert.match(constraint, /fotoKeseluruhan/);
  assert.match(constraint, /fotoNameplate/);
  assert.doesNotMatch(constraint, /data::text like '%data:%'/);
  assert.match(constraint, /legacy_count > 0/);
  assert.match(constraint, /stock_opname_data_no_photo_data_url/);
  assert.match(verifier, /fotoKeseluruhan/);
  assert.match(verifier, /fotoNameplate/);
  assert.doesNotMatch(verifier, /data::text like '%data:%'/);
  assert.match(backfill, /\["fotoKeseluruhan", "fotoNameplate"\]/);
  assert.match(backfill, /order\("id", \{ ascending: true \}\)/);
  assert.match(backfill, /\.gt\("id", lastId\)/);
  assert.match(backfill, /limit\(PAGE_SIZE\)/);
  assert.match(backfill, /const next = walk\(row\.data/);
  assert.match(backfill, /path\[path\.length - 3\] === "items"/);
});
