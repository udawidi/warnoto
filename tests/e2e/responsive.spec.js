const { test, expect } = require("./fixtures");
const { openApp, openRoute, assertResponsiveSurface, assertDashboardCardContentBounds } = require("./support/responsive");
const { SURFACES } = require("./route-manifest");

test.describe("WARNOTO responsive surface matrix", () => {
  test.describe.configure({ timeout:30_000 });
  for (const surface of SURFACES) {
    test(`${surface.slug} obeys the mobile semantic contract`, async ({ isolatedPage:page }, testInfo) => {
      await openApp(page);
      await openRoute(page, surface);
      await expect(page.locator(".app-shell")).toHaveAttribute("data-current-tab", surface.tab);

      const scope = surface.readySelector;
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path:testInfo.outputPath(`${surface.slug}.png`), fullPage:true });
      await assertResponsiveSurface(page, scope);
      if (surface.slug.startsWith("dashboard-")) await assertDashboardCardContentBounds(page);
      await expect(page).toHaveScreenshot(`${surface.slug}.png`, {
        fullPage:true,
        animations:"disabled",
        maxDiffPixelRatio:0.01,
      });
    });
  }
});

test.describe("Dashboard Manager mobile details", () => {
  test.use({
    actorProfile:{ id:"e2e-manager", name:"E2E Manager", username:"manager-e2e", role:"MANAGER", jabatan:"Manager", avatar:"MG", upt:"Surabaya", gudangIds:null },
    cloudOverrides:{
      pln_txns_v3:[
        { id:"TUG9-E2E-01", docType:"TUG9", status:"APPROVED", createdAt:1777507200000, namaPekerjaan:"Pemeliharaan Gardu Induk", docNumbers:{ tug9:"TUG-9/E2E/001" }, stockItems:[] },
        { id:"TUG3-MANAGER-E2E", docType:"TUG3", status:"PENDING", stage:"PENDING_MANAGER", requiredApprover:"MANAGER", createdAt:1784505600000, namaPekerjaan:"Review penerimaan material gardu induk", docNumbers:{ tug3:"TUG-3/E2E/007" } },
      ],
      pln_rencana_v1:[{ id:"PLAN-MANAGER-E2E", noKontrak:"KONTRAK/E2E/2026", supplier:"PT Mitra Energi", tanggalSerahTerima:"2026-07-28", items:[{ namaBarang:"Circuit Breaker 150 kV", jumlah:2, satuan:"SET", tanggalSerahTerima:"2026-07-28" }] }],
    },
  });

  test("network status and compact actions stay aligned", async ({ isolatedPage:page }) => {
    await openApp(page);
    await page.getByRole("tab", { name:/Overview Gudang/ }).click();
    await expect(page.locator(".dashboard-manager__upt-card")).toBeVisible();
    await assertResponsiveSurface(page, ".dashboard-manager");
    await assertDashboardCardContentBounds(page);

    const statusBoxes = await page.locator(".dashboard-manager-status").evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { width:Math.round(rect.width), height:Math.round(rect.height) };
    }));
    expect(new Set(statusBoxes.map(box => box.width)).size).toBe(1);
    expect(new Set(statusBoxes.map(box => box.height)).size).toBe(1);

    for (const name of ["Review", "Lihat Semua"]) {
      const button = page.getByRole("button", { name, exact:true }).first();
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeLessThanOrEqual(132);
    }

    await expect(page).toHaveScreenshot("dashboard-manager-detail.png", {
      fullPage:true,
      animations:"disabled",
      maxDiffPixelRatio:0.01,
    });
  });
});

