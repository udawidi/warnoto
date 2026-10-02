import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hasRole } from "../../src/lib/roles.js";

const app = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const saveStock = app.slice(app.indexOf("async function saveStock()"), app.indexOf("async function uploadStockFoto", app.indexOf("async function saveStock()")));
const pendingSummary = app.slice(app.indexOf("function describeStockEditPending"), app.indexOf("async function approveStockEdit", app.indexOf("function describeStockEditPending")));

test("TL gate also allows SUPERADMIN", () => {
  assert.equal(hasRole({ role: "TL" }, "TL"), true);
  assert.equal(hasRole({ role: "SUPERADMIN" }, "TL"), true);
  assert.equal(hasRole({ role: "ADMIN" }, "TL"), false);
});

test("stock edit tracks sapStatus for direct and pending edits", () => {
  assert.match(saveStock, /original\.sapStatus!==sf\.sapStatus/);
  assert.match(saveStock, /sapStatus: original\.sapStatus/);
  assert.match(saveStock, /pendingEditData:\s*\{[^\n]*sapStatus: sf\.sapStatus/);
  assert.match(pendingSummary, /p\.sapStatus!=null/);
});

test("stock edit persists before mutating UI or reporting success", () => {
  const saveIndex = saveStock.indexOf("const savedOk = await saveToCloud");
  const guardIndex = saveStock.indexOf("if (!savedOk) return", saveIndex);
  const stateIndex = saveStock.indexOf("setStocks(ns); setStockModal(null)", guardIndex);
  const auditIndex = saveStock.indexOf("logAudit(", guardIndex);
  const toastIndex = saveStock.indexOf("showToast(", guardIndex);
  assert.ok(saveIndex >= 0 && guardIndex > saveIndex);
  assert.ok(stateIndex > guardIndex && auditIndex > guardIndex && toastIndex > guardIndex);
  assert.ok(guardIndex < stateIndex && guardIndex < auditIndex && guardIndex < toastIndex);
});
