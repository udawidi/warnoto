import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const stock = fs.readFileSync("src/components/StockOpnameTab.jsx", "utf8");
const hub = fs.readFileSync("src/components/ApprovalHubTab.jsx", "utf8");
const modal = fs.readFileSync("src/components/StockOpnameApprovalReview.jsx", "utf8");

test("Stock Opname approval uses shared review gate", () => {
  for (const source of [stock, hub]) {
    assert.match(source, /StockOpnameApprovalReview/);
    assert.doesNotMatch(source, /approveOpname_Asman\(opn,/);
  }
  assert.match(modal, /Saya sudah meninjau perbandingan SAP, fisik, WARNOTO, dan keterangan/);
  assert.match(modal, /disabled=\{!canApprove\}/);
  assert.match(modal, /missingNotes/);
  assert.match(modal, /keterangan/);
  assert.match(modal, /lokasiBreakdown/);
  assert.match(modal, /locationLabel\(item\)/);
  assert.doesNotMatch(modal, /JSON\.stringify\(item\.lokasiBreakdown\)/);
  assert.match(modal, /fotoKeseluruhan/);
  assert.match(modal, /fotoNameplate/);
  assert.doesNotMatch(modal, /item\.foto\s*\?/);
  assert.match(modal, /Approval gagal disimpan\. Status opname tetap menunggu Asman/);
});

test("ASMAN detail review opens discrepancy-only filter", () => {
  assert.match(stock, /aria-label="Filter selisih"/);
  assert.match(stock, /<option value="selisih">Selisih saja<\/option>/);
  assert.match(stock, /filterSelisihOnly && \(!itemCounted\(it,[\s\S]*?Number\(it\.selisih\) === 0\)/);
  assert.match(stock, /reviewSelisihRef\.current=true;setActiveOpname\(opn\);setFilterSelisihOnly\(true\);setPage\(0\)/);
  assert.match(stock, /Review Detail \(Selisih\)/);
  assert.doesNotMatch(stock, /setTimeout\(\(\)=>setFilterSelisihOnly/);
});

test("approval review renders readable detail cards", () => {
  assert.match(modal, /Cari nama, katalog, keterangan/);
  assert.match(modal, /Semua selisih/);
  assert.match(modal, /Qty WARNOTO/);
  assert.match(modal, /Qty SAP/);
  assert.match(modal, /Qty Fisik/);
  assert.match(modal, /Keterangan selisih/);
  assert.match(modal, /Saran tindakan/);
  assert.match(modal, /Qty ulang/);
  assert.match(modal, /Tidak ada foto \(opsional\)/);
  assert.doesNotMatch(modal, /<table/);
  assert.doesNotMatch(modal, /minWidth:760/);
});
