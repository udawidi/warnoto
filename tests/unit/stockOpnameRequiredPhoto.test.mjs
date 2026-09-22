import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeOpnamePhotos } from "../../src/lib/stockOpnamePhotoSecurity.js";

const fieldMode = fs.readFileSync("src/components/OpnameLapanganView.jsx", "utf8");
const tab = fs.readFileSync("src/components/StockOpnameTab.jsx", "utf8");
const hook = fs.readFileSync("src/hooks/useStockOpname.js", "utf8");
const helper = fs.readFileSync("src/lib/stockOpnamePhotoSecurity.js", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260922_stock_opname_optional_photo.sql", "utf8");
const constraint = fs.readFileSync("supabase/migrations/20260919_stock_opname_photo_data_constraint.sql", "utf8");
const rpc = fs.readFileSync("supabase/migrations/20260919_stock_opname_asman_approval_rpc.sql", "utf8");
const card = fs.readFileSync("src/components/KartuGantungModal.jsx", "utf8");
const docs = fs.readFileSync("src/lib/docBuilders.js", "utf8");

test("empty Stock Opname photos are optional", () => {
  assert.doesNotMatch(fieldMode, /Foto Keseluruhan wajib diunggah/);
  assert.doesNotMatch(tab, /Foto Keseluruhan wajib diunggah/);
  assert.doesNotMatch(hook, /missingRequiredOpnamePhotos/);
  assert.doesNotMatch(helper, /missingRequiredOpnamePhotos|isValidOpnamePhotoUrl/);
  assert.match(fieldMode, /Foto Stock Opname .*opsional/);
  assert.match(tab, /Foto Keseluruhan \(opsional\)/);
});

test("supplied photos still normalize before persistence", async () => {
  const calls = [];
  const draft = { id: "OPN-1", uptId: "UPT-SBY", items: [{ katalogId: "KAT-1", qtsFisik: 2, fotoKeseluruhan: "data:image/jpeg;base64,AAA" }] };
  const result = await normalizeOpnamePhotos(draft, async (...args) => {
    calls.push(args);
    return "https://warnoto.com/storage/v1/object/public/stock-photos/UPT-SBY/KAT-1/utama.jpg";
  });
  assert.deepEqual(calls, [["KAT-1", "fotoKeseluruhan", "data:image/jpeg;base64,AAA", "UPT-SBY"]]);
  assert.match(result.items[0].fotoKeseluruhan, /stock-photos/);
  assert.match(hook, /normalizeOpnamePhotos\(opn, uploadStockFoto\)/);
  assert.match(hook, /fotoByStockId\[photoTarget\]/);
  assert.match(card, /Telah dilakukan Stock Opname pada tanggal/);
  assert.match(docs, /Telah dilakukan Stock Opname pada tanggal/);
});

test("data URLs and upload failures remain fail-closed", async () => {
  const draft = { id: "OPN-1", upt_id: "UPT-SBY", items: [{ katalogId: "KAT-1", fotoNameplate: "data:image/jpeg;base64,BBB" }] };
  await assert.rejects(
    () => normalizeOpnamePhotos(draft, async () => { throw new Error("storage down"); }),
    /storage down/
  );
  assert.match(draft.items[0].fotoNameplate, /^data:/);
  assert.match(constraint, /stock_opname_data_no_photo_data_url/);
  assert.match(constraint, /stock_opname_has_photo_data_url/);
});

test("forward migration drops only the retired required-photo trigger", () => {
  assert.match(migration, /begin;/i);
  assert.match(migration, /drop trigger if exists stock_opname_required_photo_guard on public\.stock_opname;/i);
  assert.match(migration, /commit;/i);
  assert.doesNotMatch(migration, /drop function|drop table|alter table/i);
  assert.match(rpc, /approve_stock_opname_asman/);
  assert.match(rpc, /security definer/);
});

test("SAP submit remains independent of optional Non-SAP child", () => {
  assert.match(tab, /Non-SAP \(opsional\)/);
  assert.match(tab, /tidak wajib untuk submit SAP/);
  assert.match(tab, /Input Non-SAP \(opsional\)/);
  assert.match(tab, /openOrCreateNonSapChild\(activeOpname\)/);
  const submitStart = hook.indexOf("async function submitOpname");
  const approveStart = hook.indexOf("async function approveOpname_Asman");
  assert.ok(submitStart >= 0 && approveStart > submitStart, "submitOpname slice exists");
  const submitSource = hook.slice(submitStart, approveStart);
  assert.match(submitSource, /status:"PENDING_ASMAN"/);
  assert.doesNotMatch(submitSource, /childOpnameMatches|openOrCreateNonSapChild|NON_SAP/);
  const submitCallIndex = tab.indexOf("submitOpname(activeOpname");
  assert.ok(submitCallIndex >= 0, "Submit ke Asman calls submitOpname directly");
  const submitBranchStart = tab.lastIndexOf('activeOpname.stage==="REKONSILIASI"', submitCallIndex);
  const submitBranch = tab.slice(Math.max(0, submitBranchStart), submitCallIndex + 200);
  assert.doesNotMatch(submitBranch, /openOrCreateNonSapChild/);
});
