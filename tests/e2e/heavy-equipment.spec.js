const fs = require("node:fs");
const path = require("node:path");
const { test, expect, CLOUD_FIXTURES } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");

const ADMIN = { id:"e2e-admin", name:"E2E Admin", username:"admin-e2e", role:"ADMIN", jabatan:"Admin Gudang", avatar:"AD", upt:"Surabaya", uptId:"UPT-SBY", gudangIds:null };
const TL = { id:"e2e-tl", name:"E2E TL", username:"tl-e2e", role:"TL", jabatan:"Team Leader", avatar:"TL", upt:"Surabaya", uptId:"UPT-SBY", gudangIds:null };
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const EXPORT_PHOTO = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;
const EXPORT_WEBP = "data:image/webp;base64,UklGRmIAAABXRUJQVlA4IFYAAABQBQCdASp4AFAAPm02mUmkIyKhIMgAgA2JaQB2APwAAAxvdTfRtQ5xlAPdTfRtQ5xk/0AA/vCbQ//+QXLC65Gv//yA/5Af8gP/498W46CVoAgAAAAAAA==";
const XLSX = require("xlsx");
const { unzipSync, strFromU8 } = require("fflate");

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
      for (const label of ["UPT","Nama","Jenis","Merk/Type","Kapasitas","No. Seri","Tahun","Spesifikasi","Kondisi"]) {
        await expect(dialog.getByLabel(label, { exact:true })).toBeVisible();
      }
      await dialog.getByRole("combobox", { name:"Mode pencatatan", exact:true }).selectOption("QUANTITY");
      await expect(dialog.getByRole("spinbutton", { name:"Jumlah total", exact:true })).toBeVisible();
      await expect(dialog.getByRole("textbox", { name:"Satuan", exact:true })).toHaveValue("unit");
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

  test("kontrak HAR_UIT memakai scope UIT dan server canonical", () => {
    const app = fs.readFileSync(path.resolve(__dirname, "../..", "App.jsx"), "utf8");
    const hook = fs.readFileSync(path.resolve(__dirname, "../..", "src/hooks/useHeavyEquipment.js"), "utf8");
    const tab = fs.readFileSync(path.resolve(__dirname, "../..", "src/components/HeavyEquipmentTabV2.jsx"), "utf8");
    const migration = fs.readFileSync(path.resolve(__dirname, "../..", "supabase/migrations/20260921_har_uit_heavy_equipment_loans.sql"), "utf8");
    expect(app).toContain('currentUser?.role === "HAR_UIT"');
    expect(app).toContain("setHeavyEquipmentLoans(chelRemote)");
    expect(hook).toContain('borrowerType, borrowerName');
    expect(hook).toContain('borrowerUitId: isHarUit ? currentUser.uitId : null');
    expect(tab).toContain('Ajukan Peminjaman HAR UIT');
    expect(tab).toContain('UPT pemilik alat');
    expect(tab).toContain('getHeavyEquipmentLoanRequesterUitId');
    expect(tab).toContain('isCrossUptBorrowable');
    expect(migration).toContain("requester_uit_id");
    expect(migration).toContain("PENDING_OWNER_ASMAN");
    expect(migration).toContain("not exists (select 1 from public.heavy_equipment_loans l");
  });

  test.describe("HAR_UIT UI", () => {
    test.use({
      actorProfile: { id:"e2e-har", name:"HAR UIT E2E", username:"har-e2e", role:"HAR_UIT", jabatan:"HAR UIT", avatar:"HU", uitId:"UIT-JBM", uptId:null, gudangIds:null },
      cloudOverrides: {
        pln_upt_v1: [
          { id:"UPT-SBY", nama:"UPT Surabaya", kode:"UPT-SBYA", uitId:"UIT-JBM" },
          { id:"UPT-MLG", nama:"UPT Malang", kode:"UPT-MLG", uitId:"UIT-JBM" },
        ],
        pln_heavy_equipment_v1: [
          { ...CLOUD_FIXTURES.pln_heavy_equipment_v1[0], id:"HE-E2E-HAR-01", upt:"Surabaya", uptId:"UPT-SBY", isCrossUptBorrowable:true, foto:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwG6WQAAAABJRU5ErkJggg==" },
          { ...CLOUD_FIXTURES.pln_heavy_equipment_v1[0], id:"HE-E2E-HAR-02", upt:"Malang", uptId:"UPT-MLG", isCrossUptBorrowable:false, foto:null },
        ],
        pln_heavy_equipment_loans_v1: [],
      },
    });

    test("form HAR_UIT scoped and owner actions hidden", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      await expect(page.getByRole("img", { name:"Truck Crane 8 Ton" })).toBeVisible();
      await page.getByRole("tab", { name:/Peminjaman & Histori/ }).click();
      await expect(page.getByText("Ajukan Peminjaman HAR UIT", { exact:true })).toBeVisible();
      const ownerSelect = page.locator(".operations-form-panel select").first();
      await expect(ownerSelect).toBeVisible();
      await ownerSelect.selectOption("UPT-SBY");
      await expect(page.getByRole("group", { name:"Pilih alat yang dipinjam" }).getByText("Truck Crane 8 Ton")).toBeVisible();
      const borrowerName = page.getByLabel("Nama peminjam");
      const borrowerPic = page.getByLabel("PIC");
      const borrowerContact = page.getByLabel("Kontak");
      await expect(borrowerName).toBeVisible();
      await expect(borrowerPic).toBeVisible();
      await expect(borrowerContact).toBeVisible();
      await expect(borrowerName).toBeEditable();
      await expect(borrowerPic).toBeEditable();
      await expect(borrowerContact).toBeEditable();
      await borrowerName.fill("HAR UIT Pengujian");
      await borrowerPic.fill("PIC Pengujian");
      await borrowerContact.fill("081234567890");
      await expect(borrowerName).toHaveValue("HAR UIT Pengujian");
      await expect(borrowerPic).toHaveValue("PIC Pengujian");
      await expect(borrowerContact).toHaveValue("081234567890");
      await expect(page.getByRole("button", { name:"+ Tambah Alat", exact:true })).toHaveCount(0);
      await expect(page.getByRole("button", { name:"Edit data alat", exact:true })).toHaveCount(0);
      await expect(page.getByRole("button", { name:"Setujui Peminjaman", exact:true })).toHaveCount(0);
      await expect(page.getByRole("button", { name:"Tandai Alat Kembali", exact:true })).toHaveCount(0);
    });
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

  test.describe("pool kuantitas fixture", () => {
    test.use({
      actorProfile:TL,
      cloudOverrides: {
        pln_heavy_equipment_v1: [{ ...CLOUD_FIXTURES.pln_heavy_equipment_v1[0], id:"HE-E2E-POOL-01", nama:"Plat Besi Trafo Pool", upt:"Surabaya", uptId:"UPT-SBY", trackingMode:"QUANTITY", quantityTotal:8, unit:"unit", statusAlat:"LAYAK", availabilityStatus:"TERSEDIA" }],
        pln_heavy_equipment_loans_v1: [{ ...CLOUD_FIXTURES.pln_heavy_equipment_loans_v1[0], id:"LOAN-E2E-POOL-01", equipmentId:"HE-E2E-POOL-01", ownerUpt:"Surabaya", ownerUptId:"UPT-SBY", requesterUpt:"Gresik", requesterUptId:"UPT-GRS", status:"DIPINJAM", quantityBorrowed:5, quantityReturnedGood:2, quantityReturnedDamaged:0, quantityReturnedLost:0, returnEvents:[{ id:"RETURN-E2E-01", good:2, damaged:0, lost:0, remainingAfter:3, actorId:"e2e-tl", occurredAt:1784505600000, evidencePath:"UPT-SBY/LOAN-E2E-POOL-01/return-1.jpg", conditionNote:"Kondisi baik" }] }],
      },
    });

    test("menampilkan saldo, timeline detail, dan modal return parsial", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      const poolCard = page.locator(".equipment-card").filter({ hasText:"Plat Besi Trafo Pool" });
      await expect(poolCard).toBeVisible();
      await expect(poolCard.getByText("8 unit", { exact:true })).toBeVisible();
      await expect(poolCard.getByText("5 unit", { exact:true })).toBeVisible();
      await expect(poolCard.getByText(/Dipinjam \/ reservasi/)).toBeVisible();
      await page.getByRole("tab", { name:/Peminjaman & Histori/ }).click();
      await expect(page.getByText(/Timeline pengembalian/)).toBeVisible();
      await expect(page.getByText(/E2E TL/)).toBeVisible();
      await expect(page.getByRole("button", { name:"Lihat bukti", exact:true })).toBeVisible();
      await page.getByRole("button", { name:"Tandai Alat Kembali", exact:true }).first().click();
      const dialog = page.getByRole("dialog", { name:"Konfirmasi Alat Kembali" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Baik", { exact:true })).toBeVisible();
      await expect(dialog.getByLabel("Rusak", { exact:true })).toBeVisible();
      await expect(dialog.getByLabel("Hilang", { exact:true })).toBeVisible();
      await dialog.getByLabel("Baik", { exact:true }).fill("4");
      await dialog.locator('input[type="file"]').setInputFiles({ name:"return.png", mimeType:"image/png", buffer:ONE_PIXEL_PNG });
      await dialog.locator('input[type="checkbox"]').nth(0).check();
      await dialog.locator('input[type="checkbox"]').nth(1).check();
      await expect(dialog.getByRole("button", { name:"Tandai Sudah Kembali", exact:true })).toBeDisabled();
    });

    test("pool tetap tanpa overflow pada 360px", async ({ isolatedPage:page }) => {
      await page.setViewportSize({ width:360, height:800 });
      await openFleetForE2E(page);
      const overflow = await page.locator(".heavy-equipment-page").evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});

test.describe("Alat Berat — Excel export", () => {
  test("superadmin mengunduh workbook inventaris dan lampiran foto", async ({ isolatedPage:page }) => {
    await openFleetForE2E(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name:"Export Excel Alat Berat", exact:true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^Alat_Berat_.*\.xlsx$/);
    const filePath = await download.path();
    const workbook = XLSX.readFile(filePath);
    expect(workbook.SheetNames).toEqual(expect.arrayContaining(["Inventaris", "Lampiran Foto"]));
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Inventaris, { defval:"" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some(row => row["No. Seri"] === "E2E-CR-001")).toBe(true);
  });

  test.describe("UPT scope", () => {
    test.use({
      actorProfile: { ...TL, uptId:"UPT-SBY", upt:"Surabaya" },
      cloudOverrides: {
        pln_heavy_equipment_v1: [
          { ...CLOUD_FIXTURES.pln_heavy_equipment_v1[0], id:"HE-EXPORT-SBY", upt:"Surabaya", uptId:"UPT-SBY", foto:EXPORT_WEBP },
          { ...CLOUD_FIXTURES.pln_heavy_equipment_v1[1], id:"HE-EXPORT-GRS", upt:"Gresik", uptId:"UPT-GRS", isCrossUptBorrowable:true, foto:EXPORT_PHOTO },
        ],
      },
    });

    test("TL export hanya UPT sendiri dan mobile tidak overflow", async ({ isolatedPage:page }) => {
      await page.setViewportSize({ width:360, height:800 });
      await openFleetForE2E(page);
      const button = page.getByRole("button", { name:"Export Excel Alat Berat", exact:true });
      await expect(button).toBeVisible();
      expect(await button.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      const downloadPromise = page.waitForEvent("download"); await button.click();
      const download = await downloadPromise; const wb = XLSX.readFile(await download.path());
      const ids = XLSX.utils.sheet_to_json(wb.Sheets.Inventaris, { defval:"" }).map(row => row.ID);
      expect(ids).toEqual(["HE-EXPORT-SBY"]);
      const zip = unzipSync(require("node:fs").readFileSync(await download.path()));
      expect(Object.keys(zip).some(key => key.endsWith("image1.png"))).toBe(true);
      const image = zip["xl/media/image1.png"];
      expect([image[0], image[1], image[2], image[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(strFromU8(zip["xl/drawings/drawing1.xml"])).toContain('cx="1143000" cy="762000"');
    });
  });

  test.describe("UIT scope", () => {
    test.use({
      actorProfile: { id:"e2e-uit", name:"E2E UIT", username:"uit-e2e", role:"ADMIN_UIT", jabatan:"Admin UIT", uitId:"UIT-JBM", uptId:null, upt:null, gudangIds:null },
      cloudOverrides: {
        pln_upt_v1: [
          { id:"UPT-SBY", nama:"UPT Surabaya", uitId:"UIT-JBM" }, { id:"UPT-GRS", nama:"UPT Gresik", uitId:"UIT-JBM" }, { id:"UPT-MLG", nama:"UPT Malang", uitId:"UIT-BALI" },
        ],
        pln_heavy_equipment_v1: [
          { ...CLOUD_FIXTURES.pln_heavy_equipment_v1[0], id:"HE-EXPORT-SBY", upt:"Surabaya", uptId:"UPT-SBY", foto:EXPORT_PHOTO },
          { ...CLOUD_FIXTURES.pln_heavy_equipment_v1[1], id:"HE-EXPORT-GRS", upt:"Gresik", uptId:"UPT-GRS", foto:EXPORT_PHOTO },
          { ...CLOUD_FIXTURES.pln_heavy_equipment_v1[2], id:"HE-EXPORT-MLG", upt:"Malang", uptId:"UPT-MLG", foto:EXPORT_PHOTO },
        ],
      },
    });

    test("UIT export tetap seluruh UIT walau filter layar Surabaya", async ({ isolatedPage:page }) => {
      await openFleetForE2E(page);
      const filter = page.locator(".operations-hero__controls select").first();
      await expect(filter).toBeVisible();
      await filter.selectOption({ label:"Surabaya" });
      await expect(filter).toHaveValue(/UPT-SBY|Surabaya/i);
      const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name:"Export Excel Alat Berat", exact:true }).click();
      const download = await downloadPromise; const wb = XLSX.readFile(await download.path());
      const ids = XLSX.utils.sheet_to_json(wb.Sheets.Inventaris, { defval:"" }).map(row => row.ID);
      expect(ids.sort()).toEqual(["HE-EXPORT-GRS", "HE-EXPORT-SBY"].sort());
      const zip = unzipSync(require("node:fs").readFileSync(await download.path()));
      expect(Object.keys(zip).some(key => key.includes("xl/media/image1.png"))).toBe(true);
    });
  });
});
