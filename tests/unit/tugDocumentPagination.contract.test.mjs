import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../src/components/TransactionHubTab.jsx", import.meta.url), "utf8");

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
