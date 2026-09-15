const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { E2E_PROFILE, CLOUD_FIXTURES } = require("../../tests/e2e/fixtures");

const BASE_URL = "http://localhost:4173";
const OUT = path.join(__dirname, "assets");
const SAP_STOCKS = CLOUD_FIXTURES.pln_stocks_v4.map((stock, index) => ({
  ...stock,
  id:`STK-SAP-E2E-${index + 1}`,
}));

const ASMAN_PROFILE = {
  ...E2E_PROFILE,
  id: "e2e-asman",
  name: "Asman Gudang Uji",
  username: "asman-e2e",
  role: "ASMAN",
  jabatan: "Asisten Manager",
  avatar: "AM",
};

const UPT_ADMIN_PROFILE = {
  ...E2E_PROFILE,
  id: "e2e-admin-upt",
  name: "Admin Gudang UPT Uji",
  username: "admin-upt-e2e",
  role: "ADMIN",
  jabatan: "Admin Gudang",
  avatar: "AG",
};

const pendingOpname = {
  ...CLOUD_FIXTURES.pln_opname_v1[0],
  id: "OPN-E2E-PENDING",
  status: "PENDING_ASMAN",
  submittedAt: 1784509200000,
  items: CLOUD_FIXTURES.pln_opname_v1[0].items.map((item, index) => ({
    ...item,
    qtsFisik: index === 0 ? 8 : 4,
    selisih: index === 0 ? -2 : 0,
    statusItem: index === 0 ? "SELISIH" : "SESUAI",
    keterangan: index === 0 ? "Hasil hitung fisik dan hitung ulang sama" : "",
    hitungPerLokasi: index === 0 ? { "LOK-E2E-A": 8 } : { "LOK-E2E-B": 4 },
    recountDone: index === 0,
  })),
};

const completedOpname = {
  ...pendingOpname,
  id: "OPN-E2E-SELESAI",
  status: "SELESAI",
  approvedAt: 1784512800000,
  approvedBy: "e2e-asman",
};

const pendingStockCount = {
  id: "SC-E2E-PENDING",
  uploadedAt: 1784509200000,
  uploadedBy: "e2e-superadmin",
  summary: { totalItem: 3, akuratCount: 1, akuratPct: 33 },
  items: [
    { id:"SCI-E2E-01", katalogId:"KAT-E2E-01", katalogKode:"301234567", nama:"Isolator Keramik 150 kV", satuan:"BUAH", qtySap:8, qtyApp:2, selisih:-6, selisihPct:75, status:"APP_KURANG", rekomendasi:"TAMBAH_STOK", approval:"PENDING", approvedBy:null, approvedAt:null, catatan:null },
    { id:"SCI-E2E-02", katalogId:"KAT-E2E-02", katalogKode:"309876543", nama:"Lightning Arrester 150 kV", satuan:"SET", qtySap:12, qtyApp:12, selisih:0, selisihPct:0, status:"AKURAT", rekomendasi:null, approval:null, approvedBy:null, approvedAt:null, catatan:null },
    { id:"SCI-E2E-03", katalogId:null, katalogKode:"777777777", nama:"Material Contoh Belum Terdaftar", satuan:"BUAH", qtySap:3, qtyApp:0, selisih:-3, selisihPct:100, status:"APP_KURANG", rekomendasi:"TAMBAH_STOK", approval:"PENDING", approvedBy:null, approvedAt:null, catatan:null },
  ],
};

async function newPage(browser, { profile = E2E_PROFILE, overrides = {}, viewport = { width:1366, height:900 } } = {}) {
  const context = await browser.newContext({ viewport, colorScheme:"light", locale:"id-ID", timezoneId:"Asia/Jakarta" });
  const cloud = { ...CLOUD_FIXTURES, ...overrides };
  await context.addInitScript(({ profile, cloud }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ e2e:true }));
    localStorage.setItem("warnoto_profile_cache_v3", JSON.stringify({ profile }));
    localStorage.setItem("warnoto_theme", "light");
    Object.entries(cloud).forEach(([key, value]) => localStorage.setItem(`warnoto_${key}`, JSON.stringify(value)));
  }, { profile, cloud });
  await context.route("**/*", async route => {
    const host = new URL(route.request().url()).hostname;
    if (/(^|\.)(supabase\.co|groq\.com|cohere\.com)$/i.test(host)) return route.abort("blockedbyclient");
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil:"domcontentloaded" });
  await page.locator(".app-shell").waitFor();
  return { context, page };
}

async function openRoute(page, parent, child) {
  const menu = page.getByRole("button", { name:"Buka menu" });
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await page.getByRole("button", { name:parent, exact:true }).click();
  if (child) await page.getByRole("button", { name:child, exact:true }).click();
  await page.waitForTimeout(350);
}

async function snap(page, name, locator = page.locator(".app-content")) {
  await page.locator('div[style*="z-index: 9999"]').evaluateAll(elements => elements.forEach(element => element.remove()));
  await locator.screenshot({ path:path.join(OUT, `${name}.png`), animations:"disabled" });
}

