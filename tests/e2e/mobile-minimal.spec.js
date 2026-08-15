const { test, expect } = require("./fixtures");
const { openApp, openRoute } = require("./support/responsive");
const { SURFACES } = require("./route-manifest");

// Stock/catalog card-tables permanently hide some columns via page-specific
// `!important` rules unrelated to the generic collapse feature; pick surfaces
// that rely on the plain nth-of-type(n+5) rule instead (e.g. Material Cadang's
// 14-column table, which the CSS comment names as the feature's target).
// Rows whose card opens a detail modal via onClick (Data Stok, Material
// Cadang, Forecast) never reveal hidden td on :focus by design — that's not
// the mechanism under test. Only rows without onClick rely on :focus to
// expand in place (AuditLogPage.jsx, MigrasiDataTab.jsx, StockCountTab.jsx).
const ROW_CANDIDATE_SURFACES = ["master-catalog"]
  .map(slug => SURFACES.find(s => s.slug === slug))
  .filter(Boolean);
const NOTE_CANDIDATE_SURFACES = ["master-warehouse", "master-migration", "master-permissions"]
  .map(slug => SURFACES.find(s => s.slug === slug))
  .filter(Boolean);

test.describe("Mode ringkas HP", () => {
  test.describe.configure({ timeout:180_000 });

  test("mobile-card-table row: td tersembunyi lalu terbuka saat focus", async ({ isolatedPage:page }) => {
    let found = false;
    for (const surface of ROW_CANDIDATE_SURFACES) {
      await openApp(page);
      await openRoute(page, surface);
      const rows = page.locator(".mobile-card-table__row").filter({ has:page.locator("td:nth-child(5)") });
      const rowCount = await rows.count();
      let row = null;
      for (let i = 0; i < rowCount; i++) {
        const candidate = rows.nth(i);
        if (await candidate.evaluate(el => !!el.closest(".stock-card-table"))) continue;
        row = candidate;
        break;
      }
      if (!row) continue;
      found = true;

      const before = await row.evaluate(el => {
        const tds = [...el.querySelectorAll("td")];
        return {
          total:tds.length,
          visible:tds.filter(td => getComputedStyle(td).display !== "none").length,
        };
      });
      expect(before.visible, `${surface.slug}: harus ada td tersembunyi sebelum focus`).toBeLessThan(before.total);

      await row.focus();
      const afterVisible = await row.evaluate(el => [...el.querySelectorAll("td")].filter(td => getComputedStyle(td).display !== "none").length);
      expect(afterVisible, `${surface.slug}: td terlihat harus bertambah setelah focus`).toBeGreaterThan(before.visible);
      break;
    }
    expect(found, "tidak ada .mobile-card-table__row dengan >4 td di fixture E2E").toBe(true);
  });

  test(".info-note terpotong 2 baris lalu terbuka saat focus", async ({ isolatedPage:page }) => {
    let found = false;
    for (const surface of NOTE_CANDIDATE_SURFACES) {
      await openApp(page);
      await openRoute(page, surface);
      const notes = page.locator(".info-note");
      const count = await notes.count();
      for (let i = 0; i < count; i++) {
        const note = notes.nth(i);
        const before = await note.evaluate(el => ({ scrollHeight:el.scrollHeight, clientHeight:el.clientHeight }));
        if (before.scrollHeight <= before.clientHeight) continue;
        found = true;

        await note.focus();
        const afterHeight = await note.evaluate(el => el.clientHeight);
        expect(afterHeight, `${surface.slug}: .info-note harus melebar setelah focus`).toBeGreaterThan(before.clientHeight);
        break;
      }
      if (found) break;
    }
    expect(found, "tidak ada .info-note yang terpotong 2 baris di fixture E2E").toBe(true);
  });

  test("teks penjelas Pak War disembunyikan di HP", async ({ isolatedPage:page }) => {
    await openApp(page);
    await openRoute(page, { tab:"ai", menuPath:["Pak War"], readySelector:".ai-agent-page" });

    const smalls = page.locator(".ai-quick-prompts button small");
    const count = await smalls.count();
    expect(count, "tidak ada .ai-quick-prompts button small di fixture E2E").toBeGreaterThan(0);

    const displays = await smalls.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).display));
    expect(displays.every(display => display === "none")).toBe(true);
  });
});
