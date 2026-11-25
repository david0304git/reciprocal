#!/usr/bin/env node
/*
 * Renders the web bundle at phone size and captures one screenshot per view.
 *
 *   npx vite preview --port 4174 --strictPort   # in another shell (serves web/dist)
 *   PREVIEW_URL=http://localhost:4174 node scripts/shoot-android.mjs
 *
 * Uses the locally installed Chrome through playwright-core; nothing is downloaded.
 *
 * Besides the per-view PNGs this script audits the DOM: it reports elements that
 * stick out of the 412 px viewport (ignoring intentional inside-a-scroller
 * overflow) and leaf text nodes that are visually truncated (nowrap/ellipsis +
 * scrollWidth > clientWidth). Both lists should stay empty.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const base = process.env.PREVIEW_URL || "http://127.0.0.1:4173";
const outDir = process.env.SHOT_DIR || "artifacts/screenshots";
const [viewportWidth, viewportHeight] = (process.env.VIEWPORT || "412x915")
  .split("x")
  .map(Number);
const viewport = { width: viewportWidth, height: viewportHeight };
const UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/157.0.0.0 Mobile Safari/537.36";

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: UA,
  colorScheme: "light",
  locale: "zh-Hant",
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const platform = await page.evaluate(() => document.documentElement.dataset.platform);
if (platform !== "android") {
  throw new Error(`expected data-platform="android", got "${platform}"`);
}

const prefix = process.env.SHOT_PREFIX || "";
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${prefix}${name}.png`) });
  console.log(`captured ${name}.png`);
};

const audit = async (label) => {
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const root = document.documentElement;
    const description = (el) => {
      const tag = el.tagName.toLowerCase();
      const cls =
        typeof el.className === "string" && el.className.trim()
          ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
          : "";
      return tag + cls;
    };
    const inHorizontalScroller = (el) => {
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (
          /(auto|scroll)/.test(style.overflowX) &&
          parent.scrollWidth > parent.clientWidth + 1
        ) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };

    const overflow = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (style.position === "fixed" && el.classList.contains("modal-backdrop")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.right <= vw + 0.5 && rect.left >= -0.5) continue;
      if (inHorizontalScroller(el)) continue;
      overflow.push({
        sel: description(el),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: (el.textContent || "").trim().slice(0, 34),
      });
    }

    const clipped = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length > 0) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const text = (el.textContent || "").trim();
      if (!text) continue;
      if (el.clientWidth < 2) continue;
      const truncates =
        /(hidden|clip)/.test(style.overflowX) ||
        style.textOverflow === "ellipsis" ||
        style.whiteSpace === "nowrap";
      if (!truncates) continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      if (el.getBoundingClientRect().width < 1) continue;
      const key = description(el) + "|" + text;
      if (seen.has(key)) continue;
      seen.add(key);
      clipped.push({
        sel: description(el),
        text: text.slice(0, 44),
        client: el.clientWidth,
        scroll: el.scrollWidth,
      });
    }

    const horizontalScrollers = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (!/(auto|scroll)/.test(style.overflowX)) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (el.getBoundingClientRect().height < 1) continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      horizontalScrollers.push({
        sel: description(el),
        client: el.clientWidth,
        scroll: el.scrollWidth,
      });
    }

    const smallTargets = [];
    for (const el of document.querySelectorAll(
      "button, [role=switch], input, select, textarea, a[href]",
    )) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.width >= 32 && rect.height >= 32) continue;
      smallTargets.push({
        sel: description(el),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        text: (el.textContent || "").trim().slice(0, 16),
      });
    }

    const main = document.querySelector(".main__scroll");
    return {
      platform: root.dataset.platform,
      uiStyle: root.dataset.uiStyle,
      theme: root.dataset.theme,
      viewport: `${vw}x${window.innerHeight}`,
      documentScrollWidth: root.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      mainScroll: main
        ? {
            clientWidth: main.clientWidth,
            scrollWidth: main.scrollWidth,
            overflowX: getComputedStyle(main).overflowX,
          }
        : null,
      overflow: overflow.slice(0, 20),
      clipped: clipped.slice(0, 30),
      horizontalScrollers,
      smallTargets: smallTargets.slice(0, 20),
    };
  });
  const problems =
    report.documentScrollWidth > viewportWidth + 1 ||
    report.overflow.length > 0 ||
    report.clipped.length > 0;
  console.log(`${problems ? "AUDIT ⚠" : "AUDIT ✓"} ${label} ${JSON.stringify(report)}`);
};

const scrollMainTo = async (position) => {
  await page.evaluate((next) => {
    const main = document.querySelector(".main__scroll");
    if (!main) return;
    main.scrollTo({ top: next === "bottom" ? main.scrollHeight : 0, behavior: "instant" });
  }, position);
  await page.waitForTimeout(400);
};

const capture = async (name, { keepScroll = false } = {}) => {
  if (!keepScroll) await scrollMainTo("top");
  await shot(name);
  await audit(name);
};

const clickNav = async (label) => {
  const button = page.getByRole("button", { name: label, exact: false }).first();
  await button.click();
  await page.waitForTimeout(650);
};

const closeModal = async () => {
  const close = page.locator(".modal__head .icon-btn").first();
  if (await close.count()) {
    await close.click();
    await page.waitForTimeout(350);
  }
};

const setStyle = async (label) => {
  await clickNav("設定");
  await page.getByRole("button", { name: label, exact: false }).first().click();
  await page.waitForTimeout(500);
};


/* ------------------------------------------------------------ paper, light */