async function capture() {
  fs.mkdirSync(OUT, { recursive:true });
  const browser = await chromium.launch({ headless:true });
  try {
    {
      const { context, page } = await newPage(browser);
      await openRoute(page, "Stock Opname & Count", "Stock Opname");
      await snap(page, "opname-01-daftar");
      await page.getByRole("button", { name:/Lanjutkan draft 2026-2/ }).click();
      await page.waitForTimeout(300);
      await snap(page, "opname-02-dashboard", page.locator(".opname-panel"));
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { overrides:{ pln_opname_v1:[] } });
      await openRoute(page, "Stock Opname & Count", "Stock Opname");
      await snap(page, "opname-03-upload");
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { viewport:{ width:390, height:844 } });
      await openRoute(page, "Stock Opname & Count", "Stock Opname");
      await page.getByRole("button", { name:/Lanjutkan draft 2026-2/ }).click();
      await page.getByRole("button", { name:"Mulai Hitung" }).click();
      const overlay = page.locator('div[style*="z-index: 900"]');
      await snap(page, "opname-04-mode-lapangan", overlay);
      await overlay.getByText("GTK — A-01").click();
      await snap(page, "opname-05-daftar-barang", overlay);
      await overlay.getByText("Isolator Keramik 150 kV").click();
      await overlay.locator("input[type=number]").fill("8");
      await snap(page, "opname-06-input-fisik", overlay);
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { overrides:{ pln_opname_v1:[pendingOpname] } });
      await openRoute(page, "Stock Opname & Count", "Stock Opname");
      await page.getByRole("button", { name:/Lihat Detail/ }).first().click();
      await page.waitForTimeout(250);
      await snap(page, "opname-07-rekonsiliasi", page.locator(".opname-panel"));
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { profile:ASMAN_PROFILE, overrides:{ pln_opname_v1:[pendingOpname], pln_stockcount_v1:[pendingStockCount] } });
      await openRoute(page, "Approval");
      await snap(page, "approval-01-asman", page.locator(".approval-page"));
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { overrides:{ pln_opname_v1:[completedOpname] } });
      await openRoute(page, "Stock Opname & Count", "Stock Opname");
      await snap(page, "opname-08-selesai");
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { overrides:{ pln_stockcount_v1:[], pln_stocks_v4:SAP_STOCKS } });
      await openRoute(page, "Stock Opname & Count", "Stock Count");
      await snap(page, "stockcount-01-awal");
      const csv = Buffer.from([
        "Material,Material Description,Base Unit of Measure,Unrestricted Use Stock",
        "301234567,Isolator Keramik 150 kV,BUAH,8",
        "309876543,Lightning Arrester 150 kV,SET,12",
        "777777777,Material Contoh Belum Terdaftar,BUAH,3",
      ].join("\n"));
      await page.locator('input[type="file"]').setInputFiles({ name:"PEMAT_15092026.csv", mimeType:"text/csv", buffer:csv });
      await page.getByText(/Review Draft Stock Count/).waitFor();
      await snap(page, "stockcount-02-review-draft");
      await page.getByRole("button", { name:/Simpan & Kirim ke Asman/ }).click();
      await page.waitForTimeout(500);
      await snap(page, "stockcount-03-riwayat");
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { profile:E2E_PROFILE, overrides:{ pln_maturity_audits_v1:[], pln_maturity_audit_history_v1:[], pln_maturity_5s_assessments_v1:[] } });
      await openRoute(page, "Penilaian Maturity");
      await snap(page, "maturity-01-dashboard");
      await page.getByRole("button", { name:"Pelaksanaan Audit", exact:true }).click();
      await page.waitForTimeout(250);
      await snap(page, "maturity-02-daftar-audit");
      await page.getByRole("button", { name:"+ Audit Baru", exact:true }).first().click();
      await page.waitForTimeout(350);
      await snap(page, "maturity-03-input-audit");
      await page.locator(".maturity-aspect-row").first().click();
      await page.waitForTimeout(250);
      await snap(page, "maturity-04-upload-evidence");
      await page.getByRole("button", { name:/Kembali ke Daftar Aspek/ }).click();
      await page.getByRole("button", { name:/Kembali ke Daftar/ }).click();
      await page.waitForTimeout(250);
      const exitDialog = page.getByRole("dialog");
      if (await exitDialog.isVisible().catch(() => false)) await snap(page, "maturity-05-konfirmasi-keluar", exitDialog);
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { profile:E2E_PROFILE, overrides:{ pln_maturity_audits_v1:[], pln_maturity_audit_history_v1:[], pln_maturity_5s_assessments_v1:[] } });
      await openRoute(page, "Penilaian Maturity");
      await page.getByRole("button", { name:"Form Pengisian 5S", exact:true }).click();
      await page.waitForTimeout(250);
      await snap(page, "maturity-06-form-5s");
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

capture().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
