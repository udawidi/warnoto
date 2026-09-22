const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

test.describe("WARNOTO desktop preservation smoke", () => {
  test.describe("canonical derived TUG-8 draft", () => {
    test.use({
      expectedConsoleErrorPrefixes: ["commitNewTxn gagal:"],
      cloudOverrides: {
        pln_txns_v3: [{
          id:"DRAFT-TUG8-E2E", docType:"TUG8", stage:"DRAFT_TUG8", status:"DRAFT",
          draftLabel:"DRAFT — nomor resmi saat diajukan", namaPekerjaan:"Pengiriman material E2E",
          lokasiPekerjaan:"UPT Surabaya", unitTujuan:"ULTG E2E", keteranganBarang:"Material E2E",
          uptId:"UPT-SBY",
          penerimaNama:"Penerima E2E", fotoMaterial:[], fotoKendaraan:null, fotoSimKtp:null,
          fotoSuratPengembalian:null, nopol:"", namaPengemudi:"", simKtp:"", satpamId:"",
          stockItems:[{ stockId:"ST-E2E-01", qty:1 }], docNumbers:undefined,
        }],
      },
    });

    test("draft without docNumbers renders and opens canonical completion form", async ({ isolatedPage:page }) => {
      await openApp(page);
      await openRoute(page, { tab:"approval", menuPath:["Approval"], readySelector:".approval-queue" });
      const card = page.locator(".approval-card").filter({ hasText:"Pengiriman material E2E" });
      await expect(card).toBeVisible();
      await expect(card.getByText("DRAFT — nomor resmi saat diajukan", { exact:true })).toBeVisible();
      await card.getByRole("button", { name:"Lengkapi & Ajukan TUG-8", exact:true }).click();
      const dialog = page.locator('[role="dialog"]').filter({ hasText:"DRAFT — nomor resmi saat diajukan" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("DRAFT — nomor resmi saat diajukan", { exact:true })).toBeVisible();
    });

    test("canonical submit fails closed and keeps draft form open", async ({ isolatedPage:page }) => {
      await openApp(page);
      await openRoute(page, { tab:"approval", menuPath:["Approval"], readySelector:".approval-queue" });
      const card = page.locator(".approval-card").filter({ hasText:"Pengiriman material E2E" });
      await card.getByRole("button", { name:"Lengkapi & Ajukan TUG-8", exact:true }).click();
      const dialog = page.locator('[role="dialog"]').filter({ hasText:"DRAFT — nomor resmi saat diajukan" });
      await expect(dialog).toBeVisible();
      const before = await page.evaluate(() => localStorage.getItem("warnoto_pln_stocks_v4"));
      await dialog.getByRole("button", { name:"Lengkapi & Ajukan TUG-8", exact:true }).click();
      await expect(dialog).toBeVisible();
      await expect(page.getByText(/Penyimpanan transaksi TUG canonical belum tersedia/)).toBeVisible();
      await expect(page.evaluate(() => localStorage.getItem("warnoto_pln_stocks_v4"))).resolves.toBe(before);
    });
  });

  test.describe("TUG route persistence", () => {
    test.use({ preserveSessionStorageOnReload:true });

    test("refresh keeps the last TUG submenu active", async ({ isolatedPage:page }) => {
      test.setTimeout(60_000);
      await openApp(page);
      await openRoute(page, {
        tab:"transaction",
        menuPath:["TUG", "Barang Masuk"],
        actions:[{ role:"tab", name:/Barang Kembali/ }],
        readySelector:".tug-page",
      });
      const tug10Tab = page.getByRole("tab", { name:/Barang Kembali/ });
      await expect(tug10Tab).toHaveAttribute("aria-selected", "true");

      await page.reload({ waitUntil:"domcontentloaded" });
      await expect(page.locator(".app-shell")).toHaveAttribute("data-current-tab", "transaction");
      await expect(page.locator(".tug-page")).toBeVisible();
      await expect(page.getByRole("tab", { name:/Barang Kembali/ })).toHaveAttribute("aria-selected", "true");
    });
  });

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
      const stockRow = page.locator(".stock-card-table tbody tr").first();
      await stockRow.locator(".mobile-card-table__title").click();
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
    await openRoute(page, { tab:"attb", menuPath:["MRWI"], readySelector:".attb-page" });

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
    await expect(dialog).toBeVisible();
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

  test("maturity audit exposes a Drive-backed evidence picker", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, {
      tab:"maturity",
      menuPath:["Penilaian Maturity"],
      readySelector:'.app-shell[data-current-tab="maturity"]',
    });

    await page.getByRole("button", { name:"Pelaksanaan Audit", exact:true }).click();
    await page.getByRole("button", { name:"+ Audit Baru", exact:true }).first().click();
    await expect(page.getByText("Proyeksi Draft", { exact:true })).toBeVisible();
    await page.locator(".maturity-aspect-row").first().click();
    await expect(page.getByRole("button", { name:/Analisa AI/ }).first()).toBeDisabled();
    await expect(page.getByText("Belum terunggah (7)", { exact:true })).toBeVisible();
    await expect(page.locator('input[type="file"]:not(:disabled)')).toHaveCount(9);
    await page.getByText("Lokasi folder & format file", { exact:true }).first().click();
    await expect(page.getByText(/Maks\. 25 MB per berkas/).first()).toBeVisible();
    await expect(page.getByRole("button", { name:"Sinkronkan Drive", exact:false })).toHaveCount(0);
    await expect(page.getByText(/Rincian sumber PROGNOSA/)).toHaveCount(0);
    await expect(page.getByRole("tab", { name:"Gudang Persediaan", exact:true })).toBeVisible();
    await expect(page.getByRole("tab", { name:"Gudang ATTB/MRWI", exact:true })).toBeVisible();

    await page.getByRole("button", { name:"Kembali ke Daftar Aspek", exact:true }).click();
    await page.getByRole("button", { name:"Sarana Prasarana", exact:true }).click();
    await page.locator(".maturity-aspect-row").filter({ hasText:"3.4" }).click();
    const manualCriteria = page.getByText("Yang harus diperiksa checker", { exact:true }).locator("xpath=..");
    await expect(manualCriteria.locator('ol[type="a"] > li')).toHaveCount(3);

    await page.getByRole("button", { name:"Kembali ke Daftar Aspek", exact:true }).click();
    await page.getByRole("button", { name:"K3", exact:true }).click();
    await page.locator(".maturity-aspect-row").filter({ hasText:"4.3" }).click();
    await expect(page.getByText(/Area gudang tertutup yang termonitor CCTV/).first()).toBeVisible();
    await expect(page.getByText("Cluster ATTB Usul Hapus", { exact:true })).toBeVisible();
  });

  test.describe("Form 5S UIT reviewer", () => {
    test.use({ actorProfile:{ id:"e2e-uit", name:"E2E UIT", username:"e2e-uit", role:"ADMIN_UIT", jabatan:"Admin UIT", avatar:"EU", upt:"", uptId:null, uitId:"UIT-JBM", gudangIds:null } });

    test("exposes an empty persistent-history view without a database fixture", async ({ isolatedPage:page }) => {
      await openApp(page);
      await openRoute(page, {
        tab:"maturity5s",
        menuPath:["Form Pengisian 5S"],
        readySelector:'.app-shell[data-current-tab="maturity5s"]',
      });

      await expect(page.getByText("Ringkasan UPT", { exact:true })).toBeVisible();
      const uptFilter = page.getByRole("combobox", { name:"Filter UPT" });
      await expect(uptFilter).toBeVisible();
      await uptFilter.selectOption("UPT-MLG");
      await expect(uptFilter).toHaveValue("UPT-MLG");
      await expect(page.getByRole("button", { name:"Pengisian 5S", exact:true })).toHaveCount(0);
      await expect(page.getByText("History Audit 5S", { exact:true }).last()).toBeVisible();
      await expect(page.getByText("Belum ada hasil Form 5S untuk filter ini.", { exact:true })).toBeVisible();
      await expect(page.locator('.app-shell[data-current-tab="maturity"]')).toHaveCount(0);
    });
  });
});
