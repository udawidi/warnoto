const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");
const fs = require("fs");
const XLSX = require("xlsx");

test("TUG-15 exposes combined-history controls and material drawer", async ({ isolatedPage:page }, testInfo) => {
  await openApp(page);
  await openRoute(page, {
    tab:"transaction",
    menuPath:["TUG", "Laporan"],
    readySelector:".tug-page",
  });

  const quickInput = page.getByPlaceholder(/Pekerjaan, lokasi, vendor\/ULTG/);
  await expect(quickInput).toBeVisible();
  await expect(page.getByText("Dari Tanggal", { exact:true })).toBeVisible();
  await expect(page.getByText("Sampai Tanggal", { exact:true })).toBeVisible();
  await expect(page.locator(".tug-process-tabs")).toHaveCount(0);
  await expect(page.locator(".tug-summary-banner")).toContainText("TUG-15");
  await expect(page.locator(".tug-summary-banner")).toContainText("Laporan Mutasi Stok");
  await expect(page.getByText("Filter Jenis Transaksi", { exact:true })).toHaveCount(0);
  await expect(page.locator(".tug-status-filter")).toHaveCount(0);
  await expect(page.getByRole("button", { name:"Semua Sumber", exact:true })).toBeVisible();
  await expect(page.getByRole("button", { name:"Baru", exact:true })).toBeVisible();
  await expect(page.getByRole("button", { name:"Lama", exact:true })).toBeVisible();
  expect(await page.evaluate(() => ({
    overflow:Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
  }))).toEqual({ overflow:0 });

  if (process.env.TUG15_VISUAL_AUDIT === "1") await page.screenshot({ path:testInfo.outputPath("tug15-history-drawer.png"), fullPage:false });
});

test("combined mutation rows keep legacy separate and search across dates", async ({ isolatedPage:page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const { buildMutasiRows } = await import("/src/lib/supabaseSync.js");
    const katalog = [{ id:"KAT-1", katalog:"301234567", name:"Isolator Keramik", satuan:"BUAH" }];
    const stocks = [{ id:"ST-1", katalogId:"KAT-1", jenisBarang:"Material Cadang" }];
    const txns = [{
      id:"TX-1", docType:"TUG9", status:"APPROVED", approvedAt:new Date("2026-06-01").getTime(),
      docNumbers:{ tug9:"BARU-001" }, stockItems:[{ stockId:"ST-1", qty:2 }],
    }];
    const legacy = [{
      id:1, source_upt:"UPT Surabaya", doc_type:"TUG9", doc_id:"LAMA-001",
      tanggal:"2020-01-01", jenis_transaksi:"KELUAR", no_katalog:"301234567",
      nama_material:"Isolator Keramik", satuan:"BUAH", qty:3, sync_key:"legacy-1",
    }];
    const baseFilter = {
      dateFrom:"2026-01-01", dateTo:"2026-12-31", katalogId:"ALL",
      jenisBarang:"ALL", sapStatus:"ALL", source:"ALL",
      searchText:"isolator", docTypes:["TUG9"],
    };
    const inRange = buildMutasiRows(txns, katalog, stocks, baseFilter, [], legacy);
    const allDates = buildMutasiRows(txns, katalog, stocks, {...baseFilter, dateFrom:"", dateTo:""}, [], legacy);
    const unknownRows = buildMutasiRows([{
      id:"TX-UNKNOWN", docType:"TUG3", status:"APPROVED", stage:"APPROVED",
      approvedAt:Date.now(), docNumbers:{ tug3:"UNKNOWN" }, stockItems:[
        { katalogMode:"new", katalogBaru:"", namaBaru:"", qty:1 },
        { katalogMode:"new", katalogBaru:"", namaBaru:"", qty:1 },
      ],
    }], [], [], {...baseFilter, dateFrom:"", dateTo:"", searchText:""}, [], []);
    const shape = rows => rows.map(row => ({
      source:row.source,
      masuk:row.masuk,
      keluar:row.keluar,
      materialKey:row.materialKey,
    }));
    return { inRange:shape(inRange), allDates:shape(allDates), unknown:shape(unknownRows) };
  });

  expect(result.inRange).toHaveLength(1);
  expect(result.inRange[0].source).toBe("BARU");
  expect(result.allDates).toHaveLength(2);
  expect(result.allDates.map(row => row.source).sort()).toEqual(["BARU", "LAMA"]);
  expect(result.allDates.find(row => row.source === "LAMA")).toMatchObject({ masuk:0, keluar:3 });
  expect(new Set(result.allDates.map(row => row.materialKey)).size).toBe(1);
  expect(result.unknown).toHaveLength(2);
  expect(new Set(result.unknown.map(row => row.materialKey)).size).toBe(2);
});

