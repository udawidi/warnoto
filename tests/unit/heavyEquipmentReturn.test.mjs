import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canCompleteHeavyEquipmentLoan,
  normalizeHeavyEquipmentUptName,
} from "../../src/lib/heavyEquipment.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const uptList = [
  { id: "UPT-SBY", nama: "UPT Surabaya" },
  { id: "UPT-GSK", nama: "UPT Gresik" },
];

const ownerLoan = { id: "LOAN-1", equipmentId: "HE-1", ownerUpt: "Surabaya", requesterUpt: "Gresik", status: "DIPINJAM" };

test("owner return gate accepts only TL at the equipment owner UPT", () => {
  assert.equal(canCompleteHeavyEquipmentLoan({ role: "ADMIN", uptId: "UPT-SBY" }, ownerLoan, uptList), false);
  assert.equal(canCompleteHeavyEquipmentLoan({ role: "TL", upt: "UPT Surabaya" }, ownerLoan, uptList), true);
  assert.equal(canCompleteHeavyEquipmentLoan({ role: "TL", uptId: "UPT-SBY" }, { ...ownerLoan, ownerUptId: "UPT-SBY", status: "OVERDUE" }, uptList), true);
  assert.equal(canCompleteHeavyEquipmentLoan({ role: "ASMAN", uptId: "UPT-SBY" }, ownerLoan, uptList), false);
  assert.equal(canCompleteHeavyEquipmentLoan({ role: "ADMIN", uptId: "UPT-GSK" }, ownerLoan, uptList), false);
  assert.equal(canCompleteHeavyEquipmentLoan({ role: "SUPERADMIN", uptId: "UPT-SBY" }, ownerLoan, uptList), false);
});

test("owner return gate rejects terminal, pending, and malformed loans", () => {
  const owner = { role: "TL", uptId: "UPT-SBY" };
  for (const status of ["PENDING_OWNER_ASMAN", "TERJADWAL", "SELESAI", "REJECTED", ""]) {
    assert.equal(canCompleteHeavyEquipmentLoan(owner, { ...ownerLoan, status }, uptList), false, status);
  }
  assert.equal(canCompleteHeavyEquipmentLoan(owner, { ...ownerLoan, ownerUpt: "" }, uptList), false);
  assert.equal(canCompleteHeavyEquipmentLoan(owner, { ...ownerLoan, equipmentId: "" }, uptList), false);
});

test("UPT names normalize the legacy prefix and case", () => {
  assert.equal(normalizeHeavyEquipmentUptName(" UPT Surabaya "), "SURABAYA");
  assert.equal(normalizeHeavyEquipmentUptName("surabaya"), "SURABAYA");
});

test("return hook is server-first and exposes an atomic RPC", () => {
  const hook = fs.readFileSync(path.join(root, "src/hooks/useHeavyEquipment.js"), "utf8");
  const returnBlock = hook.slice(hook.indexOf("async function completeHeavyEquipmentLoan"));
  assert.match(hook, /rpc\("complete_heavy_equipment_batch"/);
  assert.match(returnBlock, /setHeavyEquipmentLoans\(prev/);
  assert.match(returnBlock, /returnEvidence/);
  assert.match(returnBlock, /onProgress\?\.\("Mengunggah bukti pengembalian/);
  assert.match(returnBlock, /_withTimeout\([\s\S]*?simpan pengembalian alat/);
  assert.match(returnBlock, /void supabaseClient\.storage/);
  assert.match(returnBlock, /catch \(rpcError\)/);
  assert.match(returnBlock, /return false/);
  assert.doesNotMatch(returnBlock, /saveToCloud/);
});

test("return evidence skips compression only for small JPEG data URLs", () => {
  const hook = fs.readFileSync(path.join(root, "src/hooks/useHeavyEquipment.js"), "utf8");
  assert.match(hook, /data:image\\\/jpeg;base64/);
  assert.match(hook, /RETURN_EVIDENCE_MAX_BYTES = 1_000_000/);
  assert.match(hook, /isSmallJpegDataUrl\(evidence\)/);
  assert.match(hook, /await compressImage\(evidence, \{ maxBytes: RETURN_EVIDENCE_MAX_BYTES \}\)/);
});

test("return migration locks both rows, authorizes owner, and grants only authenticated RPC access", () => {
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260919_heavy_equipment_loan_return_rpc.sql"), "utf8");
  assert.match(migration, /security definer/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /v_actor\.role not in \('ADMIN', 'TL'\)/i);
  assert.match(migration, /v_actor\.upt_id/i);
  assert.match(migration, /not in \('DIPINJAM', 'APPROVED', 'OVERDUE'\)/i);
  assert.match(migration, /status in \('DIPINJAM', 'APPROVED', 'OVERDUE'\)/i);
  assert.match(migration, /coalesce\(v_equipment\.upt, v_equipment\.data->>'upt'/i);
  assert.match(migration, /extract\(epoch from clock_timestamp\(\)\)/i);
  assert.match(migration, /jsonb_build_object\(\s*'loan'/i);
  assert.match(migration, /'equipment',\s*coalesce\(v_equipment\.data/i);
  assert.match(migration, /revoke all on function public\.complete_heavy_equipment_loan\(text\) from public/i);
  assert.match(migration, /grant execute on function public\.complete_heavy_equipment_loan\(text\) to authenticated/i);
});
