import test from "node:test";
import assert from "node:assert/strict";
import { readTugRoute, writeTugRoute } from "../../src/lib/tugRoute.js";

const store = new Map();
globalThis.sessionStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

test("TUG route round-trips valid group/subtab in session storage", () => {
  writeTugRoute("penerimaan", "TUG10");
  assert.deepEqual(readTugRoute(), { group: "penerimaan", subtab: "TUG10" });
});

test("invalid TUG route falls back to TUG-3", () => {
  sessionStorage.setItem("warnoto_tug_route", JSON.stringify({ group: "penerimaan", subtab: "TUG8" }));
  assert.deepEqual(readTugRoute(), { group: "penerimaan", subtab: "TUG3" });
  writeTugRoute("penerimaan", "TUG8");
  assert.deepEqual(readTugRoute(), { group: "penerimaan", subtab: "TUG3" });
});
