import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/lib/docBuilders.js", "utf8");
const form = source.slice(source.indexOf("export function buildForm5SHTML"), source.indexOf("// ─── FASE F:"));

test("Form 5S print keeps A4 portrait geometry compact and deterministic", () => {
  assert.match(form, /@page\{size:A4 portrait;margin:0\}/);
  assert.match(form, /padding:11mm 12mm 10mm/);
  assert.match(form, /overflow:hidden/);
  assert.match(form, /break-inside:avoid;page-break-inside:avoid/);
  assert.match(form, /\.evidence-page\{break-before:page/);
  assert.match(form, /\.photo-page\{break-before:page/);
});

test("Form 5S photo appendix uses a readable three-column contain grid with captions", () => {
  assert.match(form, /class="photo-grid"/);
  assert.match(form, /class="photo-cell"/);
  assert.match(form, /max-height:184mm;width:auto;height:auto;object-fit:contain/);
  assert.match(form, /class="photo-caption"/);
  assert.match(form, /categoryLabels\)\.map/);

  const page = form.match(/\.page\{padding:(\d+)mm (\d+)mm (\d+)mm;min-height:(\d+)mm/);
  const cell = form.match(/\.photo-cell\{height:(\d+)mm/);
  const grid = form.match(/\.photo-grid\{[^}]*gap:(\d+)mm;margin-top:(\d+)mm/);
  assert.ok(page && cell && grid, "print geometry declarations must stay explicit");
  const contentHeight = Number(page[4]) - Number(page[1]) - Number(page[3]);
  const photoStackHeight = Number(grid[2]) + Number(cell[1]) + 6 + 16;
  assert.ok(photoStackHeight < contentHeight, "three-photo appendix must fit inside one A4 page");
});
