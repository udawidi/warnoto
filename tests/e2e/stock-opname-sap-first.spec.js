const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");
const { SURFACES } = require("./route-manifest");

const STOCK_OPNAME = SURFACES.find(surface => surface.slug === "stock-opname");

test.describe("Stock Opname SAP-first responsive", () => {
  test("stage rail, kategori, dan action tidak overflow di viewport target", async ({ isolatedPage: page }) => {
    await openApp(page);
    await openRoute(page, STOCK_OPNAME);
    await page.getByRole("button", { name: /Lanjutkan draft/ }).click();
    await expect(page.locator(".opname-stage-rail")).toBeVisible();
    await expect(page.getByRole("button", { name: /Persediaan/ }).first()).toBeVisible();
    const actionHeights = await page.locator(".opname-action-bar > button").evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().height)));
    expect(actionHeights.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...actionHeights) - Math.min(...actionHeights), "paired action height delta").toBeLessThanOrEqual(1);

    for (const width of [360, 390, 412, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        rail: document.querySelector(".opname-stage-rail")?.getBoundingClientRect().width || 0,
        segment: document.querySelector(".opname-category-segment")?.getBoundingClientRect().width || 0,
      }));
      expect(metrics.scroll, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewport + 1);
      expect(metrics.rail, `stage rail overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewport + 1);
      expect(metrics.segment, `category segment overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewport + 1);
    }
  });

  test("aksi Lanjut Non-SAP membuat satu child lalu klik ulang me-resume child yang sama", async ({ isolatedPage: page }) => {
    await openApp(page);
    await openRoute(page, STOCK_OPNAME);
    await page.getByRole("button", { name: /Lanjutkan draft/ }).click();
    const qtyInputs = page.locator('input[type="number"]');
    await expect(qtyInputs).toHaveCount(2);
    await qtyInputs.nth(0).fill("10");
    await qtyInputs.nth(1).fill("4");
    const next = page.getByRole("button", { name: /Lanjut Non-SAP/ });
    await expect(next).toBeVisible();
    await next.click();
    await expect(page.getByText(/Opname Non-SAP/)).toBeVisible();
    await page.getByRole("button", { name: /Batal/ }).last().click();

    const sapDraft = page.getByRole("button", { name: /\u2014 SAP \(2 item\)$/ });
    await expect(sapDraft).toBeVisible();
    await sapDraft.click();
    await page.getByRole("button", { name: /Lanjut Non-SAP/ }).click();
    await expect(page.getByText(/Opname Non-SAP/)).toBeVisible();
  });
});
