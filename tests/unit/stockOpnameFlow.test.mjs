import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SAP_OPNAME_CATEGORIES,
  getSapOpnameCategory,
  isSapOpnameItem,
  opnameProgress,
  childOpnameMatches,
  canRestoreOpnameDraft,
  mergeOpnameForSave,
  resolveStockOpnameDocumentIdentity,
  parseStockOpnamePidRefs,
} from "../../src/lib/stockOpnameFlow.js";
import {
  allBloksSelesai,
  applyQtyToItem,
  itemCounted,
  sumHitungPerLokasi,
  extractLokasiIdFromScan,
} from "../../src/lib/sap.js";
import { lokasiScanUrlFor } from "../../src/lib/utils.js";

const stockOpnameTabSource = fs.readFileSync(new URL("../../src/components/StockOpnameTab.jsx", import.meta.url), "utf8");
const lapanganViewSource = fs.readFileSync(new URL("../../src/components/OpnameLapanganView.jsx", import.meta.url), "utf8");
const stockOpnameHookSource = fs.readFileSync(new URL("../../src/hooks/useStockOpname.js", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");

test("QR blok publik tetap terbaca sebagai pilihan blok di Mode Lapangan", () => {
  const url = lokasiScanUrlFor("TEST-BLOK A", "123e4567-e89b-42d3-a456-426614174000");
  assert.match(url, /\?loc=TEST-BLOK%20A#t=123e4567-e89b-42d3-a456-426614174000$/);
  assert.equal(extractLokasiIdFromScan(url), "TEST-BLOK A");
  assert.equal(extractLokasiIdFromScan(`https://warnoto.vercel.app${url}`), "TEST-BLOK A");
});

test("qty fisik tersimpan ke server sebelum UI menyatakan sukses", () => {
  assert.match(stockOpnameTabSource, /saveOpname\(next, touchedLokasiIds, \{ silent: true, forceMerge: true \}\)/);
  assert.match(stockOpnameTabSource, /function setQtyForBlok[\s\S]*?return queueLapanganSave\(next,/);
  assert.match(stockOpnameTabSource, /onBlur=\{saveDesktopQty\}/);
  assert.match(lapanganViewSource, /const saved = await setQtyForBlok[\s\S]*?if \(!saved\) return;[\s\S]*?Tersimpan ke server/);
  assert.match(lapanganViewSource, /disabled=\{saving\}/);
  assert.match(stockOpnameHookSource, /saveToCloud\(\{opnameList: nl\}, \{opnameChangedRows: \[toSave\]\}\)/);
  assert.match(stockOpnameHookSource, /toSave = \{ \.\.\.toSave, updatedAt: Math\.max\(Date\.now\(\), Number\(toSave\.updatedAt \|\| 0\) \+ 1\) \}/);
  assert.match(appSource, /hints\.opnameChangedRows\?\.length[\s\S]*?syncMasterTableRows\("stock_opname", hints\.opnameChangedRows/);
  assert.match(stockOpnameTabSource, /baseUpdatedAt: activeOpname\.updatedAt \|\| null/);
  assert.match(stockOpnameTabSource, /canRestoreOpnameDraft\(activeOpname, draft\)/);
});

test("recovery lokal hanya boleh menimpa versi server yang sama", () => {
  const items = [{ katalogId: "KAT-1", qtsFisik: 5 }];
  assert.equal(canRestoreOpnameDraft({ updatedAt: 200 }, { baseUpdatedAt: 200, items }), true);
  assert.equal(canRestoreOpnameDraft({ updatedAt: 201 }, { baseUpdatedAt: 200, items }), false);
  assert.equal(canRestoreOpnameDraft({}, { items }), false);
  assert.equal(canRestoreOpnameDraft({ updatedAt: 200 }, { baseUpdatedAt: 200 }), false);
});

test("merge lintas perangkat hanya mengganti blok dan lot yang disentuh", () => {
  const server = {
    id: "OPN-1",
    items: [
      { stockId: "STK-1", katalogId: "KAT-1", qtySistem: 10, hitungPerLokasi: { A: { qty: 2, at: 100 }, B: { qty: 3, at: 200 } } },
      { stockId: "STK-2", katalogId: "KAT-1", qtySistem: 4, hitungPerLokasi: { C: { qty: 4, at: 300 } } },
      { stockId: "STK-SERVER", katalogId: "KAT-2", qtySistem: 1, hitungPerLokasi: {} },
    ],
  };
  const local = {
    id: "OPN-1",
    items: [
      { stockId: "STK-1", katalogId: "KAT-1", qtySistem: 10, hitungPerLokasi: { A: { qty: 5, at: 400 } } },
      { stockId: "STK-2", katalogId: "KAT-1", qtySistem: 4, hitungPerLokasi: { C: { qty: 0, at: 300 } } },
    ],
  };

  const merged = mergeOpnameForSave(local, server, ["A"]);
  assert.deepEqual(merged.items[0].hitungPerLokasi, { A: { qty: 5, at: 400 }, B: { qty: 3, at: 200 } });
  assert.equal(merged.items[0].qtsFisik, 8);
  assert.deepEqual(merged.items[1].hitungPerLokasi, { C: { qty: 4, at: 300 } });
  assert.equal(merged.items[2].stockId, "STK-SERVER");
});

test("merge legacy mencocokkan lot tunggal dan menolak identitas ambigu", () => {
  const localLegacy = { id: "OPN-1", items: [{ katalogId: "KAT-1", qtySistem: 2, hitungPerLokasi: { A: { qty: 2, at: 400 } } }] };
  const oneServerLot = { id: "OPN-1", items: [{ stockId: "STK-1", katalogId: "KAT-1", qtySistem: 2, hitungPerLokasi: {} }] };
  assert.equal(mergeOpnameForSave(localLegacy, oneServerLot, ["A"]).items.length, 1);

  const ambiguousServerLots = {
    id: "OPN-1",
    items: [
      { stockId: "STK-1", katalogId: "KAT-1", hitungPerLokasi: {} },
      { stockId: "STK-2", katalogId: "KAT-1", hitungPerLokasi: {} },
    ],
  };
  assert.throws(() => mergeOpnameForSave(localLegacy, ambiguousServerLots, ["A"]), /Identitas lot Stock Opname ambigu/);

  const localDifferentLot = { id: "OPN-1", items: [{ ...localLegacy.items[0], stockId: "STK-NEW" }] };
  assert.equal(mergeOpnameForSave(localDifferentLot, oneServerLot, ["A"]).items.length, 2);

  const duplicateServerLot = { id: "OPN-1", items: [oneServerLot.items[0], { ...oneServerLot.items[0] }] };
  assert.throws(() => mergeOpnameForSave(localLegacy, duplicateServerLot, ["A"]), /Identitas lot Stock Opname duplikat/);
});

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
  assert.deepEqual(opnameProgress([{ qtsFisik: 2 }], null, { requireTimestamp: true }), { filled: 0, total: 1, pct: 0 });
});

test("material flow v2 wajib punya bukti timestamp, termasuk semua blok", () => {
  const partial = {
    qtsFisik: 4,
    lokasiBreakdown: [{ lokasiId: "A" }, { lokasiId: "B" }],
    hitungPerLokasi: { A: { qty: 4, at: 100 } , B: { qty: 0, at: null } },
  };
  assert.equal(itemCounted(partial), false);
  assert.equal(allBloksSelesai({ flowVersion: 2, items: [partial] }), false);
  const complete = { ...partial, hitungPerLokasi: { A: { qty: 4, at: 100 }, B: { qty: 0, at: 200 } } };
  assert.equal(itemCounted(complete), true);
  assert.equal(allBloksSelesai({ flowVersion: 2, items: [complete] }), true);
  assert.equal(itemCounted({ qtsFisik: 4 }), true);
  assert.equal(itemCounted({ qtsFisik: 4, hitungPerLokasi: {} }), false);
});

test("hitung agregat tidak menggandakan blok dan input kosong menghapus bukti", () => {
  const item = {
    qtySistem: 5,
    lokasiBreakdown: [{ lokasiId: "A" }, { lokasiId: "B" }],
    hitungPerLokasi: { A: { qty: 3, at: 100 }, B: { qty: 2, at: 200 } },
  };
  assert.equal(sumHitungPerLokasi({ ...item.hitungPerLokasi, _TANPA_LOKASI: { qty: 9, at: null } }), 5);
  const unchanged = applyQtyToItem(item, "_TANPA_LOKASI", "", "u");
  assert.equal(unchanged.hitungPerLokasi.A.at, 100);
  assert.equal(unchanged.hitungPerLokasi.B.at, 200);
  const aggregate = applyQtyToItem(item, "_TANPA_LOKASI", "9", "u");
  assert.equal(aggregate.qtsFisik, 9);
  assert.equal(aggregate.hitungPerLokasi.A.at, null);
  assert.equal(itemCounted(aggregate), true);
  const block = applyQtyToItem(aggregate, "A", "4", "u");
  assert.equal(block.hitungPerLokasi._TANPA_LOKASI.at, null);
  assert.equal(block.qtsFisik, 4);
  assert.equal(itemCounted(block), false);
  const cleared = applyQtyToItem(block, "A", "", "u");
  assert.equal(cleared.qtsFisik, null);
  assert.equal(cleared.hitungPerLokasi.A.at, null);
  assert.equal(itemCounted(cleared), false);
  const zero = applyQtyToItem(cleared, "A", 0, "u");
  assert.equal(zero.qtsFisik, 0);
  assert.notEqual(zero.hitungPerLokasi.A.at, null);
  assert.equal(itemCounted(zero), false);
  const singleZero = applyQtyToItem({ lokasiBreakdown: [{ lokasiId: "A" }], hitungPerLokasi: { A: { qty: 0, at: null } } }, "A", 0, "u");
  assert.equal(itemCounted(singleZero), true);
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
