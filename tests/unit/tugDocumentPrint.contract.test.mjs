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
