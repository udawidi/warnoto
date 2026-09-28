import test from "node:test";
import assert from "node:assert/strict";
import { resolveKartuGantungUptId, scopeKartuGantungData } from "../../src/lib/sap.js";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");

const lokasiList = [{ id: "L-BALI", gudangId: "G-BALI" }, { id: "L-SBY", gudangId: "G-SBY" }];
const gudangList = [{ id: "G-BALI", uptId: "UPT-BALI" }, { id: "G-SBY", uptId: "UPT-SBY" }];

test("Kartu Gantung hanya mengambil stok dan transaksi UPT baris yang diklik", () => {
  const stocks = [
    { id: "SB-BALI", katalogId: "K-1", lokasiId: "L-BALI", qty: 4 },
    { id: "SB-SBY", katalogId: "K-1", lokasiId: "L-SBY", qty: 9 },
  ];
  const txns = [
    { id: "T-BALI", uptId: "UPT-BALI", status: "APPROVED", stockItems: [{ stockId: "SB-BALI", qty: 1 }] },
    { id: "T-SBY", uptId: "UPT-SBY", status: "APPROVED", stockItems: [{ stockId: "SB-SBY", qty: 1 }] },
  ];
  const scoped = scopeKartuGantungData({ id: "K-1", uptId: "UPT-BALI" }, stocks, txns, lokasiList, gudangList);
  assert.deepEqual(scoped.stocks.map(s => s.id), ["SB-BALI"]);
  assert.deepEqual(scoped.txns.map(t => t.id), ["T-BALI"]);
});

test("data Kartu Gantung tanpa UPT ter-resolve ditolak", () => {
  assert.equal(resolveKartuGantungUptId({ id: "S-1", lokasiId: "UNKNOWN" }, lokasiList, gudangList), null);
  const scoped = scopeKartuGantungData({ id: "K-1" }, [{ id: "S-1", katalogId: "K-1" }], [], lokasiList, gudangList);
  assert.deepEqual(scoped.stocks, []);
});

test("transaksi legacy memakai UPT pembuat sebagai fallback", () => {
  const scoped = scopeKartuGantungData(
    { id: "K-1", uptId: "UPT-BALI" },
    [{ id: "SB-BALI", katalogId: "K-1", lokasiId: "L-BALI", qty: 4 }],
    [{ id: "T-BALI", createdBy: "U-BALI", status: "APPROVED", stockItems: [{ stockId: "SB-BALI", qty: 1 }] }],
    lokasiList,
    gudangList,
    [{ id: "U-BALI", uptId: "UPT-BALI" }],
  );
  assert.deepEqual(scoped.txns.map(t => t.id), ["T-BALI"]);
});

test("agregasi katalog memasukkan UPT dan memisahkan baris tanpa UPT", () => {
  assert.match(app, /const uptKey = resolvedUptId \|\| `__UNSCOPED__:\$\{s\.id\}`/);
  assert.match(app, /const key = `\$\{uptKey\}\|\$\{s\.katalogId/);
});