await capture("web-home");

await clickNav("日曆");
await capture("web-calendar");

await clickNav("安排");
await capture("web-schedule");

// Timetable block form (day chips, time fields, colour swatches).
await page.getByRole("button", { name: /新增安排/ }).first().click();
await page.waitForTimeout(600);
await capture("web-timetable-form");
await closeModal();

// The week grid only fits a few columns on a phone: prove that it swipes.
await page.evaluate(() => {
  const scroller = document.querySelector(".tt-scroll");
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
});
await page.waitForTimeout(500);
await capture("web-timetable-end");
await page.evaluate(() => {
  const scroller = document.querySelector(".tt-scroll");
  if (scroller) scroller.scrollLeft = 0;
});
await page.waitForTimeout(300);

// Tasks tab + the task form bottom sheet.
await page.getByRole("tab", { name: "待辦清單", exact: false }).first().click();
await page.waitForTimeout(600);
await capture("web-schedule-tasks");
await page.getByRole("button", { name: /新增安排/ }).first().click();
await page.waitForTimeout(600);
await capture("web-task-form");
await closeModal();

// Kanban mode (horizontal columns).
await page.getByRole("tab", { name: "看板", exact: false }).first().click();
await page.waitForTimeout(500);
await capture("web-schedule-board");
await page.getByRole("tab", { name: "清單", exact: false }).first().click();
await page.waitForTimeout(300);

// Calendar day sheet (modal -> bottom sheet on Android).
await clickNav("日曆");
await page.locator(".calendar-grid .day--today").first().click();
await page.waitForTimeout(600);
await capture("web-calendar-day-sheet");
await closeModal();

// Event form: the tallest sheet, proves the modal body scrolls while the footer
// (and its safe-area padding) stays pinned.
await page.getByRole("button", { name: "新增行程", exact: false }).first().click();
await page.waitForTimeout(600);
await capture("web-event-form");
await page.evaluate(() => {
  const body = document.querySelector(".modal__body");
  if (body) body.scrollTop = body.scrollHeight;
});
await page.waitForTimeout(350);
await capture("web-event-form-bottom", { keepScroll: true });
await closeModal();

// Settings, top and bottom.
await clickNav("設定");
await capture("web-settings");
await page
  .locator(".card")
  .filter({ hasText: "外觀" })
  .first()
  .evaluate((element) => element.scrollIntoView({ block: "start" }));
await page.waitForTimeout(350);
await capture("web-settings-appearance", { keepScroll: true });
await scrollMainTo("bottom");
await capture("web-settings-bottom", { keepScroll: true });

// The browser mock can report a supported "system calendar" so the Android copy
// of the calendar card can be checked without the APK.
await page.evaluate(() => localStorage.setItem("reciprocal.mockApple", "1"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await clickNav("設定");
const calendarCard = page.locator(".card").filter({ hasText: "系統日曆" }).first();
await calendarCard.evaluate((element) => element.scrollIntoView({ block: "start" }));
await page.waitForTimeout(350);
await capture("web-settings-system-calendar", { keepScroll: true });
await page
  .locator(".setting-row")
  .filter({ hasText: "倒數卡片顯示的日曆" })
  .first()
  .evaluate((element) => element.scrollIntoView({ block: "start" }));
await page.waitForTimeout(350);
await capture("web-settings-system-calendar-bottom", { keepScroll: true });
await page.evaluate(() => localStorage.removeItem("reciprocal.mockApple"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);

/* ------------------------------------------------------- glass, light + dark */

await setStyle("液態玻璃");
await capture("web-settings-glass");
await clickNav("安排");
await capture("web-schedule-glass");
await clickNav("日曆");
await capture("web-calendar-glass");

// Dark mode through the real settings control (React keeps dataset.theme in sync).
await clickNav("設定");
await page.getByRole("tab", { name: "深色", exact: true }).first().click();
await page.waitForTimeout(600);
await capture("web-settings-glass-dark");
await clickNav("安排");
await capture("web-schedule-glass-dark");
await clickNav("日曆");
await capture("web-calendar-glass-dark");
await clickNav("主頁");
await capture("web-home-glass-dark");

/* ------------------------------------------------------------------- swiss */

await clickNav("設定");
await setStyle("瑞士工具");
await clickNav("設定");
await page.getByRole("tab", { name: "淺色", exact: true }).first().click();
await page.waitForTimeout(500);
await capture("web-settings-swiss");
await clickNav("安排");
await capture("web-schedule-swiss");
await clickNav("日曆");
await capture("web-calendar-swiss");

// The home page has its own Swiss grid — capture it in both themes (this is where a 300px
// desktop column used to squeeze the day-detail card on a phone).
await clickNav("主頁");
await capture("web-home-swiss");
await clickNav("設定");
await page.getByRole("tab", { name: "深色", exact: true }).first().click();
await page.waitForTimeout(500);
await clickNav("主頁");
await capture("web-home-swiss-dark");

// Leave the app in its default style for the next run (localStorage is per context).
await setStyle("紙本手帳");

console.log(consoleErrors.length ? `console errors:\n${consoleErrors.join("\n")}` : "no console errors");
await browser.close();
