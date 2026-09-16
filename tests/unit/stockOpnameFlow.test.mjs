import test from "node:test";
import assert from "node:assert/strict";
import {
  SAP_OPNAME_CATEGORIES,
  getSapOpnameCategory,
  isSapOpnameItem,
  opnameProgress,
  childOpnameMatches,
  resolveStockOpnameDocumentIdentity,
  parseStockOpnamePidRefs,
} from "../../src/lib/stockOpnameFlow.js";

test("SAP opname hanya mengenal tiga kategori dan menolak Non-SAP", () => {
  assert.deepEqual(SAP_OPNAME_CATEGORIES, ["Cadang", "Persediaan", "Pre Memory"]);
  assert.equal(getSapOpnameCategory("SAP - Cadang"), "Cadang");
  assert.equal(getSapOpnameCategory("SAP - Persediaan"), "Persediaan");
  assert.equal(getSapOpnameCategory("SAP - Pre Memory"), "Pre Memory");
  assert.equal(getSapOpnameCategory("Non-SAP"), null);
  assert.equal(isSapOpnameItem({ sapCategory: "Cadang" }), true);
  assert.equal(isSapOpnameItem({ sapCategory: "Non-SAP" }), false);
});

test("progress opname dapat dihitung total dan per kategori", () => {
  const items = [
    { sapCategory: "Cadang", qtsFisik: 2 },
    { sapCategory: "Cadang", qtsFisik: null },
    { sapCategory: "Persediaan", qtsFisik: 1 },
  ];
  assert.deepEqual(opnameProgress(items), { filled: 2, total: 3, pct: 67 });
  assert.deepEqual(opnameProgress(items, "Cadang"), { filled: 1, total: 2, pct: 50 });
});

test("child Non-SAP hanya dicocokkan ke parent SAP, gudang, dan semester", () => {
  const parent = { id: "SAP-1", flowVersion: 2, jenisAlur: "SAP", gudangId: "G-1", semester: "2026-S2" };
  assert.equal(childOpnameMatches({ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-1", semester: "2026-S2" }, parent), true);
  assert.equal(childOpnameMatches({ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-2", semester: "2026-S2" }, parent), false);
  assert.equal(childOpnameMatches({ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-1", semester: "2026-S1" }, parent), false);
  assert.equal(childOpnameMatches({ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-1", semester: "2026-S2" }, { ...parent, flowVersion: 1 }), false);
});

test("identitas dokumen memakai UPT sesi, fallback legacy, dan memblokir konflik", () => {
  const users = [
    { id: "creator", name: "Pembuat", role: "ADMIN", uptId: "UPT-1" },
    { id: "tl", name: "TL Satu", role: "TL", jabatan: "Team Leader", upt_id: "UPT-1" },
    { id: "asman", name: "Asman Satu", role: "ASMAN", jabatan: "Asman", uptId: "UPT-1" },
    { id: "manager", name: "Manager Satu", role: "MANAGER", jabatan: "Manager", upt_id: "UPT-1" },
  ];
  const result = resolveStockOpnameDocumentIdentity({
    opn: { dibuatOleh: "creator", uptId: "UPT-1" }, users, uptList: [{ id: "UPT-1", nama: "UPT Satu" }], gudangList: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.uptId, "UPT-1");
  assert.equal(result.manager.name, "Manager Satu");
  assert.deepEqual(result.examiners.map(item => item.name), ["Pembuat", "TL Satu", "Asman Satu"]);

  const conflict = resolveStockOpnameDocumentIdentity({
    opn: { dibuatOleh: "creator", uptId: "UPT-2" }, users,
    uptList: [{ id: "UPT-1" }, { id: "UPT-2" }], gudangList: [],
  });
  assert.equal(conflict.ok, false);
  assert.match(conflict.errors.join(" "), /konflik UPT/i);
  const selected = resolveStockOpnameDocumentIdentity({
    opn: { dibuatOleh: "creator", uptId: "UPT-2" }, users,
    uptList: [{ id: "UPT-1" }, { id: "UPT-2" }], gudangList: [], selectedUptId: "UPT-1",
  });
  assert.equal(selected.uptId, "UPT-1");
  assert.doesNotMatch(selected.errors.join(" "), /konflik UPT/i);
});

test("pemeriksa default mengambil tepat creator, satu TL, dan satu Asman", () => {
  const users = [
    { id: "creator", name: "Pembuat", role: "ADMIN", uptId: "U" },
    { id: "tl-1", name: "TL Satu", role: "TL", uptId: "U" },
    { id: "tl-2", name: "TL Dua", role: "TL", uptId: "U" },
    { id: "asman", name: "Asman", role: "ASMAN", uptId: "U" },
    { id: "manager", name: "Manager", role: "MANAGER", uptId: "U" },
  ];
  const result = resolveStockOpnameDocumentIdentity({ opn: { dibuatOleh: "creator", uptId: "U" }, users, uptList: [{ id: "U" }] });
  assert.deepEqual(result.examiners.map(person => person.userId), ["creator", "tl-1", "asman"]);
});

test("identity toleran upt_id, manager tepat satu, dan fallback pemeriksa manual", () => {
  const users = [
    { id: "creator", name: "Pembuat", role: "ADMIN", upt_id: "UPT-1" },
    { id: "manager-1", name: "Manager Satu", role: "MANAGER", upt_id: "UPT-1" },
    { id: "manager-2", name: "Manager Dua", role: "MANAGER", uptId: "UPT-1" },
  ];
  const result = resolveStockOpnameDocumentIdentity({ opn: { dibuatOleh: "creator" }, users, uptList: [{ id: "UPT-1" }], gudangList: [] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /tepat satu Manager/i);
  assert.deepEqual(parseStockOpnamePidRefs("PID-1, PID-2;PID-3\nPID-2"), ["PID-1", "PID-2", "PID-3"]);
});

test("child Non-SAP valid hanya bila cocok dan selesai", () => {
  const parent = { id: "SAP-1", flowVersion: 2, jenisAlur: "SAP", gudangId: "G-1", semester: "2026-S2" };
  assert.equal(resolveStockOpnameDocumentIdentity({
    opn: parent,
    users: [{ id: "u", role: "MANAGER", uptId: "UPT-1" }],
    uptList: [{ id: "UPT-1" }], gudangList: [],
    childList: [{ jenisAlur: "NON_SAP", sourceSapOpnameId: "SAP-1", gudangId: "G-1", semester: "2026-S2", status: "SELESAI" }],
  }).child.status, "SELESAI");
});
