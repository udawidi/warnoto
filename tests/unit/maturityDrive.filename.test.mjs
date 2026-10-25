import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../supabase/functions/maturity-drive/index.ts", import.meta.url), "utf8");
const helperSource = source.match(/function safeEvidenceName\(value: unknown, fallback: string\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(helperSource, "safeEvidenceName helper must remain present");
const safeEvidenceName = new Function(`${helperSource.replace("value: unknown, fallback: string", "value, fallback")}; return safeEvidenceName;`)();

test("audit evidence filenames keep their full length", () => {
  const filename = `${"evidence-"}${"a".repeat(240)}.pdf`;
  assert.equal(safeEvidenceName(filename, "evidence"), filename);
  assert.equal(safeEvidenceName(" kontrak / final?.pdf ", "evidence"), "kontrak - final-.pdf");
});

test("audit evidence filename falls back when empty", () => {
  assert.equal(safeEvidenceName("   ", "evidence"), "evidence");
  assert.equal(safeEvidenceName(null, "evidence"), "evidence");
});

test("the 120 character cap stays isolated to folder and non-audit names", () => {
  assert.match(source, /function safeName[\s\S]*?text\(value, 120\)/);
  assert.match(source, /uploadDriveFile[\s\S]*?safeEvidenceName\(file\.name, "evidence"\)/);
  assert.doesNotMatch(source, /uploadDriveFile[\s\S]*?safeName\(file\.name/);
});
