import test from "node:test";
import assert from "node:assert/strict";
import {
  approveStockLocationMove,
  buildAdminStockLocationUpdate,
  getAdminStockLocationChange,
  rejectStockLocationMove,
} from "../../src/lib/stockLocationApproval.js";

test("same warehouse location changes are immediate", () => {
  assert.deepEqual(
    getAdminStockLocationChange({ gudangId: "G1" }, { gudangId: "G1" }),
    { requiresApproval: false, approver: null },
  );
});

test("cross-warehouse ADMIN changes require TL approval", () => {
  assert.deepEqual(
    getAdminStockLocationChange({ gudangId: "G1" }, { gudangId: "G2" }),
    { requiresApproval: true, approver: "TL" },
  );
});

test("initial location assignment remains immediate", () => {
  assert.deepEqual(
    getAdminStockLocationChange(null, { gudangId: "G2" }),
    { requiresApproval: false, approver: null },
  );
});

test("cross-warehouse request keeps the canonical location until TL approves", () => {
  const stock = { id: "STK-1", gudangId: "G1", lokasiId: "L1", lokasi: "BLOK-1" };
  const updated = buildAdminStockLocationUpdate(
    stock,
    { id: "L1", gudangId: "G1", kode: "BLOK-1" },
    { id: "L2", gudangId: "G2", kode: "BLOK-2" },
    "ADMIN-1",
    123,
  );

  assert.equal(updated.gudangId, "G1");
  assert.equal(updated.lokasiId, "L1");
  assert.equal(updated.lokasi, "BLOK-1");
  assert.equal(updated.pendingGudangId, "G2");
  assert.equal(updated.pendingLokasiId, "L2");
  assert.equal(updated.lokasiMoveApprover, "TL");
});

test("same-warehouse update applies immediately and clears stale pending metadata", () => {
  const stock = {
    id: "STK-1",
    gudangId: "G1",
    lokasiId: "L1",
    lokasiMovePending: true,
    pendingGudangId: "G2",
  };
  const updated = buildAdminStockLocationUpdate(
    stock,
    { id: "L1", gudangId: "G1" },
    { id: "L3", gudangId: "G1", kode: "BLOK-3" },
    "ADMIN-1",
    123,
  );

  assert.equal(updated.gudangId, "G1");
  assert.equal(updated.lokasiId, "L3");
  assert.equal(updated.lokasiMovePending, false);
  assert.equal(updated.pendingGudangId, null);
});

test("TL approval applies the concrete target warehouse and location", () => {
  const pending = {
    id: "STK-1",
    gudangId: "G1",
    lokasiId: "L1",
    lokasi: "BLOK-1",
    lokasiMovePending: true,
    lokasiMoveApprover: "TL",
    pendingGudangId: "G2",
    pendingLokasiId: "L2",
    pendingLokasiKode: "BLOK-2",
    moveRequestedBy: "ADMIN-1",
    moveRequestedAt: 123,
  };
  const approved = approveStockLocationMove(
    pending,
    { id: "L2", gudangId: "G2", kode: "BLOK-2" },
    "TL-1",
    456,
  );

  assert.equal(approved.gudangId, "G2");
  assert.equal(approved.lokasiId, "L2");
  assert.equal(approved.lokasi, "BLOK-2");
  assert.equal(approved.lokasiMovePending, false);
  assert.equal(approved.pendingGudangId, null);
  assert.equal(approved.moveApprovedBy, "TL-1");
});

test("TL rejection preserves the canonical warehouse and location", () => {
  const pending = {
    id: "STK-1",
    gudangId: "G1",
    lokasiId: "L1",
    lokasi: "BLOK-1",
    lokasiMovePending: true,
    lokasiMoveApprover: "TL",
    pendingGudangId: "G2",
    pendingLokasiId: "L2",
  };
  const rejected = rejectStockLocationMove(pending);

  assert.equal(rejected.gudangId, "G1");
  assert.equal(rejected.lokasiId, "L1");
  assert.equal(rejected.lokasi, "BLOK-1");
  assert.equal(rejected.lokasiMovePending, false);
  assert.equal(rejected.pendingGudangId, null);
});