test.describe("TUG-15 pagination and frequent history search", () => {
  const manyTxns = Array.from({ length:101 }, (_, index) => ({
    id:`TUG9-PAGE-${index + 1}`,
    docType:"TUG9",
    status:"APPROVED",
    createdAt:new Date(`2026-05-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`).getTime() + index,
    approvedAt:new Date(`2026-05-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`).getTime() + index,
    namaPekerjaan:`Pekerjaan Paging ${index + 1}`,
    lokasiPekerjaan:`GI Area ${index + 1}`,
    penerimaNama:`Tim ${index + 1}`,
    penerimaUnit:index === 100 ? "ULTG Selatan Khusus" : "ULTG Surabaya",
    docNumbers:{ tug9:`TUG-9/PAGE/${String(index + 1).padStart(3, "0")}` },
    stockItems:[{ stockId:"ST-E2E-01", qty:1 }],
  }));

  test.use({ cloudOverrides:{ pln_txns_v3:manyTxns } });

  test("pages 20/50/100 and finds history beyond the current page", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, {
      tab:"transaction",
      menuPath:["TUG", "Laporan"],
      readySelector:".tug-page",
    });

    await expect(page.getByText("1–20 dari 101", { exact:true })).toBeVisible();
    await page.getByRole("button", { name:"Berikutnya", exact:true }).click();
    await expect(page.getByText("21–40 dari 101", { exact:true })).toBeVisible();

    await page.getByLabel("Baris per halaman", { exact:true }).selectOption("50");
    await expect(page.getByText("1–50 dari 101", { exact:true })).toBeVisible();
    await page.getByRole("button", { name:"Berikutnya", exact:true }).click();
    await expect(page.getByText("51–100 dari 101", { exact:true })).toBeVisible();
    await page.getByRole("button", { name:"Berikutnya", exact:true }).click();
    await expect(page.getByText("101–101 dari 101", { exact:true })).toBeVisible();

    await page.getByLabel("Baris per halaman", { exact:true }).selectOption("100");
    await expect(page.getByText("1–100 dari 101", { exact:true })).toBeVisible();

    const historySearch = page.getByPlaceholder(/Pekerjaan, lokasi, vendor\/ULTG/);
    await historySearch.fill("paging 101 ultg selatan");
    await expect(page.getByText("1–1 dari 1", { exact:true })).toBeVisible();
    await expect(page.getByText("Pekerjaan Paging 101", { exact:true })).toBeVisible();
  });
});

test("TUG-5 is searchable as a request and never changes saldo", async ({ isolatedPage:page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const { buildMutasiRows } = await import("/src/lib/supabaseSync.js");
    return buildMutasiRows([{
      id:"TUG5-REQ-1", docType:"TUG5", status:"APPROVED", stage:"APPROVED_ULTG",
      approvedAtMgrUltg:new Date("2026-07-01").getTime(), sourceType:"ULTG", ultgId:"ULTG-1",
      namaPekerjaan:"Permintaan PMT", lokasiPekerjaan:"GI Waru",
      docNumbers:{ tug5:"TUG-5/001" }, stockItems:[{ katalogId:"KAT-1", qty:7 }],
    }], [{ id:"KAT-1", katalog:"301", name:"PMT 150 kV", satuan:"UNIT" }], [], {
      dateFrom:"", dateTo:"", katalogId:"ALL", jenisBarang:"ALL", sapStatus:"ALL",
      source:"ALL", searchText:"permintaan waru ultg selatan", docTypes:["TUG5"],
      ultgList:[{ id:"ULTG-1", nama:"ULTG Selatan" }],
    }, [], []);
  });

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    eventKind:"PERMINTAAN", masuk:0, keluar:0, affectsSaldo:false,
    saldoAwal:null, saldoAkhir:null, counterparty:"ULTG Selatan",
  });
});

