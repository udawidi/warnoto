import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildTUG2FrontHTML, buildTUG2FrontCompactHTML } from "../../src/lib/docBuilders.js";

const katalog = { id: "kat-1", katalog: "CAT-<&\"", name: "Motor <uji> & panjang material dengan deskripsi sangat panjang", satuan: "BH<&" };

test("Kartu Gantung front keeps existing A4 format", async () => {
  const html = await buildTUG2FrontHTML(katalog, [], [], [], [], "UPT");
  assert.match(html, /@page\s*\{\s*size:\s*A4 portrait/);
});

test("compact Kartu Gantung is 70x50 landscape, QR-linked, escaped, and minimal", async () => {
  const html = await buildTUG2FrontCompactHTML(katalog);
  assert.match(html, /@page\s*\{\s*size:\s*70mm 50mm/);
  assert.match(html, /width:\s*70mm/);
  assert.match(html, /min-height:\s*50mm/);
  assert.match(html, /qr-panel[^}]*width:\s*34mm/);
  assert.match(html, /qr[^}]*width:\s*32mm[^}]*height:\s*32mm/);
  assert.match(html, /border-right:\s*\.25mm solid #111/);
  assert.match(html, /info-panel/);
  assert.match(html, /\.label \{[^}]*text-align:\s*center/);
  assert.match(html, /\.unit \{[^}]*align-self:\s*center/);
  assert.match(html, /\.description \{[^}]*font-size:\s*9pt/);
  assert.match(html, /api\.qrserver\.com|data:image\/png/);
  assert.match(html, /CAT-&lt;&amp;&quot;/); // canonical code remains escaped
  assert.match(html, /Motor &lt;uji&gt; &amp; panjang material/);
  assert.match(html, /BH&lt;&amp;/);
  assert.match(html, /SATUAN[\s\S]*MATERIAL DESCRIPTION[\s\S]*NO\. CATALOG/);
  assert.equal(html.indexOf('class="unit"') < html.indexOf('class="description'), true);
  assert.equal(html.indexOf('class="description') < html.indexOf('class="code"'), true);
  assert.equal((html.match(/class="code"/g) || []).length, 1);
  assert.match(html, /description (?:md|sm|xs)/);
  for (const forbidden of ["foto", "lokasi", "kategori", "PLN_LOGO_DATA_URI"]) assert.equal(html.toLowerCase().includes(forbidden.toLowerCase()), false);
});

test("Kartu Gantung keeps A4 browser print and compact preview separate from NIIMBOT", async () => {
  const source = await readFile(new URL("../../src/components/KartuGantungModal.jsx", import.meta.url), "utf8");
  const a4Handler = source.match(/const handlePrintFront = async \(\) => \{([\s\S]*?)\n  \};/)?.[1] || "";
  const compactHandler = source.match(/const handlePrintFrontCompact = async \(\) => \{([\s\S]*?)\n  \};/)?.[1] || "";
  assert.match(a4Handler, /buildTUG2FrontHTML/);
  assert.doesNotMatch(a4Handler, /Niimbot|niimbot/i);
  assert.match(compactHandler, /buildTUG2FrontCompactHTML/);
  assert.match(source, /handlePrintFrontCompactNiimbot/);
  assert.match(source, /aria-live="polite"/);
});
