import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { generateDocNumbers, resolveDocumentUnitCode } from "../../src/lib/utils.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const hook = read("src/hooks/useTugTransactions.js");
const builders = read("src/lib/docBuilders.js");
const migration = read("supabase/migrations/20261007_tug_document_unit_multi_upt.sql");
const verifier = read("supabase/verify_tug_document_unit_config.sql");

test("document unit resolver and generator keep every UPT on its official segment", () => {
  const uptList = [{ id: "UPT-PBG", kode: "UPT-PBG" }];
  assert.equal(resolveDocumentUnitCode("UPT-PBG", uptList), "UPT-PBLG");
  assert.equal(resolveDocumentUnitCode("UPT-GRS", []), "UPT-GRS");
  assert.equal(resolveDocumentUnitCode("UPT-UNKNOWN", uptList), null);
  assert.equal(resolveDocumentUnitCode("", uptList), "UPT-SBYA");
  assert.match(generateDocNumbers(7, "2026-10-07", "LOG.00.01", "UPT-PBG").tug3, /LOG\.00\.01\/UPT-PBLG\/X\/2026$/);
  assert.match(generateDocNumbers(7, "2026-10-07", "LOG.00.01", "UPT-GRS").tug10, /LOG\.00\.01\/UPT-GRS\/X\/2026$/);
  assert.throws(() => generateDocNumbers(7, "2026-10-07", "LOG.00.01", null), /DOCUMENT_UNIT_CODE_REQUIRED/);
});

test("TUG callers resolve the transaction UPT before generating client documents", () => {
  assert.match(hook, /formData\?\.uptId \|\| currentUser\?\.uptId \|\| currentUserUptId/);
  assert.match(hook, /resolveDocumentUnitCode\(transactionUptId, uptList\)/);
  assert.match(hook, /generateDocNumbers\(seq, Date\.now\(\), docCode, documentUnitCode\)/);
  assert.match(builders, /generateDocNumbers\(txn\.docSeq, txn\.createdAt, "LOG\.00\.01", uptKode\)\.tug10/);
  assert.match(builders, /const uptKode = resolveDocumentUnitCode\(txn\.uptId, uptList\)/);
});

test("multi-UPT migration seeds are idempotent and repairs only exact known records", () => {
  for (const [id, code] of [["UPT-SBY", "SBYA"], ["UPT-PBG", "PBLG"], ["UPT-MLG", "MLG"], ["UPT-MDN", "MDN"], ["UPT-BLI", "BLI"], ["UPT-GRS", "GRS"]]) {
    assert.match(migration, new RegExp(`'${id}', '${code}', 0|'${id}', '${code}', 225`));
  }
  assert.match(migration, /on conflict \(upt_id\) do nothing/i);
  assert.match(migration, /id = 'TUG3-WKZ833'[\s\S]*upt_id = 'UPT-PBG'[\s\S]*UPT-SBYA/);
  assert.match(migration, /id = 'TUG10-PHJ4JC'[\s\S]*upt_id = 'UPT-GRS'[\s\S]*UPT-SBYA/);
  assert.match(verifier, /UPT-SBY.*SBYA/);
  assert.match(verifier, /UPT-GRS.*GRS/);
  assert.match(verifier, /VERIFY_TUG3_NON_SBY_SURABAYA_UNIT/);
  assert.match(verifier, /VERIFY_TUG10_NON_SBY_SURABAYA_UNIT/);
});
