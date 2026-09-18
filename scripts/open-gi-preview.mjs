import { chromium } from "@playwright/test";
import { CLOUD_FIXTURES, GI_CLOUD_OVERRIDES } from "../tests/e2e/fixtures.js";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.route("**/*", async route => {
  const host = new URL(route.request().url()).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return route.abort("blockedbyclient");
  return route.continue();
});
await page.goto("http://localhost:4173", { waitUntil: "domcontentloaded" });
await page.evaluate(overrides => {
  for (const [key, value] of Object.entries(overrides)) {
    localStorage.setItem(`warnoto_${key}`, JSON.stringify(value));
  }
  localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ e2e: true }));
  localStorage.setItem("warnoto_profile_cache_v3", JSON.stringify({ endpoint: undefined, profile: {
    id: "e2e-superadmin", name: "E2E Mobile Reviewer", username: "e2e", role: "SUPERADMIN",
    jabatan: "Quality Assurance", avatar: "E2", upt: "Surabaya", uptId: "UPT-SBY", gudangIds: null,
  }}));
}, { ...CLOUD_FIXTURES, ...GI_CLOUD_OVERRIDES });
await page.reload({ waitUntil: "domcontentloaded" });
console.log("GI preview terbuka di http://localhost:4173 — tutup Chromium untuk mengakhiri.");
await new Promise(resolve => browser.on("disconnected", resolve));
