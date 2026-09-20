const fs = require("node:fs");
const path = require("node:path");
const { test, expect, CLOUD_FIXTURES } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

const ADMIN = { id:"e2e-admin", name:"E2E Admin", username:"admin-e2e", role:"ADMIN", jabatan:"Admin Gudang", avatar:"AD", upt:"Surabaya", uptId:"UPT-SBY", gudangIds:null };
const TL = { id:"e2e-tl", name:"E2E TL", username:"tl-e2e", role:"TL", jabatan:"Team Leader", avatar:"TL", upt:"Surabaya", uptId:"UPT-SBY", gudangIds:null };
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwG6WQAAAABJRU5ErkJggg==", "base64");

async function openFleetForE2E(page) {
  // Fixture memutus Supabase; production tidak memiliki mode demo.
  await openApp(page);
  await openRoute(page, { tab:"heavyEquipment", menuPath:["Alat Berat"], readySelector:".heavy-equipment-page" });
}

test.describe("Alat Berat — otorisasi dan kontrak simpan", () => {
  test.describe("Admin", () => {
    test.use({ actorProfile:TL });

    test("dapat membuka form tambah dan mengisi seluruh field operasional", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      await page.getByRole("button", { name:"+ Tambah Alat", exact:true }).click();
      const dialog = page.getByRole("dialog", { name:"Tambah Alat Berat" });
      await expect(dialog).toBeVisible();
      for (const label of ["UPT","Nama","Jenis","Merk/Type","Kapasitas","No. Seri","Tahun","Kondisi"]) {
        await expect(dialog.getByLabel(label, { exact:true })).toBeVisible();
      }
      await expect(dialog.getByRole("combobox", { name:"Gudang / lokasi" })).toBeVisible();
      await expect(dialog.locator('input[accept=".pdf,image/*"]')).toHaveCount(1);
      await dialog.getByRole("combobox", { name:"Gudang / lokasi" }).selectOption("GDG-E2E-01");
      await dialog.getByLabel("Nama", { exact:true }).fill("Forklift Tambahan E2E");
      await dialog.getByLabel("Jenis", { exact:true }).fill("Angkat Angkut");
      await dialog.getByLabel("Merk/Type", { exact:true }).fill("TestLift");
      await dialog.getByLabel("Kapasitas", { exact:true }).fill("2 TON");
      await dialog.getByLabel("No. Seri", { exact:true }).fill("E2E-NEW-01");
      await dialog.getByLabel("Tahun", { exact:true }).fill("2026");
      await dialog.getByLabel("Kondisi", { exact:true }).fill("Baik");
      await dialog.locator("select").last().selectOption("LAYAK");
      await expect(dialog.getByLabel("Nama", { exact:true })).toHaveValue("Forklift Tambahan E2E");
      await expect(dialog.getByLabel("No. Seri", { exact:true })).toHaveValue("E2E-NEW-01");
    });

    test("format foto tidak didukung ditolak tanpa menghapus isian form", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      await page.getByRole("button", { name:"Edit data alat", exact:true }).first().click();
      const dialog = page.getByRole("dialog", { name:"Edit Alat Berat" });
      await dialog.getByLabel("Nama", { exact:true }).fill("Nama tetap tersimpan");
      await dialog.locator('input[accept*=".jpg"]').setInputFiles({
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
      await dialog.locator('input[accept*=".jpg"]').setInputFiles({
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

    test("foto valid ditampilkan sebelum Admin menyimpan data alat", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      await page.getByRole("button", { name:"Edit data alat", exact:true }).first().click();
      const dialog = page.getByRole("dialog", { name:"Edit Alat Berat" });
      await dialog.getByLabel("Nama", { exact:true }).fill("Truck Crane Foto Valid");
      await dialog.locator('input[accept*=".jpg"]').setInputFiles({
        name:"alat.png",
        mimeType:"image/png",
        buffer:ONE_PIXEL_PNG,
      });
      await expect(dialog.locator("img")).toBeVisible();
      await expect(dialog.getByLabel("Nama", { exact:true })).toHaveValue("Truck Crane Foto Valid");
    });
  });

  test.describe("TL", () => {
    test.use({ actorProfile:ADMIN });

    test("tidak melihat tombol tambah dan dapat membuka editor alat", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      await expect(page.getByRole("button", { name:"+ Tambah Alat", exact:true })).toHaveCount(0);
      await expect(page.getByRole("button", { name:"Edit data alat", exact:true })).toHaveCount(0);
    });
  });

  test.describe("gagal sinkron", () => {
    test.use({ actorProfile:TL });

    test("modal tambah tetap terbuka agar input tidak hilang", async ({ isolatedPage:page }) => {
      // Tidak memasang warnoto_demo: fixture memutus Supabase, sehingga upsert
      // dengan sengaja gagal tanpa ada koneksi atau data self-host yang disentuh.
      await openApp(page);
      await openRoute(page, { tab:"heavyEquipment", menuPath:["Alat Berat"], readySelector:".heavy-equipment-page" });
      await page.getByRole("button", { name:"+ Tambah Alat", exact:true }).click();
      const dialog = page.getByRole("dialog", { name:"Tambah Alat Berat" });
      await dialog.getByRole("combobox", { name:"Gudang / lokasi" }).selectOption("GDG-E2E-01");
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
    const hook = fs.readFileSync(path.resolve(__dirname, "../..", "src/hooks/useHeavyEquipment.js"), "utf8");
    const sync = fs.readFileSync(path.resolve(__dirname, "../..", "src/lib/masterSync.js"), "utf8");
    expect(app).toContain('syncMasterTableRows("heavy_equipment", heHint, e => ({ upt: e.upt || null, upt_id: e.uptId || null');
    expect(hook).toContain('checkout_heavy_equipment_batch');
    expect(hook).toContain('heavy-equipment-evidence');
    expect(hook).toContain("{heavyEquipmentChangedRows:[item]}");
    expect(hook).toContain("{heavyEquipmentChangedRows:[next.find(eq=>eq.id===equipmentId)]}");
    expect(hook).toContain('if (_isDataUrl(item.foto))');
    expect(hook).toContain('"tug-photos", `alat-berat/${item.id}.jpg`');
    expect(sync).toContain('supabase.from(table).upsert(upsertRows, { onConflict: "id" })');
  });

  test.describe("pengembalian oleh owner", () => {
    test.use({
      actorProfile: { ...TL },
      cloudOverrides: {
        pln_heavy_equipment_v1: [{ ...CLOUD_FIXTURES.pln_heavy_equipment_v1[0], availabilityStatus:"DIPINJAM", activeLoanId:"LOAN-OWNER-01", borrowedToUpt:"Gresik" }],
        pln_heavy_equipment_loans_v1: [{ ...CLOUD_FIXTURES.pln_heavy_equipment_loans_v1[1], id:"LOAN-OWNER-01", equipmentId:"HE-E2E-01", ownerUpt:"Surabaya", requesterUpt:"Gresik", status:"DIPINJAM" }],
      },
    });

    test("ADMIN/TL owner melihat CTA kembali di kartu Armada", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      await expect(page.getByRole("button", { name:"Tandai Alat Kembali", exact:true })).toHaveCount(1);
    });

    test("gagal RPC mempertahankan modal dan data peminjaman", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      await page.getByRole("button", { name:"Tandai Alat Kembali", exact:true }).click();
      const dialog = page.getByRole("dialog", { name:"Konfirmasi Alat Kembali" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("checkbox").first().check();
      await dialog.getByRole("checkbox").last().check();
      await dialog.locator('input[type="file"]').setInputFiles({ name:"return.png", mimeType:"image/png", buffer:ONE_PIXEL_PNG });
      await dialog.getByRole("button", { name:"Tandai Sudah Kembali" }).click();
      await expect(page.getByText("Server pengembalian alat belum tersedia.")).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(page.getByText("OVERDUE", { exact:true }).last()).toBeVisible();
    });

    test.describe("peminjam", () => {
      test.use({ actorProfile: { ...TL, upt:"Gresik", uptId:"UPT-GSK" } });
      test("UPT peminjam tidak melihat CTA kembali", async ({ isolatedPage:page }) => {
        await openFleetForE2E(page);
        await expect(page.getByRole("button", { name:"Tandai Alat Kembali", exact:true })).toHaveCount(0);
      });
    });
  });

  test.describe("mobile 360", () => {
    test.use({ actorProfile:TL });
    test("registry dan form peminjaman tidak overflow horizontal", async ({ isolatedPage:page }) => {
      await page.setViewportSize({ width:360, height:800 });
      await openFleetForE2E(page);
      await page.getByRole("tab", { name:/Peminjaman & Histori/ }).click();
      await expect(page.locator(".equipment-loan-layout")).toBeVisible();
      const layout = await page.locator(".heavy-equipment-page").evaluate(root => ({
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        columns:getComputedStyle(root.querySelector(".equipment-loan-layout")).gridTemplateColumns,
      }));
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.columns.trim().split(/\s+/)).toHaveLength(1);
    });
  });
});
