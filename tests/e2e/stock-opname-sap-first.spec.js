const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");
const { SURFACES } = require("./route-manifest");

const STOCK_OPNAME = SURFACES.find(surface => surface.slug === "stock-opname");

test.describe("Stock Opname SAP-first responsive", () => {
  test("riwayat terpisah tanpa menghapus hitungan draft aktif", async ({ isolatedPage: page }) => {
    await openApp(page);
    await openRoute(page, STOCK_OPNAME);
    await page.getByRole("button", { name: /Lanjutkan draft/ }).click();
    const qtyInput = page.locator('input[type="number"]').first();
    await qtyInput.fill("7");
    await expect(page.getByRole("button", { name: /Batal/ })).toHaveCount(1);
    await page.getByRole("button", { name: "🕘 Riwayat" }).click();
    await expect(page.getByText("Riwayat Opname", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "📊 Riwayat Stock Count" }).click();
    await expect(page.getByText(/Riwayat Stock Count/).first()).toBeVisible();
    await page.getByRole("button", { name: "📋 Stock Opname" }).click();
    await expect(qtyInput).toHaveValue("7");
  });

  test("Edit draft dari Riwayat membuka layar hitung", async ({ isolatedPage: page }) => {
    await openApp(page);
    await openRoute(page, STOCK_OPNAME);
    await page.getByRole("button", { name: "🕘 Riwayat" }).click();
    await page.getByRole("button", { name: "🔍 Edit" }).first().click();
    await expect(page.locator(".opname-panel")).toBeVisible();
    await expect(page.locator('.opname-panel input[type="number"]').first()).toBeVisible();
  });

  test("QR blok publik invalid tampil tanpa layar login", async ({ isolatedPage: page }) => {
    await page.goto("/?loc=TEST-BLOCK#t=invalid");
    await expect(page.getByText("Data blok tidak tersedia")).toBeVisible();
    await expect(page.getByText(/Token QR blok tidak valid/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Masuk/ })).toHaveCount(0);
  });

  test("stage rail, kategori, dan action tidak overflow di viewport target", async ({ isolatedPage: page }) => {
    await openApp(page);
    await openRoute(page, STOCK_OPNAME);
    await page.getByRole("button", { name: /Lanjutkan draft/ }).click();
    await expect(page.locator(".opname-stage-rail")).toBeVisible();
    await expect(page.getByRole("button", { name: /Persediaan/ }).first()).toBeVisible();
    const actionHeights = await page.locator(".opname-action-bar > button").evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().height)));
    expect(actionHeights.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...actionHeights) - Math.min(...actionHeights), "paired action height delta").toBeLessThanOrEqual(1);

    for (const width of [320, 360, 390, 412, 768, 1024, 1440]) {
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
    const next = page.getByRole("button", { name: /Lanjut Non-SAP/ });
    await expect(next).toHaveCount(0);
    await qtyInputs.nth(0).fill("10");
    await expect(next).toHaveCount(0);
    await qtyInputs.nth(1).fill("4");
    await expect(next).toBeVisible();
    await qtyInputs.nth(0).fill("");
    await expect(next).toHaveCount(0);
    await expect(page.getByText("Belum dihitung").first()).toBeVisible();
    await qtyInputs.nth(0).fill("10");
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
