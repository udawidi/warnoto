import test from "node:test";
import assert from "node:assert/strict";
import { buildTUG9HTML, buildLembarHitungHTML, buildTUG3HTML } from "../../src/lib/docBuilders.js";

const SCRIPT_PAYLOAD = "<script>alert(1)</script>";
const ATTR_PAYLOAD = "\"><img src=x onerror=alert(1)>";

test("buildTUG9HTML escapes stored XSS payloads in material/keterangan fields", () => {
  const txn = {
    id: "TUG9-TEST",
    keteranganBarang: SCRIPT_PAYLOAD,
    fotoKendaraan: ATTR_PAYLOAD,
    stockItems: [{ stockId: "s1", qty: 1 }],
  };
  const stocks = [
    { id: "s1", name: SCRIPT_PAYLOAD, lokasi: ATTR_PAYLOAD, unit: "PCS", jenisBarang: "-" },
  ];
  const html = buildTUG9HTML(txn, stocks, [], [], []);

  assert.equal(html.includes(SCRIPT_PAYLOAD), false, "raw <script> tag must not appear unescaped");
  assert.equal(html.includes(ATTR_PAYLOAD), false, "raw attribute-breakout payload must not appear unescaped");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("buildLembarHitungHTML escapes stored XSS payloads in item fields", () => {
  const opn = {
    id: "OPN-TEST",
    semester: SCRIPT_PAYLOAD,
    jenisAlur: "TUP",
    items: [
      { katalogId: "k1", noKatalog: SCRIPT_PAYLOAD, namaBarang: ATTR_PAYLOAD, satuan: "BH", qtySistem: 1 },
    ],
  };
  const html = buildLembarHitungHTML(opn, {});

  assert.equal(html.includes(SCRIPT_PAYLOAD), false, "raw <script> tag must not appear unescaped");
  assert.equal(html.includes(ATTR_PAYLOAD), false, "raw attribute-breakout payload must not appear unescaped");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("buildTUG3HTML escapes stored XSS payloads in nama/lokasi/keterangan fields", () => {
  const txn = {
    id: "TUG3-TEST",
    dariSupplier: SCRIPT_PAYLOAD,
    keteranganTug3: SCRIPT_PAYLOAD,
    stockItems: [
      { katalogMode: "new", namaBaru: ATTR_PAYLOAD, satuanBaru: "BH", qty: 1 },
    ],
  };
  const html = buildTUG3HTML(txn, [], [], [], []);

  assert.equal(html.includes(SCRIPT_PAYLOAD), false, "raw <script> tag must not appear unescaped");
  assert.equal(html.includes(ATTR_PAYLOAD), false, "raw attribute-breakout payload must not appear unescaped");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});
