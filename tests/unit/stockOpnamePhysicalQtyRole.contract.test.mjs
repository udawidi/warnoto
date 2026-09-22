import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const [tab, hook] = await Promise.all([
  read("src/components/StockOpnameTab.jsx"),
  read("src/hooks/useStockOpname.js"),
]);

test("Qty Fisik draft hanya editable Admin, TL, atau Superadmin", () => {
  assert.match(tab, /const canEditDraft = !isReadOnly && hasRole\(currentUser, "ADMIN", "TL", "SUPERADMIN"\)/);
  assert.match(tab, /\{canEditDraft\s*\? <input type="number"/);
  assert.match(tab, /\{canEditDraft && \(/);
  assert.doesNotMatch(tab, /!isReadOnly\s*\? <input type="number"/);
});

test("hook menolak perubahan atau submit Qty Fisik dari role lain", () => {
  assert.match(hook, /const canEditPhysicalQty = hasRole\(currentUser, "ADMIN", "TL", "SUPERADMIN"\)/);
  assert.match(hook, /opn\?\.status === "DRAFT" && !canEditPhysicalQty/);
  assert.match(hook, /if \(!canEditPhysicalQty\) \{[\s\S]*?submit Qty Fisik/);
  assert.match(hook, /if \(!canEditPhysicalQty\) \{[\s\S]*?menambah hasil hitung fisik/);
});
