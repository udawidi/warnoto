import test from "node:test";
import assert from "node:assert/strict";
import { buildStockOpnamePackageHTML } from "../../src/lib/docBuilders.js";

const opn = {
  id: "SAP-1", flowVersion: 2, jenisAlur: "SAP", status: "SELESAI", semester: "2026-S1", uptId: "UPT-1", gudangId: "G-1", gudangKode: "G-1",
  items: [{ namaBarang: "Bearing <uji>", noKatalog: "M-1", satuan: "PCS", qtySAP: 2, qtsFisik: 2, selisih: 0, keterangan: "" }],
};
const meta = {
  version: 1, tanggal: "2026-09-16", pidRefs: ["PID-1"],
  examiners: [{ name: "Pembuat", position: "TL", userId: "u", uptId: "UPT-1" }],
  manager: { name: "Manager", position: "MANAGER", userId: "m", uptId: "UPT-1" },
};

test("paket SAP menghasilkan satu HTML document dengan BA dan TUG15", () => {
  const html = buildStockOpnamePackageHTML(opn, null, meta, { uptList: [{ id: "UPT-1", nama: "UPT Satu" }] });
  assert.equal((html.match(/<!DOCTYPE html>/gi) || []).length, 1);
  assert.match(html, /BERITA ACARA STOCK OPNAME/);
  assert.match(html, /TUG-?15/);
  assert.match(html, /Bearing &lt;uji&gt;/);
  assert.match(html, /@page\{size:A4 portrait/);
  assert.match(html, /MANAGER UPT SATU/);
});

test("paket menambahkan Non-SAP hanya jika child selesai", () => {
  const child = { ...opn, id: "NON-1", jenisAlur: "NON_SAP", sourceSapOpnameId:opn.id, status: "SELESAI", items: [{ ...opn.items[0], namaBarang: "Barang NonSAP" }] };
  const html = buildStockOpnamePackageHTML(opn, child, meta, { uptList: [{ id: "UPT-1", nama: "UPT Satu" }] });
  assert.equal((html.match(/<!DOCTYPE html>/gi) || []).length, 1);
  assert.match(html, /Barang NonSAP/);
});

test("paket menolak child selesai yang tidak berelasi ke parent SAP", () => {
  const child = { ...opn, id:"NON-LAIN", jenisAlur:"NON_SAP", sourceSapOpnameId:"SAP-LAIN", status:"SELESAI", items:[{ ...opn.items[0], namaBarang:"Tidak Boleh Muncul" }] };
  const html = buildStockOpnamePackageHTML(opn, child, meta, { uptList: [{ id:"UPT-1", nama:"UPT Satu" }] });
  assert.doesNotMatch(html, /Tidak Boleh Muncul/);
});

test("susunan tim pemeriksa konsisten di BA dan TUG-15", () => {
  const ordered = {
    ...meta,
    examiners: [
      { name: "Pemeriksa Satu", position: "ADMIN", userId: "u1", uptId: "UPT-1" },
      { name: "Pemeriksa Dua", position: "TL", userId: "u2", uptId: "UPT-1" },
      { name: "Pemeriksa Tiga", position: "ASMAN", userId: "u3", uptId: "UPT-1" },
    ],
  };
  const html = buildStockOpnamePackageHTML(opn, null, ordered, { uptList: [{ id: "UPT-1", nama: "UPT Satu" }] });
  const first = html.indexOf("Pemeriksa Satu");
  const second = html.indexOf("Pemeriksa Dua");
  const third = html.indexOf("Pemeriksa Tiga");
  assert.ok(first >= 0 && first < second && second < third);
  assert.match(html, /<td[^>]*>ADMIN<\/td>/);
  assert.match(html, /<td[^>]*>TL<\/td>/);
  assert.match(html, /<td[^>]*>ASMAN<\/td>/);
});
