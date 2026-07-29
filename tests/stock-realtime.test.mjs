import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const realtimeSource = await readFile(new URL("../src/lib/stockRealtime.js", import.meta.url), "utf8");
const { applyStockRealtimeEvent, applyStockRealtimeEvents, mapRealtimeStockRow } = await import(`data:text/javascript,${encodeURIComponent(realtimeSource)}`);

const stockA = { id: "STK-A", name: "Lama", qty: 1, nested: { status: "old" } };
const stockB = { id: "STK-B", name: "Tetap", qty: 2 };
const rowA = { id: "STK-A", data: { name: "Baru", qty: 3 } };

test("mapper keeps the UI contract and excludes database-only columns", () => {
  assert.deepEqual(mapRealtimeStockRow({ ...rowA, katalog_id: "K-1", lokasi_id: "L-1", created_at: 1 }), { id: "STK-A", name: "Baru", qty: 3 });
});

test("INSERT and UPDATE replace exactly one stock by id", () => {
  assert.deepEqual(
    applyStockRealtimeEvent([stockA, stockB], { eventType: "UPDATE", new: rowA }),
    [{ id: "STK-A", name: "Baru", qty: 3 }, stockB],
  );
  assert.deepEqual(
    applyStockRealtimeEvent([stockB], { eventType: "INSERT", new: rowA }),
    [stockB, { id: "STK-A", name: "Baru", qty: 3 }],
  );
  assert.deepEqual(
    applyStockRealtimeEvent([stockA, stockB], { eventType: "INSERT", new: rowA }),
    [{ id: "STK-A", name: "Baru", qty: 3 }, stockB],
  );
});

test("DELETE removes by old primary key only", () => {
  assert.deepEqual(
    applyStockRealtimeEvent([stockA, stockB], { eventType: "DELETE", old: { id: "STK-A" } }),
    [stockB],
  );
});

test("identical echo and malformed payloads are safe no-ops", () => {
  const current = [{ id: "STK-A", name: "Baru", qty: 3 }];
  assert.equal(applyStockRealtimeEvent(current, { eventType: "UPDATE", new: rowA }), current);
  assert.equal(applyStockRealtimeEvent(current, { eventType: "UPDATE", new: { id: "STK-A", data: null } }), current);
  assert.equal(applyStockRealtimeEvent(current, { eventType: "DELETE", old: {} }), current);
  assert.equal(applyStockRealtimeEvent(current, { eventType: "UNKNOWN" }), current);
});

test("buffered events replay in order on top of an authoritative snapshot", () => {
  const snapshot = [{ id: "STK-A", name: "Snapshot", qty: 1 }, stockB];
  const buffered = [
    { eventType: "UPDATE", new: { id: "STK-A", data: { name: "Sesudah snapshot", qty: 4 } } },
    { eventType: "DELETE", old: { id: "STK-B" } },
    { eventType: "INSERT", new: { id: "STK-C", data: { name: "Baru", qty: 1 } } },
  ];
  assert.deepEqual(applyStockRealtimeEvents(snapshot, buffered), [
    { id: "STK-A", name: "Sesudah snapshot", qty: 4 },
    { id: "STK-C", name: "Baru", qty: 1 },
  ]);
});
