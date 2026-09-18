const { test, expect, GI_CLOUD_OVERRIDES } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

test.describe("GI fixture selection stays local to e2e", () => {
  test.use({ cloudOverrides: GI_CLOUD_OVERRIDES, actorProfile: { id:"e2e-superadmin", name:"E2E", username:"e2e", role:"SUPERADMIN", jabatan:"QA", avatar:"E2", upt:"Surabaya", uptId:"UPT-SBY", gudangIds:null } });
  test("paired active GI is offered to TUG forms", async ({ isolatedPage: page }) => {
    await openApp(page);
    await openRoute(page, {
      tab: "transaction",
      menuPath: ["TUG", "Barang Masuk"],
      readySelector: ".tug-page",
    });

    for (const tabName of [/Terima Barang Baru/, /Barang Kembali/]) {
      await page.getByRole("tab", { name: tabName }).click();
      const formButton = page.getByRole("button", { name: /Terima Barang Baru|Catat Barang Kembali/ }).first();
      await expect(formButton).toBeVisible();
      await formButton.click();
      await expect(page.getByText(/Formulir TUG-(3|10)/).first()).toBeVisible();
      await expect(page.locator("select").filter({ hasText: "GI E2E Surabaya" }).first()).toBeVisible();
      await page.getByRole("button", { name: /×|Tutup|Batal/ }).first().click();
    }
  });

  test("invalid GI rows stay hidden", async ({ isolatedPage: page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const gudang = JSON.parse(localStorage.getItem("warnoto_pln_gudang_v1"));
      const lokasi = JSON.parse(localStorage.getItem("warnoto_pln_lokasi_v4"));
      localStorage.setItem("warnoto_pln_gudang_v1", JSON.stringify([
        ...gudang,
        { id: "GI-E2E-INACTIVE", nama: "GI Inactive", __gi: true, __giFixture: true, giId: "INACTIVE", giActive: false, uptId: "UPT-SBY" },
      ]));
      localStorage.setItem("warnoto_pln_lokasi_v4", JSON.stringify(lokasi));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("GI Inactive", { exact: true })).toHaveCount(0);
  });

  test("GI stock opens internet map preview", async ({ isolatedPage: page }) => {
    await openApp(page);
    await openRoute(page, { tab: "stock", menuPath: ["Data Stok"], readySelector: ".stock-page" });
    const warehouseFilter = page.getByRole("combobox", { name: "Filter Gudang" });
    await expect(warehouseFilter.locator("option", { hasText: "GI E2E Surabaya" })).toHaveCount(1);
    await warehouseFilter.selectOption("GI-E2E-01");
    await page.locator(".stock-desktop-actions").getByTitle("Lihat lokasi GI di internet").click();
    await expect(page.getByRole("dialog", { name: "Preview lokasi GI" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Buka peta internet/ })).toHaveAttribute("href", /openstreetmap\.org/);
  });

  test("dashboard shows GI markers only when GI is enabled", async ({ isolatedPage: page }) => {
    await openApp(page);
    const map = page.locator(".dashboard-map-card");
    await expect(map).toBeVisible();
    const markers = map.locator(".leaflet-marker-icon");
    const giMarkers = markers.filter({ hasText: "⚡" });
    await expect(giMarkers).toHaveCount(0);

    const toggle = map.getByRole("checkbox", { name: "Tampilkan GI" });
    await toggle.check();
    await expect(giMarkers).toHaveCount(1); // active GI with coordinates; missing/inactive excluded
    await toggle.uncheck();
    await expect(giMarkers).toHaveCount(0);
  });
});
