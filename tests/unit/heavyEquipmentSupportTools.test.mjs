import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getHeavyEquipmentUptId,
  getHeavyEquipmentLoanOwnerUptId,
  getHeavyEquipmentBorrowerLabel,
  isHeavyEquipmentVisibleToUpt,
  normalizeHeavyEquipmentRecord,
} from "../../src/lib/heavyEquipment.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260920_heavy_equipment_upt_id_loans.sql"), "utf8");

test("support-tools migration exposes typed scope, private evidence, and batch RPCs", () => {
  assert.match(migration, /add column if not exists upt_id text/i);
  assert.match(migration, /owner_upt_id text/i);
  assert.match(migration, /foreign key \(upt_id\) references public\.upt\(id\)/i);
  assert.match(migration, /heavy-equipment-evidence/);
  assert.match(migration, /checkout_heavy_equipment_batch/);
  assert.match(migration, /approve_heavy_equipment_batch/);
  assert.match(migration, /complete_heavy_equipment_batch/);
  assert.match(migration, /grant execute on function public\.checkout_heavy_equipment_batch.*authenticated/is);
  assert.match(migration, /no authenticated direct\s+insert\/update\/delete policy/i);
  assert.match(migration, /drop policy if exists "Read heavy_equipment authenticated"/i);
  assert.match(migration, /drop policy if exists "Scoped write heavy_equipment"/i);
  assert.match(migration, /drop policy if exists "Scoped all heavy_equipment_loans"/i);
  assert.match(migration, /create policy "Heavy equipment evidence update"/i);
  assert.match(migration, /v_actor\.role <> 'TL'/i);
  assert.match(migration, /v_actor\.role <> 'ASMAN'/i);
  assert.match(migration, /revoke execute on function public\.complete_heavy_equipment_loan\(text\) from authenticated/i);
});

test("registry and visibility helpers prefer typed upt_id", () => {
  const uptList = [{ id: "UPT-SBY", nama: "UPT Surabaya" }, { id: "UPT-GSK", nama: "UPT Gresik" }];
  const item = normalizeHeavyEquipmentRecord({ id: "PB-SBY-01", uptId: "UPT-SBY", upt: "Gresik", kategori: "Pendukung" });
  assert.equal(getHeavyEquipmentUptId(item, uptList), "UPT-SBY");
  assert.equal(isHeavyEquipmentVisibleToUpt(item, "UPT-GSK", false), false);
  assert.equal(isHeavyEquipmentVisibleToUpt({ ...item, isCrossUptBorrowable: true }, "UPT-GSK", false), true);
  assert.equal(getHeavyEquipmentLoanOwnerUptId({ ownerUptId: "UPT-SBY", ownerUpt: "Gresik" }, uptList), "UPT-SBY");
});

test("external borrower label never falls back to an unrelated UPT", () => {
  assert.equal(getHeavyEquipmentBorrowerLabel({ borrowerType: "VENDOR", borrowerName: "PT Contoh" }), "VENDOR: PT Contoh");
  assert.equal(getHeavyEquipmentBorrowerLabel({ borrowerType: "UNIT_LAIN", borrowerName: "GI Sukolilo" }), "UNIT_LAIN: GI Sukolilo");
});
