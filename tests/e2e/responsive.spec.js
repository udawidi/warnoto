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

test.describe("ATTB mobile details", () => {
  test("KPI labels and pipeline cards remain fully readable", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, {
      tab:"attb",
      menuPath:["ATTB"],
      readySelector:".attb-page",
    });

    const report = await page.locator(".attb-page").evaluate(scope => {
      const metrics = [...scope.querySelectorAll(".operations-metric span")].map(node => {
        const rect = node.getBoundingClientRect();
        return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom };
      });
      const metricCollisions = [];
      for (let i = 0; i < metrics.length; i++) for (let j = i + 1; j < metrics.length; j++) {
        const overlapX = Math.min(metrics[i].right, metrics[j].right) - Math.max(metrics[i].left, metrics[j].left);
        const overlapY = Math.min(metrics[i].bottom, metrics[j].bottom) - Math.max(metrics[i].top, metrics[j].top);
        if (overlapX > 1 && overlapY > 1) metricCollisions.push([i, j]);
      }

      const pipeline = scope.querySelector(".attb-pipeline").getBoundingClientRect();
      const croppedCards = [...scope.querySelectorAll(".attb-stage-card,.attb-pipeline__end")]
        .map(node => node.getBoundingClientRect())
        .filter(rect => rect.left < pipeline.left - 1 || rect.right > pipeline.right + 1)
        .length;
      return { metricCollisions, croppedCards };
    });

    expect(report).toEqual({ metricCollisions:[], croppedCards:0 });
  });
});
