const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

test.describe("WARNOTO desktop preservation smoke", () => {
  test.describe("Data Stok photo detail", () => {
    test.use({
      cloudOverrides: {
        pln_stocks_v4: [{
          id:"ST-E2E-PHOTO-01", katalogId:"KAT-E2E-PHOTO-01", lokasiId:"",
          qty:1, minQty:0, price:0, jenisBarang:"Persediaan",
          fotoNameplate:"https://warnoto.com/storage/v1/object/public/stock-photos/e2e-nameplate.jpg",
          fotoKeseluruhan:"https://warnoto.com/storage/v1/object/public/stock-photos/e2e-overall.jpg",
        }],
        pln_katalog_v4: [{ id:"KAT-E2E-PHOTO-01", katalog:"E2E-PHOTO-01", name:"Material Foto E2E", satuan:"UNIT" }],
        pln_lokasi_v4: [],
      },
    });

    test("cache-first stock detail keeps remote Foto Nameplate", async ({ isolatedPage:page }) => {
      const directImageRequests = [];
      await page.route("https://warnoto.com/storage/**", async route => {
        directImageRequests.push(route.request().url());
        await route.abort("blockedbyclient");
      });
      await page.route("**/supabase/storage/**", route => route.fulfill({
        status:200, contentType:"image/jpeg", body:Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=", "base64")
      }));
      await openApp(page);
      const cacheShape = await page.evaluate(async () => {
        const { leanStocksForCache } = await import(new URL("/src/lib/stockCache.js", location.href).href);
        return leanStocksForCache([
          { id:"shape", fotoNameplate:"https://warnoto.com/nameplate.jpg", fotoKeseluruhan:"data:image/jpeg;base64,AAAA" },
          { id:"blob", fotoNameplate:"blob:stale-after-reload" },
        ]);
      });
      const resolverShape = await page.evaluate(async () => {
        const { resolveStockPhotoUrl } = await import(new URL("/src/lib/stockCache.js", location.href).href);
        return {
          canonical: resolveStockPhotoUrl("https://warnoto.com/storage/v1/object/public/stock-photos/a.jpg"),
          otherOrigin: resolveStockPhotoUrl("https://cdn.example.test/storage/a.jpg"),
          relative: resolveStockPhotoUrl("/storage/a.jpg"),
        };
      });
      expect(resolverShape.canonical).toBe("/supabase/storage/v1/object/public/stock-photos/a.jpg");
      expect(resolverShape.otherOrigin).toBe("https://cdn.example.test/storage/a.jpg");
      expect(resolverShape.relative).toBe("/storage/a.jpg");
      expect(cacheShape[0].fotoNameplate).toBe("https://warnoto.com/nameplate.jpg");
      expect(cacheShape[0].fotoKeseluruhan).toBeUndefined();
      expect(cacheShape[1].fotoNameplate).toBeUndefined();
      await openRoute(page, { tab:"stock", menuPath:["Data Stok"], readySelector:".stock-page" });
      await page.locator(".stock-card-table tbody tr").first().getByText("Material Foto E2E", { exact:true }).click();
      await expect(page.getByText(/^Foto Nameplate/)).toBeVisible();
      await expect(page.locator('img[alt="Foto Nameplate"]')).toBeVisible();
      await expect(page.locator('img[alt="Foto Keseluruhan"]')).toBeVisible();
      await expect(page.locator('img[alt="Foto Nameplate"]')).toHaveAttribute("src", /\/supabase\/storage\/v1\/object\/public\/stock-photos\/e2e-nameplate\.jpg$/);
      await expect(page.locator('img[alt="Foto Keseluruhan"]')).toHaveAttribute("src", /\/supabase\/storage\/v1\/object\/public\/stock-photos\/e2e-overall\.jpg$/);
      expect(directImageRequests).toEqual([]);
    });
  });

  test.describe("ATTB preview", () => {
  test.use({
    cloudOverrides: {
      pln_attb_v1: [{
        id:"ATTB-E2E-001", jenisAset:"MATERIAL", nomorAT:"E2E-MAT-001", description:"Material E2E", merkType:"TestCo",
        nilaiPerolehan:1250000, nilaiBuku:500000, kuantitas:"2", satuan:"UNIT", upt:"Surabaya", stage:"USULAN_AE1", approvalStatus:"DRAFT",
        foto:"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
        fotoKeseluruhan:"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
        fotoNameplate:"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
        gudangId:null, subGudangId:null, lokasiId:null,
      }],
    },
  });

  test("material row opens read-only preview without hijacking actions", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, { tab:"attb", menuPath:["ATTB"], readySelector:".attb-page" });

    const row = page.locator(".attb-table-wrap .attb-preview-trigger").first();
    await expect(row).toBeVisible();
    await row.click();
    const dialog = page.locator('[role="dialog"][aria-labelledby="attb-preview-title"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name:"E2E-MAT-001" })).toBeVisible();
    await expect(dialog.getByAltText("Foto Material E2E")).toBeVisible();
    await expect(dialog.getByAltText("Foto Nameplate Material E2E")).toBeVisible();
    await expect(dialog.getByText("Foto Keseluruhan", { exact:true })).toBeVisible();
    await expect(dialog.getByText("Foto Nameplate", { exact:true })).toBeVisible();
    await expect(dialog.getByText("Data Inti", { exact:true })).toBeVisible();
    await expect(dialog.getByText("Lokasi Penyimpanan", { exact:true })).toBeVisible();
    await expect(dialog.getByText("DRAFT", { exact:true })).toBeVisible();
    await expect(dialog.getByRole("button", { name:"Edit Data", exact:true })).toBeVisible();
    await dialog.getByRole("button", { name:"Tutup", exact:true }).click();
    await expect(dialog).toBeHidden();

    await row.getByRole("button", { name:"Edit" }).click();
    await expect(dialog).toBeHidden();
  });
  });

  test("dashboard remains contained at 1366px", async ({ isolatedPage:page }) => {
    await openApp(page);
    const metrics = await page.evaluate(() => ({
      scrollWidth:document.documentElement.scrollWidth,
      clientWidth:document.documentElement.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    await expect(page).toHaveScreenshot("dashboard-desktop.png", {
      fullPage:true, animations:"disabled", maxDiffPixelRatio:0.01,
    });
  });

  test("fleet registry remains contained at 1366px", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, {
      tab:"heavyEquipment",
      menuPath:["Alat Berat"],
      readySelector:".heavy-equipment-page",
    });
    const metrics = await page.evaluate(() => ({
      scrollWidth:document.documentElement.scrollWidth,
      clientWidth:document.documentElement.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    await expect(page).toHaveScreenshot("fleet-registry-desktop.png", {
      fullPage:true, animations:"disabled", maxDiffPixelRatio:0.01,
    });
  });

  test("maturity file upload remains disabled while canonical audit storage is prepared", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, {
      tab:"maturity",
      menuPath:["Penilaian Maturity"],
      readySelector:'.app-shell[data-current-tab="maturity"]',
    });

    await page.getByRole("button", { name:"Pelaksanaan Audit", exact:true }).click();
    await page.getByRole("button", { name:"+ Audit Baru", exact:true }).first().click();
    await page.locator(".maturity-aspect-row").first().click();
    await expect(page.locator('input[type="file"]:not(:disabled)')).toHaveCount(0);
    await expect(page.getByText("Upload bukti sementara nonaktif", { exact:true }).first()).toBeVisible();
  });
});
