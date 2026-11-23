const { test, expect, CLOUD_FIXTURES } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

const approvedTug = {
  ...CLOUD_FIXTURES.pln_txns_v3[0], id: "approved-tug8-preview",
  docType: "TUG8", docNumbers: { tug8: "316-PREVIEW", sj: "316.SJ/FIXTURE", ba: "316.BA/FIXTURE" }, fotoKendaraan: "/preview-kendaraan.png",
};
test.use({ cloudOverrides: { pln_txns_v3: [approvedTug] } });

test("approved TUG-8 stays readable and retries the failed attachment in place", async ({ isolatedPage: page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route("**/preview-kendaraan.png", async route => {
    if (++requests === 1) {
      await pending;
      return route.fulfill({ contentType: "image/png", body: "invalid image" });
    }
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' });
  });
  await openApp(page);
  await openRoute(page, { tab: "transaction", menuPath: ["TUG", "Barang Keluar"], readySelector: ".tug-page" });
  await page.getByRole("tab", { name: /TUG-8/ }).click();
  await page.getByRole("button", { name: /Pratinjau Dokumen TUG-8/ }).click();
  const body = page.frameLocator('iframe[title="Document Preview"]').locator("body");
  const print = page.getByRole("button", { name: /Print \/ Save PDF/ });
  const download = page.getByRole("button", { name: /Unduh File/ });
  await expect(body).toContainText(approvedTug.namaPekerjaan);
  await expect(body).toContainText(approvedTug.docNumbers.sj);
  await expect(body).toContainText(approvedTug.docNumbers.ba);
  await body.evaluate(el => { el.dataset.originalFrame = "true"; });
  await expect(print).toBeDisabled();
  await expect(download).toBeDisabled();
  release();
  await expect(page.getByRole("status").filter({ hasText: "Gagal memuat" })).toContainText("Foto Kendaraan");
  await page.getByRole("button", { name: "Coba lagi", exact: true }).click();
  await expect(print).toBeEnabled();
  await expect(download).toBeEnabled();
  await expect(body).toHaveAttribute("data-original-frame", "true");
  expect(requests).toBe(2);
});


test.describe("TUG without photos", () => {
  test.use({ cloudOverrides: { pln_txns_v3: [{ ...approvedTug, fotoKendaraan: null }] } });
  test("approved document without attachments prints immediately after the master data loads", async ({ isolatedPage: page }) => {
    await openApp(page);
    await openRoute(page, { tab: "transaction", menuPath: ["TUG", "Barang Keluar"], readySelector: ".tug-page" });
    await page.getByRole("tab", { name: /TUG-8/ }).click();
    await page.getByRole("button", { name: /Pratinjau Dokumen TUG-8/ }).click();
    const frame = page.frameLocator('iframe[title="Document Preview"]');
    const body = frame.locator("body");
    await expect(body).toContainText(approvedTug.docNumbers.sj);
    await body.evaluate(el => { el.ownerDocument.defaultView.print = () => { el.dataset.printed = "true"; }; });
    await page.getByRole("button", { name: /Print \/ Save PDF/ }).click();
    await expect(body).toHaveAttribute("data-printed", "true");
  });
});
