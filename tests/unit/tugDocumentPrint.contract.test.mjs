import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildTUG3HTML,
  buildTUG5HTML,
  buildTUG5ULTGHTML,
  buildTUG7HTML,
  buildTUG9HTML,
  buildTUG10HTML,
} from "../../src/lib/docBuilders.js";

const baseTxn = { id: "TUG-PRINT-TEST", stockItems: [] };
const builders = [
  ["TUG3", () => buildTUG3HTML(baseTxn, [], [], [], [], [], [])],
  ["TUG5", () => buildTUG5HTML(baseTxn, [], [], [], [], [])],
  ["TUG5-ULTG", () => buildTUG5ULTGHTML(baseTxn, [], [], [])],
  ["TUG7", () => buildTUG7HTML(baseTxn, [], [], [], [])],
  ["TUG8/9", () => buildTUG9HTML(baseTxn, [], [], [], [], [])],
  ["TUG10", () => buildTUG10HTML(baseTxn, [], [], [], [], [], [], [])],
];

test("TUG-9 Keterangan uses material status, not jenisBarang", () => {
  const html = buildTUG9HTML(
    { ...baseTxn, keteranganBarang: "Untuk pekerjaan" , stockItems: [{ stockId: "s1", qty: 1 }] },
    [{ id: "s1", name: "Material", jenisBarang: "Persediaan", sapStatus: "Non-SAP", unit: "BH" }],
    [], [], [], [],
  );

  assert.match(html, /\(Non-SAP\) Untuk pekerjaan/);
  assert.doesNotMatch(html, /\(Persediaan\) Untuk pekerjaan/);
});

test("TUG-10 prints reception warehouse and dates", () => {
  const html = buildTUG10HTML({
    ...baseTxn,
    gudangTujuanId: "g-1",
    tanggalPenggantianTerakhirBeroperasi: "2026-06-10",
    tanggalPenerimaan: "2026-06-12",
  }, [], [], [], [], [{ id: "g-1", nama: "Gudang Waru" }], [], []);
  assert.match(html, /LOKASI GUDANG/);
  assert.match(html, /Gudang Waru/);
  assert.match(html, /10 Juni 2026/);
  assert.match(html, /12 Juni 2026/);
  assert.match(html, /Tanggal Penerimaan/);
  assert.doesNotMatch(html, /INFORMASI PENERIMAAN MATERIAL|reception-tbl|reception-label/);
  const legacy = buildTUG10HTML({ ...baseTxn, gudangTujuanId: "missing" }, [], [], [], [], [], [], []);
  assert.match(legacy, /LOKASI GUDANG/);
  assert.match(legacy, />-<\/td>/);
});