test("report model keeps quantities unit-aware, requests visible, and formula text safe", async ({ isolatedPage:page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const { buildTUG15ReportModel, sanitizeExcelText } = await import("/src/lib/tug15Report.js");
    const report = buildTUG15ReportModel([
      { id:"IN", materialKey:"katalog:1", katalog:"1", deskripsi:"=formula", satuan:"BUAH", masuk:2, keluar:0, requestedQty:0, tanggalMutasi:"2026-06-01", lokasiKode:"BLOK-A", warehouseName:"Gudang Ketintang", upt:"UPT", eventKind:"MASUK" },
      { id:"OUT", materialKey:"katalog:2", katalog:"2", deskripsi:"Material set", satuan:"SET", masuk:0, keluar:3, requestedQty:0, tanggalMutasi:"2026-06-02", lokasiKode:"BLOK-A", warehouseName:"Gudang Ketintang", upt:"UPT", eventKind:"KELUAR" },
      { id:"REQ", materialKey:"katalog:1", katalog:"1", deskripsi:"=formula", satuan:"BUAH", masuk:0, keluar:0, requestedQty:5, tanggalMutasi:"2026-06-03", lokasiKode:"BLOK-A", warehouseName:"Gudang Ketintang", upt:"UPT", eventKind:"PERMINTAAN", tugBaDoc:"TUG-5/REQ" },
    ], { dateFrom:"2026-06-01", dateTo:"2026-06-30" });
    return {
      masuk:report.kpi.masuk, keluar:report.kpi.keluar, permintaan:report.kpi.permintaan,
      monitoring:report.monitoring, safe:sanitizeExcelText("=formula"),
      monitoringWarehouse:report.monitoring[0].location,
      detailWarehouse:report.rawRows[0].warehouseName,
    };
  });

  expect(result.masuk).toEqual([{ unit:"BUAH", quantity:2 }]);
  expect(result.keluar).toEqual([{ unit:"SET", quantity:3 }]);
  expect(result.permintaan).toEqual([{ unit:"BUAH", quantity:5 }]);
  expect(result.monitoring[0]).toMatchObject({ masuk:2, keluar:0, permintaan:5, stokAwal:"", stokAkhir:"", stokSap:"", wbs:"", totalNilai:"" });
  expect(result.monitoring[0].keterangan).toContain("tidak mengubah saldo");
  expect(result.monitoringWarehouse).toBe("Gudang Ketintang");
  expect(result.detailWarehouse).toBe("Gudang Ketintang");
  expect(`${result.monitoringWarehouse} ${result.detailWarehouse}`).not.toContain("BLOK-A");
  expect(result.safe).toBe("'=formula");
});

