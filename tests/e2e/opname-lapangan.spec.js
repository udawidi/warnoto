const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");
const { SURFACES } = require("./route-manifest");

// Fase 2 Stock Opname — mode lapangan (OpnameLapanganView), fixture OPN-E2E-01 (lihat
// fixtures.js): 2 item SAP, tiap item 1 blok beda (A-01/B-02), qtsFisik null (progress 0%)
// supaya tombol "Mulai Hitung" (satu-satunya pintu HP ke mode lapangan) masih terlihat.
const STOCK_OPNAME = SURFACES.find(s => s.slug === "stock-opname");
const DRAFT_BUTTON_NAME = /Lanjutkan draft 2026-2 — SAP/;

async function openDraftSession(page) {
  await openApp(page);
  await openRoute(page, STOCK_OPNAME);
  await page.getByRole("button", { name: DRAFT_BUTTON_NAME }).click();
}

// OpnameLapanganView overlay tetap di DOM di atas tabel desktop (position:fixed) — nama
// barang/kode blok bisa cocok DUA kali (tabel + overlay). Scope ke overlay via z-index
// inline-nya (komponen tak punya className pembeda) supaya locator selalu unik.
function overlayOf(page) {
  return page.locator('div[style*="z-index: 900"]');
}

test.describe("Stock Opname — mode lapangan (Fase 2)", () => {
  test.describe.configure({ timeout: 180_000 });

  // Fixture OPN-E2E-01 sengaja pakai qtsFisik:null (progress 0%, lihat komentar di atas) supaya
  // "Mulai Hitung" muncul — beda dari data produksi asli (selalu qtsFisik:qtySistem sejak dibuat,
  // lihat buildItemsFromSAP). Efek samping: tabel desktop (tetap ter-mount di belakang overlay)
  // merender <input value={null}>, memicu warning dev-only React soal controlled/uncontrolled.
  // Bukan bug app produksi (qtsFisik null tak pernah terjadi di data nyata) — di-allowlist di sini,
  // bukan ditambal di src/.
  test.use({
    expectedConsoleErrorPrefixes: [
      "Warning: `value` prop on `%s` should not be null.",
      "Warning: A component is changing an uncontrolled input to be controlled.",
    ],
  });

  test("buka mode lapangan, pilih blok, item tampil", async ({ isolatedPage: page }) => {
    await openDraftSession(page);
    await page.getByRole("button", { name: "Mulai Hitung" }).click();
    await expect(page.getByText("📱 Mode Lapangan")).toBeVisible();

    const overlay = overlayOf(page);
    await overlay.getByText("GTK — A-01").click();
    await expect(overlay.getByText("Isolator Keramik 150 kV")).toBeVisible();
  });

  // Paling penting: selisih wajib hitung ulang (blind) sebelum submit boleh lanjut.
  // Submit hanya muncul di progress 100% (StockOpnameTab.jsx), jadi recount HARUS
  // diselesaikan sebelum overlay ditutup & kedua item selesai dihitung — kalau ditutup
  // dulu baru dibuka lagi di progress 100%, HP tidak punya jalan balik (tombol "Mulai/
  // Lanjut Hitung" berganti jadi Submit, "📱 Mode Lapangan" khusus desktop). Lihat laporan.
  test("recount selisih wajib dikonfirmasi sebelum submit boleh lanjut", async ({ isolatedPage: page }) => {
    await openDraftSession(page);
    await page.getByRole("button", { name: "Mulai Hitung" }).click();
    const overlay = overlayOf(page);

    // Item 1 (qtySistem 10) dihitung 5 -> selisih -5, masuk antrian recount.
    await overlay.getByText("GTK — A-01").click();
    await overlay.getByText("Isolator Keramik 150 kV").click();
    await overlay.locator("input[type=number]").fill("5");
    await overlay.getByRole("button", { name: "✔ Simpan Saja" }).click();
    await overlay.getByRole("button", { name: "← Ganti Blok" }).click();

    // Recount masih pending di sini -> resolusi SEKARANG (masih di dalam overlay), bukan
    // setelah overlay ditutup, supaya tidak menabrak celah reachability di atas.
    await overlay.getByRole("button", { name: /🔁 Hitung Ulang \(1\)/ }).click();
    await overlay.locator("input[type=number]").fill("5"); // sama dgn hitungan pertama -> cocok
    await overlay.getByRole("button", { name: "✔ Konfirmasi" }).click();
    await expect(overlay.getByText("Semua item selisih sudah dikonfirmasi.")).toBeVisible();

    // Item 2 (qtySistem 4) dihitung 4 -> sesuai, tidak ada selisih. Progress jadi 2/2.
    await overlay.getByRole("button", { name: "← Kembali" }).click();
    await overlay.getByText("B-02").click();
    await overlay.getByText("Lightning Arrester 150 kV").click();
    await overlay.locator("input[type=number]").fill("4");
    await overlay.getByRole("button", { name: "✔ Simpan Saja" }).click();

    // "✔ Simpan Saja" balik ke screen "items" (list blok), bukan "blok" (pemilihan blok) — "✕ Tutup"
    // cuma ada di screen "blok" (lihat OpnameLapanganView.jsx). Ganti blok dulu supaya sampai ke sana.
    await overlay.getByRole("button", { name: "← Ganti Blok" }).click();
    await overlay.getByRole("button", { name: "✕ Tutup" }).click();
    await page.getByRole("button", { name: "📋 Submit ke Asman" }).click();
    await expect(page.getByText(DRAFT_BUTTON_NAME)).not.toBeVisible();
  });

  test("recount pending memblokir submit kalau overlay ditutup sebelum dikonfirmasi", async ({ isolatedPage: page }) => {
    await openDraftSession(page);
    await page.getByRole("button", { name: "Mulai Hitung" }).click();
    const overlay = overlayOf(page);

    // Item 1 selisih (recount pending, TIDAK dikonfirmasi) lalu item 2 sesuai -> progress 2/2
    // supaya tombol Submit muncul, tapi recount belum selesai.
    await overlay.getByText("GTK — A-01").click();
    await overlay.getByText("Isolator Keramik 150 kV").click();
    await overlay.locator("input[type=number]").fill("5");
    await overlay.getByRole("button", { name: "✔ Simpan Saja" }).click();
    await overlay.getByRole("button", { name: "← Ganti Blok" }).click();
    await overlay.getByText("B-02").click();
    await overlay.getByText("Lightning Arrester 150 kV").click();
    await overlay.locator("input[type=number]").fill("4");
    await overlay.getByRole("button", { name: "✔ Simpan Saja" }).click();
    await overlay.getByRole("button", { name: "← Ganti Blok" }).click();
    await overlay.getByRole("button", { name: "✕ Tutup" }).click();

    await page.getByRole("button", { name: "📋 Submit ke Asman" }).click();
    await expect(page.getByText(/item selisih belum dikonfirmasi hitung ulang/)).toBeVisible();
    // Masih di layar sesi (tidak balik ke daftar) -> submit benar-benar diblokir, bukan cuma toast kosmetik.
    await expect(page.getByRole("button", { name: "📋 Submit ke Asman" })).toBeVisible();
  });

  // Uji akseptansi kritis (komentar OpnameLapanganView.jsx): scanner HID "mengetik" cepat
  // (gap <120ms) ke kolom fokus -> harus ditangkap sebagai satu kode scan, BUKAN ikut
  // terketik ke kolom qty. page.keyboard.press (bukan page.evaluate dispatch sintetis) dipakai
  // supaya event benar-benar "trusted" dan diproses default action browser seperti alat asli.
  test("burst scanner tidak mengotori kolom qty", async ({ isolatedPage: page }) => {
    await openDraftSession(page);
    await page.getByRole("button", { name: "Mulai Hitung" }).click();
    const overlay = overlayOf(page);
    await overlay.getByText("GTK — A-01").click();
    await overlay.getByText("Isolator Keramik 150 kV").click();

    const qtyInput = overlay.locator("input[type=number]");
    await expect(qtyInput).toBeVisible();
    await expect(qtyInput).toHaveValue("");

    for (const digit of ["1", "2", "3", "4"]) await page.keyboard.press(digit);
    await page.keyboard.press("Enter");

    // Kode "1234" tidak match katalog manapun -> dialog "tidak ditemukan" muncul, membuktikan
    // burst-nya DITANGKAP sebagai scan (onScan), bukan ketikan biasa ke kolom.
    await expect(page.getByText(/Kode "1234" tidak ditemukan/)).toBeVisible();
    await expect(qtyInput).toHaveValue("");
  });

  // Fix celah reachability (lihat komentar test recount di atas): di HP saat progress 100%,
  // "📱 Mode Lapangan" WAJIB tetap tampil supaya user dgn recount pending punya jalan balik ke
  // overlay untuk hitung ulang — tanpa ini submit terblokir permanen (deadlock). Uji: capai 100%
  // dgn recount pending (submit terblokir), lalu buka lagi lapangan via tombol itu, resolve, submit.
  test("HP 100% dgn recount pending: '📱 Mode Lapangan' jadi jalan keluar deadlock", async ({ isolatedPage: page }) => {
    await openDraftSession(page);
    await page.getByRole("button", { name: "Mulai Hitung" }).click();
    let overlay = overlayOf(page);

    // Item 1 selisih (recount pending), item 2 sesuai -> progress 2/2, Submit muncul tapi terblokir.
    await overlay.getByText("GTK — A-01").click();
    await overlay.getByText("Isolator Keramik 150 kV").click();
    await overlay.locator("input[type=number]").fill("5");
    await overlay.getByRole("button", { name: "✔ Simpan Saja" }).click();
    await overlay.getByRole("button", { name: "← Ganti Blok" }).click();
    await overlay.getByText("B-02").click();
    await overlay.getByText("Lightning Arrester 150 kV").click();
    await overlay.locator("input[type=number]").fill("4");
    await overlay.getByRole("button", { name: "✔ Simpan Saja" }).click();
    await overlay.getByRole("button", { name: "← Ganti Blok" }).click();
    await overlay.getByRole("button", { name: "✕ Tutup" }).click();

    // Submit diblokir recount, DAN tombol jalan keluar HP terlihat (inti fix).
    await page.getByRole("button", { name: "📋 Submit ke Asman" }).click();
    await expect(page.getByText(/item selisih belum dikonfirmasi hitung ulang/)).toBeVisible();
    const modeLapanganBtn = page.getByRole("button", { name: "📱 Mode Lapangan" });
    await expect(modeLapanganBtn).toBeVisible();

    // Balik ke overlay lewat jalan keluar itu, resolve recount, submit jadi lolos.
    await modeLapanganBtn.click();
    overlay = overlayOf(page);
    await overlay.getByRole("button", { name: /🔁 Hitung Ulang \(1\)/ }).click();
    await overlay.locator("input[type=number]").fill("5");
    await overlay.getByRole("button", { name: "✔ Konfirmasi" }).click();
    await expect(overlay.getByText("Semua item selisih sudah dikonfirmasi.")).toBeVisible();
    await overlay.getByRole("button", { name: "← Kembali" }).click();
    await overlay.getByRole("button", { name: "✕ Tutup" }).click();
    await page.getByRole("button", { name: "📋 Submit ke Asman" }).click();
    await expect(page.getByText(DRAFT_BUTTON_NAME)).not.toBeVisible();
  });

  test("autosave lapangan pulih setelah reload sebelum Simpan Draft ditekan", async ({ isolatedPage: page }) => {
    await openDraftSession(page);
    await page.getByRole("button", { name: "Mulai Hitung" }).click();
    let overlay = overlayOf(page);
    await overlay.getByText("GTK — A-01").click();
    await overlay.getByText("Isolator Keramik 150 kV").click();
    await overlay.locator("input[type=number]").fill("5");
    // "✔ Simpan Saja" cukup — ini menulis state activeOpname (setQtyForBlok), yang men-trigger
    // efek autosave localStorage tiap activeOpname berubah selama lapanganMode true. TIDAK
    // menekan "💾 Simpan Draft" (itu yang justru menghapus draft recovery setelah sukses).
    await overlay.getByRole("button", { name: "✔ Simpan Saja" }).click();

    // context.addInitScript() dari fixture (isolatedPage) jalan ULANG tiap navigasi/reload dan
    // localStorage.clear() dulu sebelum re-seed cloud fixture asli — draft recovery yang baru
    // ditulis runtime akan ikut terhapus kalau tidak ditangkap & disuntik ulang di sini. Ini
    // teknik test-only (tidak menyentuh src/), bukan bug app: yang diuji tetap restore-on-mount
    // App yang sesungguhnya membaca localStorage saat mount, bukan mekanisme reload di sini.
    const draftKey = "warnoto_opname_draft_OPN-E2E-01";
    const draftValue = await page.evaluate(key => localStorage.getItem(key), draftKey);
    expect(draftValue, "autosave harus sudah menulis draft sebelum reload").not.toBeNull();
    await page.context().addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: draftKey, value: draftValue });

    await page.reload();
    await openApp(page);
    await openRoute(page, STOCK_OPNAME);
    await page.getByRole("button", { name: DRAFT_BUTTON_NAME }).click();

    await expect(page.getByText("Hitungan lapangan lokal dipulihkan")).toBeVisible();
    await page.getByRole("button", { name: /Lanjut Hitung — 1\/2/ }).click();
    overlay = overlayOf(page);
    await overlay.getByText("GTK — A-01").click();
    await expect(overlay.getByText("5", { exact: true })).toBeVisible();
  });
});
