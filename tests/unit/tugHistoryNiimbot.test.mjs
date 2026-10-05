import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompactLabelKatalog } from "../../src/lib/niimbotM2h.js";

const katalogList = [
  { id: "kat-existing", katalog: "000123", name: "Existing", satuan: "BH" },
  { id: "kat-new", katalog: "7020273", name: "New material", satuan: "PCS" },
];

test("history label resolver prefers existing katalogId", () => {
  const result = resolveCompactLabelKatalog({ katalogMode: "existing", katalogId: "kat-existing", katalogBaru: "7020273" }, katalogList);
  assert.equal(result?.id, "kat-existing");
});

test("history label resolver falls back to canonical katalogBaru", () => {
  const result = resolveCompactLabelKatalog({ katalogMode: "new", katalogBaru: "000000007020273" }, katalogList);
  assert.equal(result?.id, "kat-new");
});

test("history label resolver fails closed when master is missing", () => {
  assert.equal(resolveCompactLabelKatalog({ katalogMode: "new", katalogBaru: "404" }, katalogList), null);
  assert.equal(resolveCompactLabelKatalog({ katalogMode: "existing", katalogId: "missing" }, katalogList), null);
});