test("downloads native PDF and Monitoring Persediaan workbook contract", async ({ isolatedPage:page }, testInfo) => {
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    window.__tug15DownloadBlobs = [];
    URL.createObjectURL = blob => {
      window.__tug15DownloadBlobs.push(blob);
      return original(blob);
    };
  });
  await openApp(page);
  await openRoute(page, { tab:"transaction", menuPath:["TUG", "Laporan"], readySelector:".tug-page" });
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill("2026-01-01");
  await dates.nth(1).fill("2026-12-31");

  const pdfEvent = page.waitForEvent("download");
  await page.getByRole("button", { name:/Download Ringkasan/ }).click();
  const pdf = await pdfEvent;
  const pdfPath = testInfo.outputPath("tug15-summary.pdf");
  await pdf.saveAs(pdfPath);
  expect(fs.readFileSync(pdfPath).subarray(0, 5).toString("ascii")).toBe("%PDF-");
  await expect.poll(() => page.evaluate(async () => {
    const blob = window.__tug15DownloadBlobs.at(-1);
    return blob ? { type:blob.type, signature:await blob.slice(0, 5).text() } : null;
  })).toEqual({ type:"application/pdf", signature:"%PDF-" });

  const xlsxEvent = page.waitForEvent("download");
  await page.getByRole("button", { name:/Download Excel/ }).click();
  const workbookDownload = await xlsxEvent;
  const workbookPath = testInfo.outputPath("monitoring-persediaan.xlsx");
  await workbookDownload.saveAs(workbookPath);
  const workbook = XLSX.readFile(workbookPath, { cellStyles:true });
  expect(workbook.SheetNames).toEqual(["Monitoring Persediaan", "Detail Mutasi", "Info Laporan"]);
  const sheet = workbook.Sheets["Monitoring Persediaan"];
  const table = XLSX.utils.sheet_to_json(sheet, { header:1, blankrows:true, defval:"" });
  expect(table[4]).toHaveLength(36);
  expect(table[5][11]).toBe("PERIODE MASUK");
  expect(sheet["!merges"].some(range => range.s.r===4 && range.s.c===11 && range.e.r===4 && range.e.c===15)).toBeTruthy();
  expect(typeof table[6][17]).toBe("number");
  expect(sheet["R7"].t).toBe("n");
  expect([table[6][10], table[6][21], table[6][22], table[6][23], table[6][27], table[6][30], table[6][32], table[6][33], table[6][34]].every(value => value === "")).toBeTruthy();
});

test("report model retains all unit coverage and identical prices stay numeric", async ({ isolatedPage:page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const { buildTUG15ReportModel } = await import("/src/lib/tug15Report.js");
    const rows = [
      { materialKey:"shared", katalog:"K-1", deskripsi:"Harga tetap", satuan:"BUAH", valuasi:1250, masuk:1, keluar:0, tanggalMutasi:"2026-01-01", lokasiKode:"A" },
      { materialKey:"shared", katalog:"K-1", deskripsi:"Harga tetap", satuan:"BUAH", valuasi:1250, masuk:1, keluar:0, tanggalMutasi:"2026-01-02", lokasiKode:"A" },
      ...Array.from({ length:16 }, (_, index) => ({ materialKey:`b-${index}`, katalog:`B-${index}`, deskripsi:`Buah ${index}`, satuan:"BUAH", masuk:0, keluar:index+1, tanggalMutasi:"2026-02-01", lokasiKode:"A" })),
      ...Array.from({ length:16 }, (_, index) => ({ materialKey:`s-${index}`, katalog:`S-${index}`, deskripsi:`Set ${index}`, satuan:"SET", masuk:0, keluar:index+1, tanggalMutasi:"2026-02-01", lokasiKode:"A" })),
    ];
    const report = buildTUG15ReportModel(rows, {});
    return { price:report.monitoring.find(row => row.katalog === "K-1").hargaSatuan, all:report.allMaterialTotals.length, top:report.topMaterials, allUnits:[...new Set(report.topMaterials.map(row => row.satuan))] };
  });
  expect(result.price).toBe(1250);
  expect(result.all).toBe(33);
  expect(result.allUnits).toEqual(["BUAH", "SET"]);
  expect(result.top.filter(row => row.satuan === "BUAH")).toHaveLength(5);
  expect(result.top.filter(row => row.satuan === "SET")).toHaveLength(5);
});

