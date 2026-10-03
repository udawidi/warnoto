import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveAndPromoteOpnamePhoto,
  archiveManualPhotoChange,
  listScopedOpnameSessions,
  resolveOpnamePhotoTarget,
} from "../../src/lib/stockOpnamePhotoHistory.js";

const stockA = { id: "S-A", uptId: "UPT-A", katalogId: "K-1", katalog: "100" , fotoKeseluruhan: "old-a" };
const stockB = { id: "S-B", uptId: "UPT-B", katalogId: "K-1", katalog: "100", fotoKeseluruhan: "old-b" };

test("exact stock match is UPT scoped", () => {
  const opname = { id: "O-1", uptId: "UPT-A", status: "SELESAI" };
  assert.equal(resolveOpnamePhotoTarget({ stockId: "S-A", katalogId: "K-1" }, [stockA, stockB], opname).stock.id, "S-A");
  assert.equal(resolveOpnamePhotoTarget({ stockId: "S-B", katalogId: "K-1" }, [stockA, stockB], opname).reason, "upt_mismatch");
});

test("catalog fallback stays inside UPT and rejects ambiguity", () => {
  const opname = { id: "O-1", uptId: "UPT-A" };
  assert.equal(resolveOpnamePhotoTarget({ katalogId: "K-1" }, [stockA, stockB], opname).stock.id, "S-A");
  assert.equal(resolveOpnamePhotoTarget({ katalogId: "K-1" }, [stockA, { ...stockA, id: "S-A2" }], opname).reason, "ambiguous");
});

test("promotion archives previous photo and is idempotent", () => {
  const opname = { id: "O-1", uptId: "UPT-A", semester: "2026-S2", status: "SELESAI" };
  const item = { stockId: "S-A", katalogId: "K-1", fotoKeseluruhan: "new-a", fotoNameplate: "plate-a" };
  const first = archiveAndPromoteOpnamePhoto(stockA, item, opname, 10).stock;
  assert.equal(first.fotoKeseluruhan, "new-a");
  assert.equal(first.photoHistory.length, 1);
  assert.equal(first.photoHistory[0].before.fotoKeseluruhan, "old-a");
  assert.equal(Object.hasOwn(first.photoHistory[0], "after"), false);
  const secondResult = archiveAndPromoteOpnamePhoto(first, item, opname, 11);
  assert.equal(secondResult.changed, false);
  assert.equal(secondResult.stock, first);
  assert.deepEqual(secondResult.stock, first);
  assert.equal(secondResult.stock.photoHistory.length, 1);
});

test("manual change archives previous and missing UPT is fail closed", () => {
  const changed = archiveManualPhotoChange(stockA, "fotoKeseluruhan", "new-manual", 10);
  assert.equal(changed.photoHistory.at(-1).before.fotoKeseluruhan, "old-a");
  assert.equal(Object.hasOwn(changed.photoHistory.at(-1), "after"), false);
  assert.deepEqual(archiveManualPhotoChange({ id: "S-X", fotoKeseluruhan: "old" }, "fotoKeseluruhan", "new"), { id: "S-X", fotoKeseluruhan: "old" });
});

test("promotion without an old photo does not create an empty history entry", () => {
  const fresh = { id: "S-FRESH", uptId: "UPT-A", katalogId: "K-1" };
  const result = archiveAndPromoteOpnamePhoto(fresh, { stockId: "S-FRESH", fotoKeseluruhan: "new" }, { id: "O-FRESH", uptId: "UPT-A", status: "SELESAI" }, 12).stock;
  assert.equal(result.fotoKeseluruhan, "new");
  assert.equal(result.photoHistory?.length || 0, 0);
});

test("history sessions never cross UPT", () => {
  const opnameA = { id: "O-A", uptId: "UPT-A", updatedAt: 20, items: [{ stockId: "S-A", fotoKeseluruhan: "a" }] };
  const opnameB = { id: "O-B", uptId: "UPT-B", updatedAt: 30, items: [{ stockId: "S-B", fotoKeseluruhan: "b" }] };
  assert.deepEqual(listScopedOpnameSessions(stockA, [opnameA, opnameB], [stockA, stockB]).map(row => row.opname.id), ["O-A"]);
});
