// Verifikasi header CSP enforcing (vercel.json) terhadap BUILD PRODUCTION (dist/).
//
// KENAPA dist, bukan Vite dev server: dev server menyuntik inline <script> milik
// Vite HMR + React-Refresh preamble yang TIDAK ada di build production. Menguji CSP
// enforcing lewat dev server = false positive massal (script-src-elem inline diblok
// di tiap view) yang tak pernah terjadi di produksi. dist/index.html tak punya satu
// pun inline script (cuma bundle self + Leaflet unpkg), jadi ini satu-satunya cara
// jujur menguji header yang sama persis dgn yang Vercel kirim.
//
// CAKUPAN & BATAS: build production tak bisa jalan offline melewati layar login
// (butuh backend nyata warnoto.com), jadi harness ini memverifikasi SHELL: dokumen
// HTML, bundle Vite (self), Leaflet (unpkg), font Google, inline <style>/style={{}}
// (style-src 'unsafe-inline'), di bawah CSP asli. Tab dalam pakai bundle self yang
// SAMA (React memanipulasi DOM, tak menyuntik inline <script> baru saat runtime),
// QR sebagai <img> (img-src https:), pdfjs worker same-origin — semuanya sudah lolos
// analisa statis. connect-src ke API eksternal & alur tab-dalam butuh smoke MANUAL di
// production/preview setelah deploy (dicatat, tidak diklaim teruji di sini).
//
// Jalankan via: npm run test:csp  (script build dist dulu, lalu skrip ini serve+cek).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const PORT = 4199;
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("@playwright/test");

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("dist/ belum ada. Jalankan `npm run build` dulu (atau `npm run test:csp` yang sudah menchain build).");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const cspHeader = cfg.headers[0].headers.find(h => h.key === "Content-Security-Policy");
if (!cspHeader) { console.error("Header Content-Security-Policy (enforcing) tidak ada di vercel.json — masih Report-Only?"); process.exit(1); }
const CSP = cspHeader.value;

const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml", ".woff2":"font/woff2", ".webmanifest":"application/manifest+json", ".ico":"image/x-icon" };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html"); // SPA fallback
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Content-Type", MIME[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
});

await new Promise(r => server.listen(PORT, "localhost", r));

const browser = await chromium.launch();
const page = await browser.newPage();
const violations = [];
await page.addInitScript(() => {
  window.__cspV = [];
  document.addEventListener("securitypolicyviolation", e =>
    window.__cspV.push({ directive:e.violatedDirective, blockedURI:e.blockedURI, source:`${e.sourceFile}:${e.lineNumber}` }));
});
page.on("console", m => {
  if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text()))
    violations.push({ directive:"(console)", blockedURI:m.text().slice(0, 200) });
});

try {
  await page.goto(`http://localhost:${PORT}`, { waitUntil:"networkidle" }).catch(() => {});
  await page.waitForTimeout(2500); // biarkan Leaflet/unpkg, font, beacon sempat dimuat & memicu violation kalau ada
  violations.push(...await page.evaluate(() => window.__cspV || []));
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}

console.log(`CSP diuji (dari vercel.json):\n${CSP}\n`);
if (violations.length) {
  console.error(`${violations.length} CSP violation di shell production:`);
  for (const v of violations) console.error(`  ${v.directive} <- ${v.blockedURI}`);
  process.exitCode = 1;
} else {
  console.log("0 violation. Shell production (login + resource statis: bundle self, Leaflet, font, inline style) lolos CSP enforcing.");
  console.log("SISA (tak tercakup, butuh smoke manual production): connect-src API eksternal + alur tab-dalam (butuh login/backend nyata).");
}
