const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

async function openTug(page, { tabName, buttonName, formName }) {
  await openApp(page);
  await openRoute(page, { tab:"transaction", menuPath:["TUG", "Barang Masuk"], readySelector:".tug-page" });
  if (tabName) await page.getByRole("tab", { name:tabName }).click();
  await page.getByRole("button", { name:buttonName, exact:true }).click();
  await expect(page.getByText(formName)).toBeVisible();
}

async function assertMaraOnlyNewItem(page, formName, newItemButton) {
  await page.getByRole("button", { name:newItemButton, exact:false }).click();
  const nameInput = page.locator('input[placeholder="Pilih dari MARA"]');
  const catalogInput = page.locator('input[placeholder="Dari MARA"]');
  await expect(nameInput).toHaveCount(1);
  await expect(catalogInput).toHaveCount(1);
  await expect(nameInput).toHaveAttribute("readonly", "");
  await expect(catalogInput).toHaveAttribute("readonly", "");
  await expect(page.getByText("Lepas kunci")).toHaveCount(0);
  await expect(page.getByText(/isi manual di bawah/)).toHaveCount(0);
  await page.getByRole("button", { name:/Ajukan TUG-(3|10)/ }).click();
  await expect(page.getByText(formName)).toBeVisible();
}

test.describe("TUG MARA new-item guard", () => {
  test("TUG-3/4 new item cannot use manual identity", async ({ isolatedPage:page }) => {
    await openTug(page, { buttonName:"Terima Barang Baru", formName:/Formulir TUG-3/ });
    await assertMaraOnlyNewItem(page, /Formulir TUG-3/, "Catalog Baru");
  });

  test("TUG-10 new item cannot use manual identity", async ({ isolatedPage:page }) => {
    await openTug(page, { tabName:/TUG-10 Barang Kembali/, buttonName:"Catat Barang Kembali", formName:/Formulir TUG-10/ });
    await assertMaraOnlyNewItem(page, /Formulir TUG-10/, "Barang Baru");
  });
});
