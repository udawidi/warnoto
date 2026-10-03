import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../src/components/TransactionHubTab.jsx", import.meta.url), "utf8");
const searchSource = fs.readFileSync(new URL("../../src/lib/tugSearch.js", import.meta.url), "utf8");

test("TUG document pagination contract", () => {
  assert.match(source, /const pagedDocTypes = \["TUG3", "TUG10", "TUG9", "TUG8"\]/);
  assert.match(source, /const \[pageSize, setPageSize\] = useState\(10\)/);
  assert.match(source, /\[10,20,50\]\.map/);
  assert.match(source, /filteredTxns\.filter\(t=>t\.docType===tugSubTab\)/);
  assert.match(source, /\.slice\(\(currentPage-1\)\*pageSize, currentPage\*pageSize\)/);
  assert.match(source, /\[tugSubTab, filterStatus, tugUptFilter, pageSize\]/);
  assert.match(source, /← Sebelumnya/);
  assert.match(source, /Berikutnya →/);
});

test("TUG history search contract", () => {
  assert.match(source, /useDeferredValue/);
  assert.match(source, /matchesTugHistorySearch/);
  assert.match(source, /MagnifyingGlass/);
  assert.match(source, /aria-expanded=\{historySearchOpen\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /htmlFor="tug-history-search"/);
  assert.match(source, /id="tug-history-search"/);
  assert.match(source, /dokumen ditemukan/);
  assert.match(source, /Penyedia, material, pekerjaan, nomor dokumen/);
  assert.match(source, /setHistorySearch\(""\)/);
  assert.match(searchSource, /sourceSnapshot\.contracts/);
  assert.match(searchSource, /dariSupplier/);
  assert.match(searchSource, /menyerahkanUnit/);
});

test("TUG3 history card contract title order and fallback", () => {
  const tug3Source = fs.readFileSync(new URL("../../src/components/TUG3Tab.jsx", import.meta.url), "utf8");
  assert.ok(tug3Source.indexOf("{t.dariSupplier}") < tug3Source.indexOf("Judul Kontrak: {t.judulKontrak || \"-\"}"));
  assert.match(tug3Source, /Judul Kontrak: \{t\.judulKontrak \|\| "-"\}/);
  assert.match(tug3Source, /No\. TUG:/);
  assert.match(tug3Source, /minHeight:44,padding:"10px 12px"/);
  assert.match(tug3Source, /<summary style=/);
});
