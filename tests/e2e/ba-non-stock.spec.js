const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

test.describe("BA Non Stock / Pinjam", () => {
  test("form manual tersedia tanpa pemilih Data Stok", async ({ isolatedPage:page }) => {
    test.setTimeout(90_000);
    await openApp(page);
    await openRoute(page, { tab:"transaction", menuPath:["TUG", "Barang Keluar"], readySelector:".tug-page" });
    await page.getByRole("tab", { name:/Non Stock \/ Pinjam/ }).click();
    await page.getByRole("button", { name:/Buat BA Non Stock/ }).click();
    const dialog = page.getByRole("dialog", { name:"Form BA Non Stock" });
    await expect(dialog).toBeVisible();
    for (const section of ["DATA BERITA ACARA", "DATA PENERIMA", "MATERIAL NON STOCK / PINJAM (1)", "EVIDEN FOTO"]) {
      await expect(dialog.getByText(section, { exact:true })).toBeVisible();
    }
    await expect(dialog.getByLabel("Nama material")).toBeVisible();
    await expect(dialog.getByLabel("Qty")).toBeVisible();
    await expect(dialog.getByLabel("Satuan")).toBeVisible();
    await expect(dialog.getByLabel("Keterangan")).toBeVisible();
    await expect(dialog.getByText("Foto label / packing list")).toBeVisible();
    await expect(dialog.getByText("Foto material sudah dimuat")).toBeVisible();
    await expect(dialog.getByText(/tidak mengurangi Data Stok/)).toBeVisible();
    await expect(dialog.getByRole("button", { name:"Batal", exact:true })).toBeVisible();
    await expect(dialog.getByRole("button", { name:"Simpan Draft", exact:true })).toBeVisible();
    await expect(dialog.getByRole("button", { name:"Ajukan ke TL", exact:true })).toBeVisible();
    await expect(dialog.locator('input[placeholder*="katalog" i], input[placeholder*="stok" i]')).toHaveCount(0);
    const overflow = await dialog.evaluate(element => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