test.describe("Data Stok mobile search", () => {
  test("searches item descriptions and keeps photo search available", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, {
      tab:"stock",
      menuPath:["Data Stok"],
      readySelector:".stock-page",
    });

    const photoSearch = page.getByRole("button", { name:"Cari barang berdasarkan foto" });
    await expect(photoSearch).toBeVisible();
    const photoSearchBox = await photoSearch.boundingBox();
    expect(photoSearchBox.height).toBe(44);
    expect(photoSearchBox.width).toBe(44);

    await page.getByRole("textbox", { name:"Cari Data Stok" }).fill("switchyard");
    await expect(page.locator(".stock-mobile-summary")).toHaveCount(1);
    await expect(page.locator(".stock-mobile-summary__head")).toContainText("Isolator Keramik 150 kV");
    await expect(page.locator(".stock-mobile-summary__description")).toContainText("Komponen isolasi switchyard");

    await photoSearch.click();
    await expect(page.getByText("Cari Barang dengan Foto", { exact:true })).toBeVisible();
    await expect(page.getByText("Ambil / Pilih Foto", { exact:true })).toBeVisible();
    await page.getByRole("button", { name:"Batal", exact:true }).click();

    await expect(page.getByRole("button", { name:"Lihat Detail", exact:true })).toHaveCount(0);
    await expect(page.getByText("Aksi Lainnya", { exact:true })).toHaveCount(0);
    const stockCard = page.locator(".mobile-card-table__row").first();
    const lokasiAction = stockCard.getByRole("button", { name:"Lokasi", exact:true });
    const kartuAction = stockCard.getByRole("button", { name:"Kartu Gantung Digital", exact:true });
    await expect(lokasiAction).toBeVisible();
    await expect(kartuAction).toBeVisible();
    await expect(lokasiAction).toHaveText("");
    const lokasiBox = await lokasiAction.boundingBox();
    const kartuBox = await kartuAction.boundingBox();
    expect(lokasiBox.width).toBe(44);
    expect(lokasiBox.height).toBe(44);
    expect(kartuBox.height).toBe(44);
    expect(kartuBox.width).toBe(128);
    await expect(kartuAction).toHaveText("Kartu Gantung");
    await stockCard.locator(".stock-mobile-summary").click();
    await expect(page.locator(".stock-detail-keterangan")).toContainText("Keterangan Barang:");
    await expect(page.locator(".stock-detail-keterangan")).toContainText("Komponen isolasi switchyard untuk jalur transmisi");
  });
});

test.describe("ATTB mobile details", () => {
  test("KPI labels and pipeline cards remain fully readable", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, {
      tab:"attb",
      menuPath:["ATTB"],
      readySelector:".attb-page",
    });

    const attbCards = page.locator(".attb-mobile-card");
    if (await attbCards.count()) {
      await expect(attbCards.first().locator("select")).toHaveCount(0);
    }

    const report = await page.locator(".attb-page").evaluate(scope => {
      const metrics = [...scope.querySelectorAll(".operations-metric span")].map(node => {
        const rect = node.getBoundingClientRect();
        return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom };
      });
      const metricOutOfBounds = [...scope.querySelectorAll(".operations-metric span")]
        .filter(node => {
          const rect = node.getBoundingClientRect();
          const parent = node.closest(".operations-metric").getBoundingClientRect();
          return rect.left < parent.left - 1 || rect.right > parent.right + 1 || rect.top < parent.top - 1 || rect.bottom > parent.bottom + 1;
        })
        .map(node => node.textContent.trim());
      const metricCollisions = [];
      for (let i = 0; i < metrics.length; i++) for (let j = i + 1; j < metrics.length; j++) {
        const overlapX = Math.min(metrics[i].right, metrics[j].right) - Math.max(metrics[i].left, metrics[j].left);
        const overlapY = Math.min(metrics[i].bottom, metrics[j].bottom) - Math.max(metrics[i].top, metrics[j].top);
        if (overlapX > 1 && overlapY > 1) metricCollisions.push([i, j]);
      }

      const pipelineElement = scope.querySelector(".attb-pipeline");
      const pipeline = pipelineElement.getBoundingClientRect();
      const croppedCards = [...scope.querySelectorAll(".attb-stage-card,.attb-pipeline__end")]
        .map(node => node.getBoundingClientRect())
        .filter(rect => rect.left < pipeline.left - 1 || rect.right > pipeline.right + 1)
        .length;
      const pipelineNodeOrder = [
        ...[...scope.querySelectorAll(".attb-stage-card")].map(node => node.classList.contains("is-source")
          ? node.querySelector(".attb-stage-code").textContent.trim()
          : node.querySelector(".attb-pipeline__step").textContent.trim()),
        scope.querySelector(".attb-pipeline__end .attb-stage-code").textContent.trim(),
      ];
      return {
        metricCollisions,
        metricOutOfBounds,
        croppedCards,
        pipelineNodeOrder,
        pipelineHorizontalOverflow:Math.max(0, Math.ceil(pipelineElement.scrollWidth - pipelineElement.clientWidth)),
      };
    });

    expect(report).toEqual({
      metricCollisions:[],
      metricOutOfBounds:[],
      croppedCards:0,
      pipelineNodeOrder:["SRC", "1", "2", "3", "4", "5", "KI"],
      pipelineHorizontalOverflow:0,
    });

    await page.getByRole("switch", { name:"Mode gelap" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".attb-pipeline__end")).toHaveCSS("background-color", "rgb(5, 46, 26)");
  });
});