test("TUG-10 form exposes manual date inputs and submit validation", () => {
  const source = fs.readFileSync(new URL("../../src/components/TugFormModals.jsx", import.meta.url), "utf8");
  const hook = fs.readFileSync(new URL("../../src/hooks/useTugTransactions.js", import.meta.url), "utf8");
  assert.match(source, /type="date" value=\{txnForm\.tanggalPenggantianTerakhirBeroperasi/);
  assert.match(source, /type="date" value=\{txnForm\.tanggalPenerimaan/);
  assert.match(hook, /if \(!tf\.tanggalPenggantianTerakhirBeroperasi\)/);
  assert.match(hook, /if \(!tf\.tanggalPenerimaan\)/);
});

test("TUG-10 signers stay scoped and reject role mismatch", () => {
  const txn = { ...baseTxn, uptId: "UPT-A", approvedByTL: "tl-b", approvedByAsman: "asman-a" };
  const users = [
    { id: "tl-b", role: "TL", uptId: "UPT-B", name: "TL WRONG" },
    { id: "tl-a", role: "TL", uptId: "UPT-A", name: "TL A" },
    { id: "asman-a", role: "ADMIN", uptId: "UPT-A", name: "ASMAN WRONG ROLE" },
    { id: "asman-b", role: "ASMAN", uptId: "UPT-B", name: "ASMAN WRONG UPT" },
    { id: "asman-c", role: "ASMAN", uptId: "UPT-A", name: "ASMAN A" },
  ];
  const html = buildTUG10HTML({ ...txn, identitySnapshot: { tl_name: "SNAPSHOT TL" } }, [], [], users, [], [], [], []);
  assert.match(html, /SNAPSHOT TL/);
  assert.match(html, /ASMAN A/);
  assert.doesNotMatch(html, /TL WRONG|ASMAN WRONG ROLE|ASMAN WRONG UPT|ASEP MOCH|WIDI FERDIAN/);
  const unscoped = buildTUG10HTML({ ...baseTxn }, [], [], [{ role: "TL", name: "GLOBAL TL" }, { role: "ASMAN", name: "GLOBAL ASMAN" }], [], [], [], []);
  assert.doesNotMatch(unscoped, /GLOBAL TL|GLOBAL ASMAN/);
  assert.match(unscoped, /\.\.\.\.\.\.\.\.\.\.\.\.\.\.\./);
});

test("TUG-10 prints compact warehouse location in metadata order", () => {
  const html = buildTUG10HTML({ ...baseTxn, uptId: "UPT-A", gudangTujuanId: "g1", subGudangTujuanId: "s1", lokasiTujuanId: "l1", noBAPenggantian: "BA-1", tanggalPenggantianTerakhirBeroperasi: "2026-06-10" }, [], [{ id: "l1", kode: "B02", subGudangId: "s1" }], [], [], [{ id: "g1", nama: "Gudang Utama" }], [{ id: "s1", nama: "Transformator", gudangId: "g1" }, { id: "other", nama: "Transformator", gudangId: "g2" }], []);
  assert.match(html, /LOKASI GUDANG[\s\S]*Gudang Utama \/ TRN \/ B02[\s\S]*NO BA PENGGANTIAN[\s\S]*BA-1[\s\S]*TANGGAL PENGGANTIAN/);
  assert.doesNotMatch(html, /NAMA GUDANG DITERIMA MATERIAL|reception-tbl/);

  const legacy = buildTUG10HTML({ ...baseTxn, gudangTujuanId: "", lokasiTujuanId: "l2" }, [], [{ id: "l2", nama: "Blok Legacy", gudangId: "g1", subGudangId: "s2" }], [], [], [{ id: "g1", nama: "Gudang Lama" }], [{ id: "s2", nama: "Transformator" , gudangId: "g1" }, { id: "other", nama: "Transformator", gudangId: "g2" }], []);
  assert.match(legacy, /Gudang Lama \/ TRN \/ Blok Legacy/);
  const gi = buildTUG10HTML({ ...baseTxn, gudangTujuanId: "g1" }, [], [], [], [], [{ id: "g1", nama: "GI C" }], [], []);
  assert.match(gi, /GI C/);
});

test("TUG-10 prints catalog number from master, snapshot, or new material", () => {
  const html = buildTUG10HTML({ ...baseTxn, stockItems: [
    { katalogMode: "existing", katalogId: "m1", qty: 1, statusMaterial: "Material Sisa Baru", noAsset: "A1" },
    { katalogMode: "existing", katalogId: "legacy", snapshot: { name: "Legacy", katalog: "000123" }, qty: 2, statusMaterial: "Bongkaran" },
    { katalogMode: "new", namaBaru: "Baru & Khusus", katalogBaru: "CAT-NEW", satuanBaru: "unit", qty: 1, statusMaterial: "Material Sisa Baru" },
    { katalogMode: "new", namaBaru: "Tanpa Kode", qty: 1, statusMaterial: "Material Sisa Baru" },
  ] }, [{ id: "m1", name: "Master", katalog: "MAT-001", satuan: "BH" }], [], [], [], [], [], [], []);
  assert.match(html, /Master[\s\S]*MAT-001/);
  assert.match(html, /Legacy[\s\S]*123/);
  assert.match(html, /Baru &amp; Khusus[\s\S]*CAT-NEW/);
  assert.match(html, /Tanpa Kode[\s\S]*>-<\/td>/);
  assert.match(html, /No\. Catalog/);
});

test("all TUG document builders keep one physical A4 layout for screen and print", () => {
  for (const [name, build] of builders) {
    const html = build();
    assert.match(html, /@page\{size:210mm 297mm;margin:0\}/, name);
    assert.match(html, /\.page\{box-sizing:border-box;width:210mm;min-height:297mm;padding:/, name);
    assert.match(html, /\.page table thead\{display:table-header-group\}/, name);
    assert.match(html, /break-inside:avoid;page-break-inside:avoid/, name);
    assert.match(html, /\.page\{width:210mm;min-height:297mm;max-width:none;margin:0;padding:/, name);
  }
});

test("document preview gates print/open until iframe assets settle", () => {
  const source = fs.readFileSync(new URL("../../src/components/StockModals.jsx", import.meta.url), "utf8");
  assert.match(source, /useState\(false\)/);
  assert.match(source, /onLoad=\{handlePreviewLoad\}/);
  assert.match(source, /frameDocument\.fonts\?\.ready/);
  assert.match(source, /image\.addEventListener\("load"/);
  assert.match(source, /image\.addEventListener\("error"/);
  assert.match(source, /disabled=\{!previewReady\}/g);
});

test("UPT-PBG documents never inherit Surabaya identity", () => {
  const uptList = [{ id: "UPT-PBG", nama: "UPT Probolinggo", kode: "UPT-PBLG", alamat: "Jl. Probolinggo" }];
  const txn = { ...baseTxn, id: "TUG-PBG-TEST", uptId: "UPT-PBG", unitPenerima: "UPT Probolinggo", uptPengirimId: "UPT-PBG", stockItems: [] };
  const htmlByType = {
    "TUG3": buildTUG3HTML({ ...txn, docType: "TUG3" }, [], [], [], [], [], uptList),
    "TUG4": buildTUG3HTML({ ...txn, docType: "TUG4" }, [], [], [], [], [], uptList),
    "TUG5": buildTUG5HTML({ ...txn, docType: "TUG5" }, [], [], [], [], uptList),
    "TUG7": buildTUG7HTML({ ...txn, docType: "TUG7" }, [], [], uptList, []),
    "TUG8": buildTUG9HTML({ ...txn, docType: "TUG8" }, [], [], [], uptList, []),
    "TUG9": buildTUG9HTML({ ...txn, docType: "TUG9" }, [], [], [], uptList, []),
    "TUG10": buildTUG10HTML({ ...txn, docType: "TUG10" }, [], [], [], [], [], [], uptList),
  };

  for (const [type, html] of Object.entries(htmlByType)) {
    assert.doesNotMatch(html, /Surabaya/i, type);
    assert.match(html, /Probolinggo/i, type);
  }

  const buildersSource = fs.readFileSync(new URL("../../src/lib/docBuilders.js", import.meta.url), "utf8");
  const approvalsSource = fs.readFileSync(new URL("../../src/hooks/useTugApprovals.js", import.meta.url), "utf8");
  assert.doesNotMatch(buildersSource, /KETINTANG BARU NO\. 9 SURABAYA/);
  assert.doesNotMatch(approvalsSource, /unitPenerima:\s*["']UPT Surabaya["']/);
  assert.doesNotMatch(approvalsSource, /unitTujuan:\s*txn\.unitPenerima\s*\|\|\s*["']UPT Surabaya["']/);
});
