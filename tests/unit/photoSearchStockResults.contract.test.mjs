import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dataStok = fs.readFileSync(new URL("../../src/components/DataStokTab.jsx", import.meta.url), "utf8");

test("photo search renders only results paired with real stock rows", () => {
  assert.match(dataStok, /const visiblePhotoSearchResults = photoSearchResults/);
  assert.match(dataStok, /resolveKartuGantungUptId\(s, lokasiList, gudangList\)/);
  assert.match(dataStok, /visiblePhotoSearchResults\.map\(\(\{result:r, stock:est\}\)/);
  assert.doesNotMatch(dataStok, /stockUptId/);
});
