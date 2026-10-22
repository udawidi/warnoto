import test from "node:test";
import assert from "node:assert/strict";
import { resolveKartuGantungOwner, resolveKartuGantungUptId, resolveLokasiLengkap, scopeKartuGantungData } from "../../src/lib/sap.js";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");

const lokasiList = [{ id: "L-BALI", gudangId: "G-BALI" }, { id: "L-SBY", gudangId: "G-SBY" }];
const gudangList = [{ id: "G-BALI", uptId: "UPT-BALI" }, { id: "G-SBY", uptId: "UPT-SBY" }];

test("owner resolver mengenali setiap UPT non-Surabaya dan memakai upt_id stok", () => {
  const ids = ["UPT-BLI", "UPT-GRS", "UPT-MDN", "UPT-MLG", "UPT-PBG"];
  for (const uptId of ids) {
    const owner = resolveKartuGantungOwner({ upt_id: uptId }, lokasiList, gudangList);
    assert.equal(owner.uptId, uptId);
    assert.equal(resolveKartuGantungUptId({ uptId, lokasiId: "UNKNOWN" }, lokasiList, gudangList), uptId);
  }
});

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

test("UPT stok yang hilang atau bertentangan fail-closed", () => {
  assert.match(resolveKartuGantungOwner({ id: "S-1" }, lokasiList, gudangList).error, /belum dapat ditentukan/);
  const conflict = resolveKartuGantungOwner({ uptId: "UPT-BALI", lokasiId: "L-SBY" }, lokasiList, gudangList);
  assert.equal(conflict.uptId, null);
  assert.match(conflict.error, /berbeda/);
  assert.equal(resolveKartuGantungUptId({ uptId: "UPT-BALI", lokasiId: "L-SBY" }, lokasiList, gudangList), null);
});

test("resolver lokasi menampilkan gudang/subgudang/blok, gudang-only, atau status kosong", () => {
  const locations = [{ id: "L-1", gudangId: "G-1", subGudangId: "SG-1", kode: "B-01" }];
  const warehouses = [{ id: "G-1", nama: "Gudang Bali", uptId: "UPT-BLI" }, { id: "G-2", nama: "Gudang Gresik", uptId: "UPT-GRS" }];
  const subs = [{ id: "SG-1", nama: "Sub A" }];
  assert.equal(resolveLokasiLengkap({ id: "K-1" }, [{ katalogId: "K-1", lokasiId: "L-1" }], locations, subs, warehouses), "Gudang Bali • Sub A • B-01");
  assert.equal(resolveLokasiLengkap({ id: "K-1" }, [{ katalogId: "K-1", gudangId: "G-2" }], locations, subs, warehouses), "Gudang Gresik");
  assert.equal(resolveLokasiLengkap({ id: "K-1" }, [{ katalogId: "K-1" }], locations, subs, warehouses), "Lokasi belum diisi");
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
