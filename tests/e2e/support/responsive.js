const { expect } = require("@playwright/test");

async function openApp(page) {
  await page.goto("/", { waitUntil:"domcontentloaded" });
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-current-tab", "dashboard");
}

async function openDrawer(page) {
  const opener = page.getByRole("button", { name:"Buka menu" });
  if (await opener.isVisible().catch(() => false)) await opener.click();
}

async function openRoute(page, { tab, menuPath, actions = [], readySelector }) {
  const shell = page.locator(".app-shell");
  if (menuPath) {
    await openDrawer(page);
    for (const name of menuPath) {
      await page.getByRole("button", { name, exact:true }).click();
    }
    await expect(shell).toHaveAttribute("data-current-tab", tab);
  }
  for (const action of actions) {
    let target = action.selector
      ? page.locator(action.selector)
      : page.getByRole(action.role, { name:action.name, exact:typeof action.name === "string" });
    if (action.index != null) target = target.nth(action.index);
    await expect(target).toBeVisible();
    await target.click();
  }
  await expect(page.locator(readySelector)).toBeVisible();
}

async function collectResponsiveIssues(page, scopeSelector) {
  return page.locator(scopeSelector).evaluate(scope => {
    const root = document.documentElement;
    const visible = el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const label = el => (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || el.tagName)
      .replace(/\s+/g," ").trim().slice(0,80);
    const documentOverflow = Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
    const touchTargets = [...scope.querySelectorAll("button, [role='button'], input:not([type='hidden']), select, textarea")]
      .filter(el => visible(el) && !el.disabled)
      .map(el => ({ label:label(el), width:Math.round(el.getBoundingClientRect().width), height:Math.round(el.getBoundingClientRect().height) }))
      .filter(item => item.width < 44 || item.height < 44)
      .slice(0,20);
    const smallText = [...scope.querySelectorAll("p, span, small, label, button, td, th, input, select, textarea")]
      .filter(el => visible(el) && label(el) && Number.parseFloat(getComputedStyle(el).fontSize) < 12)
      .filter(el => !(getComputedStyle(el).fontSize === "0px" && el.matches("button,[role='button']") && (el.getAttribute("aria-label") || el.getAttribute("title")) && el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44))
      .map(el => ({ label:label(el), fontSize:getComputedStyle(el).fontSize }))
      .slice(0,20);
    const formControls = [...scope.querySelectorAll("input:not([type='hidden']), select, textarea")]
      .filter(visible)
      .map(el => ({ label:label(el), width:Math.round(el.getBoundingClientRect().width), height:Math.round(el.getBoundingClientRect().height) }))
      .filter(item => item.width < 44 || item.height < 44)
      .slice(0,20);
    const unsafeTables = [...scope.querySelectorAll("table")].filter(visible).filter(table => {
      const rect = table.getBoundingClientRect();
      if (rect.left >= -1 && rect.right <= root.clientWidth + 1) return false;
      let parent = table.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (["auto","scroll"].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth) return false;
        parent = parent.parentElement;
      }
      return true;
    }).map(table => ({ width:Math.round(table.getBoundingClientRect().width), text:label(table) })).slice(0,10);
    return { documentOverflow, viewportWidth:root.clientWidth, touchTargets, smallText, formControls, unsafeTables };
  });
}

async function assertResponsiveSurface(page, scopeSelector) {
  const report = await collectResponsiveIssues(page, scopeSelector);
  expect(report, JSON.stringify(report, null, 2)).toEqual({
    documentOverflow:0,
    viewportWidth:report.viewportWidth,
    touchTargets:[],
    smallText:[],
    formControls:[],
    unsafeTables:[],
  });
}

async function assertDashboardCardContentBounds(page) {
  const report = await page.evaluate(() => {
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const label = el => (el.textContent || el.className || el.tagName).replace(/\s+/g," ").trim().slice(0,70);
    const cardSelector = ".exec-kpi,.exec-attention,.dashboard-insight-card,.dashboard-manager__hero,.dashboard-manager-kpi,.dashboard-manager__upt-card,.dashboard-analytics-card,.dashboard-heavy-summary";
    const cards = [...document.querySelectorAll(cardSelector)].filter(visible);
    const outOfBounds = [];
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const nodes = card.querySelectorAll("h2,h3,strong,small,p,.exec-kpi__copy,.dashboard-manager__inventory,.dashboard-manager__section-heading,.dashboard-analytics-card__heading,.dashboard-heavy-summary__heading,.dashboard-heavy-loan");
      for (const node of [...nodes].filter(visible)) {
        if (node.closest(".dashboard-manager__table-scroll") || node.closest(".dashboard-map-canvas")) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < box.left - 1 || rect.right > box.right + 1) {
          outOfBounds.push({ card:card.className, node:label(node), left:Math.round(rect.left-box.left), right:Math.round(rect.right-box.right) });
        }
      }
    }
    const collisionRows = [...document.querySelectorAll(".exec-kpi,.dashboard-manager-kpi,.dashboard-heavy-loan,.dashboard-analytics-card__heading,.dashboard-manager__section-heading")].filter(visible);
    const collisions = [];
    for (const row of collisionRows) {
      const children = [...row.children].filter(visible);
      for (let i=0; i<children.length; i++) for (let j=i+1; j<children.length; j++) {
        const a = children[i].getBoundingClientRect();
        const b = children[j].getBoundingClientRect();
        const overlapX = Math.min(a.right,b.right)-Math.max(a.left,b.left);
        const overlapY = Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        if (overlapX > 2 && overlapY > 2) collisions.push({ row:row.className, a:label(children[i]), b:label(children[j]) });
      }
    }
    return { outOfBounds:outOfBounds.slice(0,15), collisions:collisions.slice(0,15) };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({ outOfBounds:[], collisions:[] });
}

module.exports = { openApp, openRoute, collectResponsiveIssues, assertResponsiveSurface, assertDashboardCardContentBounds };
