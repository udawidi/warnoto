import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeHeavyEquipmentRecord,
  normalizeHeavyEquipmentLoan,
  heavyEquipmentQuantityBalance,
  getHeavyEquipmentLoanRemainingQuantity,
} from "../../src/lib/heavyEquipment.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260920b_heavy_equipment_quantity_pools.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");

test("quantity-pool migration exposes immutable typed quantities and atomic RPCs", () => {
  assert.match(migration, /tracking_mode\s+text/i);
  assert.match(migration, /quantity_total\s+integer/i);
  assert.match(migration, /quantity_borrowed\s+integer/i);
  assert.match(migration, /quantity_returned_good\s+integer/i);
  assert.match(migration, /quantity_returned_damaged\s+integer/i);
  assert.match(migration, /quantity_returned_lost\s+integer/i);
  assert.match(migration, /before update/i);
  assert.match(migration, /checkout_heavy_equipment_batch_v2/i);
  assert.match(migration, /complete_heavy_equipment_quantity_loan/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /returnEvents/i);
  assert.match(migration, /grant execute on function public\.checkout_heavy_equipment_batch_v2.*authenticated/is);
  assert.match(migration, /grant execute on function public\.complete_heavy_equipment_quantity_loan.*authenticated/is);
  assert.match(migration, /jsonb_array_elements/i);
  assert.match(migration, /Referenced evidence is immutable/i);
  assert.match(migration, /not exists \(select 1 from public\.heavy_equipment_loans l where \(\s*l\.data->>'pickupEvidencePath'/is);
  assert.match(migration, /jsonb_array_elements\(coalesce\(l\.data->'returnEvents'/i);
  assert.match(migration, /order by e\.id for update/i);
  assert.match(migration, /status in \('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE'\)/i);
  assert.match(schema, /checkout_heavy_equipment_batch_v2/i);
  assert.match(schema, /complete_heavy_equipment_quantity_loan/i);
  assert.ok(schema.includes(migration.trim()), "canonical schema must mirror the quantity-pool migration exactly");
});

test("quantity normalizers preserve UNIT compatibility and expose pool balance", () => {
  const unit = normalizeHeavyEquipmentRecord({ id: "HE-1", nama: "Crane" });
  assert.equal(unit.trackingMode, "UNIT");
  assert.equal(unit.quantityTotal, 1);

  const pool = normalizeHeavyEquipmentRecord({ id: "PB-1", trackingMode: "QUANTITY", quantityTotal: 40 });
  const loans = [
    normalizeHeavyEquipmentLoan({ equipmentId: "PB-1", status: "DIPINJAM", quantityBorrowed: 12 }),
    normalizeHeavyEquipmentLoan({ equipmentId: "PB-1", status: "SELESAI", quantityBorrowed: 5, quantityReturnedGood: 5 }),
  ];
  assert.equal(getHeavyEquipmentLoanRemainingQuantity(loans[0]), 12);
  assert.deepEqual(heavyEquipmentQuantityBalance(pool, loans), {
    total: 40,
    reserved: 12,
    available: 28,
    damaged: 0,
    lost: 0,
  });
});

test("quantity balance excludes rejected loans and keeps damaged/lost unavailable", () => {
  const pool = normalizeHeavyEquipmentRecord({ id: "PB-1", trackingMode: "QUANTITY", quantityTotal: 40 });
  const loans = [
    normalizeHeavyEquipmentLoan({ equipmentId: "PB-1", status: "REJECTED", quantityBorrowed: 20 }),
    normalizeHeavyEquipmentLoan({ equipmentId: "PB-1", status: "SELESAI", quantityBorrowed: 7, quantityReturnedGood: 4, quantityReturnedDamaged: 2, quantityReturnedLost: 1 }),
  ];
  assert.deepEqual(heavyEquipmentQuantityBalance(pool, loans), {
    total: 40,
    reserved: 0,
    available: 37,
    damaged: 2,
    lost: 1,
  });
});