test("row mapping preserves merk/type", async ({ isolatedPage:page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const { buildMutasiRows } = await import("/src/lib/supabaseSync.js");
    const mapped = buildMutasiRows([{ id:"M-1", docType:"TUG3", status:"APPROVED", stage:"APPROVED", approvedAt:Date.now(), docNumbers:{ tug3:"M-1" }, stockItems:[{ katalogMode:"existing", katalogId:"K-1", qty:1, merk:"Item Merk", tipe:"Item Type" }] }], [{ id:"K-1", katalog:"K-1", name:"Material", satuan:"BUAH", merk:"Katalog Merk", tipe:"Katalog Type" }], [], { dateFrom:"", dateTo:"", katalogId:"ALL", jenisBarang:"ALL", sapStatus:"ALL", source:"ALL", searchText:"", docTypes:["TUG3"] }, [], []);
    const locations=[{ id:"L-1", kode:"BLOK-A", gudangId:"G-1" }], gudang=[{ id:"G-1", nama:"Gudang Ketintang" }];
    const live=buildMutasiRows([{ id:"W-1", docType:"TUG9", status:"APPROVED", approvedAt:Date.now(), docNumbers:{ tug9:"W-1" }, stockItems:[{ stockId:"S-1", qty:1 }] }], [{ id:"K-1", katalog:"K-1", name:"Material", satuan:"BUAH" }], [{ id:"S-1", katalogId:"K-1", lokasiId:"L-1" }], { dateFrom:"", dateTo:"", katalogId:"ALL", jenisBarang:"ALL", sapStatus:"ALL", source:"ALL", searchText:"", docTypes:["TUG9"] }, locations, [], { gudangList:gudang });
    const legacy=buildMutasiRows([], [], [], { dateFrom:"", dateTo:"", katalogId:"ALL", jenisBarang:"ALL", sapStatus:"ALL", source:"ALL", searchText:"", docTypes:["TUG9"] }, [], [
      { id:"legacy", doc_type:"TUG9", doc_id:"L", tanggal:"2026-01-01", jenis_transaksi:"KELUAR", lokasi_kode:"BLOK-A", source_upt:"UPT Surabaya", satuan:"BUAH", qty:1 },
      { id:"legacy-explicit", doc_type:"TUG9", doc_id:"L2", tanggal:"2026-01-02", jenis_transaksi:"KELUAR", lokasi_kode:"GUDANG BANGIL - UPT PROBOLINGGO / BLOK-A", source_upt:"UPT Surabaya", satuan:"BUAH", qty:1 },
    ], { gudangList:gudang });
    return { merk:mapped[0].merk, type:mapped[0].type, warehouse:live[0].warehouseName, legacyWarehouse:legacy[0].warehouseName, explicitLegacyWarehouse:legacy[1].warehouseName };
  });
  expect(result).toMatchObject({ merk:"Katalog Merk", type:"Katalog Type", warehouse:"Gudang Ketintang", legacyWarehouse:"UPT Surabaya", explicitLegacyWarehouse:"GUDANG BANGIL" });
});

test.describe("long monthly PDF", () => {
  const longTxns = Array.from({ length:26 }, (_, index) => {
    const date = new Date(Date.UTC(2024 + Math.floor(index / 12), index % 12, 1)).getTime();
    return { id:`LONG-${index}`, docType:"TUG9", status:"APPROVED", approvedAt:date, createdAt:date, docNumbers:{ tug9:`LONG/${index}` }, stockItems:[{ stockId:"ST-E2E-01", qty:index + 1 }] };
  });
  test.use({ cloudOverrides:{ pln_txns_v3:longTxns } });

  test("actual download is valid and capped at two PDF pages", async ({ isolatedPage:page }) => {
    await page.addInitScript(() => {
      const original = URL.createObjectURL.bind(URL);
      window.__longPdfBlobs = [];
      URL.createObjectURL = blob => { window.__longPdfBlobs.push(blob); return original(blob); };
    });
    await openApp(page);
    await openRoute(page, { tab:"transaction", menuPath:["TUG", "Laporan"], readySelector:".tug-page" });
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill("2024-01-01");
    await dates.nth(1).fill("2026-12-31");
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name:/Download Ringkasan/ }).click();
    await event;
    const pdf = await page.evaluate(async () => {
      const blob = [...window.__longPdfBlobs].reverse().find(item => item.type === "application/pdf");
      const text = new TextDecoder("latin1").decode(await blob.arrayBuffer());
      return { type:blob.type, signature:text.slice(0, 5), pages:Math.max(...window.__longPdfBlobs.map(item => Number(item.__warnotoPdfPageCount) || 0)) };
    });
    expect(pdf).toMatchObject({ type:"application/pdf", signature:"%PDF-" });
    expect(pdf.pages).toBe(2);
  });
});
