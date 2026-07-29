const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

const ADMIN = { id:"e2e-admin", name:"E2E Admin", username:"admin-e2e", role:"ADMIN", jabatan:"Admin Gudang", avatar:"AD", upt:"Surabaya", gudangIds:null };
const TL = { id:"e2e-tl", name:"E2E TL", username:"tl-e2e", role:"TL", jabatan:"Team Leader", avatar:"TL", upt:"Surabaya", gudangIds:null };
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwG6WQAAAABJRU5ErkJggg==", "base64");

async function openFleetAsDemo(page) {
  // E2E sengaja tanpa Supabase. Mode demo mempertahankan seluruh alur UI/save
  // di memori tanpa request ke backend produksi, termasuk foto yang belum diunggah.
  await page.addInitScript(() => sessionStorage.setItem("warnoto_demo", "1"));
  await openApp(page);
  await openRoute(page, { tab:"heavyEquipment", menuPath:["Alat Berat"], readySelector:".heavy-equipment-page" });
}

test.describe("Alat Berat — otorisasi dan kontrak simpan", () => {
  test.describe("Admin", () => {
    test.use({ actorProfile:ADMIN });

    test("dapat menambah alat dan mengisi seluruh field operasional", async ({ isolatedPage:page }) => {
      await openFleetAsDemo(page);
      await page.getByRole("button", { name:"+ Tambah Alat Berat", exact:true }).click();
      const dialog = page.getByRole("dialog", { name:"Tambah Alat Berat" });
      await expect(dialog).toBeVisible();
      for (const label of ["UPT","Lokasi","Nama","Jenis","Merk/Type","Kapasitas","No. Seri","Tahun","Kondisi","Surat Izin Alat"]) {
        await expect(dialog.getByLabel(label, { exact:true })).toBeVisible();
      }
      await dialog.getByLabel("UPT", { exact:true }).fill("Surabaya");
      await dialog.getByLabel("Lokasi", { exact:true }).fill("Gudang E2E");
      await dialog.getByLabel("Nama", { exact:true }).fill("Forklift Tambahan E2E");
      await dialog.getByLabel("Jenis", { exact:true }).fill("Angkat Angkut");
      await dialog.getByLabel("Merk/Type", { exact:true }).fill("TestLift");
      await dialog.getByLabel("Kapasitas", { exact:true }).fill("2 TON");
      await dialog.getByLabel("No. Seri", { exact:true }).fill("E2E-NEW-01");
      await dialog.getByLabel("Tahun", { exact:true }).fill("2026");
      await dialog.getByLabel("Kondisi", { exact:true }).fill("Baik");
      await dialog.getByLabel("Surat Izin Alat", { exact:true }).fill("SIA-E2E-01");
      await dialog.locator("select").selectOption("LAYAK");
      await dialog.getByRole("button", { name:/Simpan/ }).click();
      await expect(dialog).toBeHidden();
      const card = page.locator(".equipment-card", { hasText:"Forklift Tambahan E2E" });
      await expect(card).toContainText("Gudang E2E");
      await expect(card).toContainText("TestLift");
      await expect(card).toContainText("E2E-NEW-01");
      await expect(card).toContainText("SIA-E2E-01");
    });

    test("format foto tidak didukung ditolak tanpa menghapus isian form", async ({ isolatedPage:page }) => {
      await openFleetAsDemo(page);
      await page.getByRole("button", { name:"Edit data alat", exact:true }).first().click();
      const dialog = page.getByRole("dialog", { name:"Edit Alat Berat" });
      await dialog.getByLabel("Nama", { exact:true }).fill("Nama tetap tersimpan");
      await dialog.locator('input[type="file"]').setInputFiles({
        name:"alat.heic",
        mimeType:"image/heic",
        buffer:Buffer.from("unsupported-heic"),
      });
      await expect(page.getByText(/Format foto tidak didukung/)).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Nama", { exact:true })).toHaveValue("Nama tetap tersimpan");
    });

    test("gagal upload Storage mempertahankan modal, foto, dan perubahan data", async ({ isolatedPage:page }) => {
      // Tanpa mode demo, Supabase sengaja tidak dibentuk oleh E2E_MODE. Foto
      // tetap diproses browser, lalu upload gagal secara aman tanpa menyentuh production.
      await openApp(page);
      await openRoute(page, { tab:"heavyEquipment", menuPath:["Alat Berat"], readySelector:".heavy-equipment-page" });
      await page.getByRole("button", { name:"Edit data alat", exact:true }).first().click();
      const dialog = page.getByRole("dialog", { name:"Edit Alat Berat" });
      await dialog.getByLabel("Nama", { exact:true }).fill("Nama jangan hilang saat upload gagal");
      await dialog.locator('input[type="file"]').setInputFiles({
        name:"alat.png",
        mimeType:"image/png",
        buffer:ONE_PIXEL_PNG,
      });
      await expect(dialog.locator("img")).toBeVisible();
      await dialog.getByRole("button", { name:/Simpan/ }).click();
      await expect(page.getByText(/Gagal upload foto ke server/)).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("img")).toBeVisible();
      await expect(dialog.getByLabel("Nama", { exact:true })).toHaveValue("Nama jangan hilang saat upload gagal");
    });

    test("foto valid tetap memungkinkan Admin memperbarui data alat", async ({ isolatedPage:page }) => {
      await openFleetAsDemo(page);
      await page.getByRole("button", { name:"Edit data alat", exact:true }).first().click();
      const dialog = page.getByRole("dialog", { name:"Edit Alat Berat" });
      await dialog.getByLabel("Nama", { exact:true }).fill("Truck Crane Foto Valid");
      await dialog.locator('input[type="file"]').setInputFiles({
        name:"alat.png",
        mimeType:"image/png",
        buffer:ONE_PIXEL_PNG,
      });
      await expect(dialog.locator("img")).toBeVisible();
      await dialog.getByRole("button", { name:/Simpan/ }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator(".equipment-card", { hasText:"Truck Crane Foto Valid" })).toBeVisible();
    });
  });

  test.describe("TL", () => {
    test.use({ actorProfile:TL });

    test("tidak melihat tombol tambah dan hanya dapat mengubah status/foto", async ({ isolatedPage:page }) => {
      await openFleetAsDemo(page);
      await expect(page.getByRole("button", { name:"+ Tambah Alat Berat", exact:true })).toHaveCount(0);
      await page.getByRole("button", { name:"Edit data alat", exact:true }).first().click();
      const dialog = page.getByRole("dialog", { name:"Edit Alat Berat" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("UPT", { exact:true })).toHaveCount(0);
      await expect(dialog.getByLabel("Nama", { exact:true })).toHaveCount(0);
      await expect(dialog.locator('input[type="file"]')).toHaveCount(1);
      await dialog.locator("select").selectOption("MAINTENANCE");
      await dialog.getByRole("button", { name:/Simpan/ }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator(".equipment-card").first()).toContainText("Maintenance");
    });
  });

  test.describe("gagal sinkron", () => {
    test.use({ actorProfile:ADMIN });

    test("modal tambah tetap terbuka agar input tidak hilang", async ({ isolatedPage:page }) => {
      // Tidak memasang warnoto_demo: fixture memutus Supabase, sehingga upsert
      // dengan sengaja gagal tanpa ada koneksi atau data self-host yang disentuh.
      await openApp(page);
      await openRoute(page, { tab:"heavyEquipment", menuPath:["Alat Berat"], readySelector:".heavy-equipment-page" });
      await page.getByRole("button", { name:"+ Tambah Alat Berat", exact:true }).click();
      const dialog = page.getByRole("dialog", { name:"Tambah Alat Berat" });
      await dialog.getByLabel("UPT", { exact:true }).fill("Surabaya");
      await dialog.getByLabel("Lokasi", { exact:true }).fill("Gudang E2E gagal sync");
      await dialog.getByLabel("Nama", { exact:true }).fill("Forklift Jangan Hilang");
      await dialog.getByRole("button", { name:/Simpan/ }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Nama", { exact:true })).toHaveValue("Forklift Jangan Hilang");
    });
  });

  test("jalur sinkronisasi alat berat memakai upsert baris yang berubah", () => {
    // Ini kontrak kode sengaja statis: E2E_MODE membuat Supabase null untuk
    // menjamin test tidak dapat menyentuh self-host production.
    const app = fs.readFileSync(path.resolve(__dirname, "../..", "App.jsx"), "utf8");
    const sync = fs.readFileSync(path.resolve(__dirname, "../..", "src/lib/masterSync.js"), "utf8");
    expect(app).toContain('syncMasterTableRows("heavy_equipment", heHint, e => ({ upt: e.upt || null }))');
    expect(app).toContain("{heavyEquipmentChangedRows:[item]}");
    expect(app).toContain("{heavyEquipmentChangedRows:[next.find(eq=>eq.id===equipmentId)]}");
    expect(app).toContain('if (_isDataUrl(item.foto) && !isDemoMode())');
    expect(app).toContain('"tug-photos", `alat-berat/${item.id}.jpg`');
    expect(sync).toContain('supabase.from(table).upsert(upsertRows, { onConflict: "id" })');
  });
});
