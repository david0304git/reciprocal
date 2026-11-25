import { chromium } from "playwright-core";

const UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/157.0.0.0 Mobile Safari/537.36";
const KEY = "reciprocal.browser-preview.v1";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 393, height: 873 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: UA,
  locale: "zh-Hant",
});
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const readHome = () =>
  page.evaluate(() => {
    const hero = document.querySelector(".home-now");
    return {
      hero: hero
        ? {
            title: hero.querySelector(".home-now__title")?.textContent.trim(),
            countdown: hero.querySelector(".home-now__countdown")?.textContent.trim(),
            kicker: hero.querySelector(".home-now__kicker")?.textContent.trim(),
          }
        : null,
      rows: Array.from(document.querySelectorAll(".agenda-row")).map((row) => ({
        title: row.querySelector(".agenda-row__title")?.textContent.trim(),
        when: row.querySelector(".agenda-row__when")?.textContent.trim(),
      })),
      empty: document.querySelector(".home__empty-title")?.textContent.trim() ?? null,
      peek: (() => {
        const el = document.querySelector(".timetable-peek");
        return el
          ? {
              label: el.querySelector(".timetable-peek__label")?.textContent.trim(),
              title: el.querySelector(".timetable-peek__title")?.textContent.trim(),
              time: el.querySelector(".timetable-peek__time")?.textContent.trim(),
            }
          : null;
      })(),
      sheet: document.querySelector(".timetable-sheet") ? {
        rows: Array.from(document.querySelectorAll(".timetable-sheet__row")).map((row) =>
          row.textContent.replace(/\s+/g, " ").trim(),
        ),
      } : null,
    };
  });

const seed = async (mutate) => {
  await page.evaluate(
    ([key, source]) => {
      const db = JSON.parse(localStorage.getItem(key));
      const fn = new Function("db", source); // eslint-disable-line no-new-func
      fn(db);
      localStorage.setItem(key, JSON.stringify(db));
    },
    [KEY, mutate],
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
};

await page.goto("http://localhost:4173", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
console.log("1 default            ", JSON.stringify(await readHome()));

// events at +10 and +40 days to exercise the range setting
await seed(`
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const make = (id, title, dayOffset, start, end) => ({
    id, title, notes: "", date: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset)),
    startTime: start, endTime: end, allDay: false, color: "#5B7DB1", category: "工作",
    source: "local", externalId: null, externalCalendar: null, externalCalendarId: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  db.events = [make(801, "十天後的檢討", 10, "10:00", "11:00"), make(802, "四十天後的旅行", 40, "09:00", "10:00")];
  db.timetable = [{ id: 901, day: (now.getDay() === 0 ? 7 : now.getDay()), startTime: "00:00", endTime: "23:59", title: "全天專注", notes: "", color: "#3F7C6A", createdAt: "2026-01-01T00:00:00.000Z" }];
  db.settings.homeEventRangeDays = "7";
`);
console.log("2 range 7            ", JSON.stringify(await readHome()));
await page.screenshot({ path: "artifacts/screenshots/web-home-agenda.png" });

await seed(`db.settings.homeEventRangeDays = "14";`);
console.log("3 range 14           ", JSON.stringify(await readHome()));

await seed(`db.settings.homeEventRangeDays = "30";`);
console.log("4 range 30           ", JSON.stringify(await readHome()));

await seed(`db.events = []; db.settings.homeEventRangeDays = "30";`);
console.log("5 empty              ", JSON.stringify(await readHome()));

// open the sheet by tapping the peek row
await page.locator(".timetable-peek").click();
await page.waitForTimeout(400);
console.log("6 sheet via tap      ", JSON.stringify(await readHome()));
await page.screenshot({ path: "artifacts/screenshots/web-home-peek-sheet.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
console.log("7 escape closes      ", (await readHome()).sheet === null);

// swipe up on the 安排 nav item
await page.evaluate(() => {
  const item = document.querySelectorAll(".nav__item")[2];
  const rect = item.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    pointerId: 21,
    pointerType: "touch",
    isPrimary: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height - 6,
  };
  item.dispatchEvent(new PointerEvent("pointerdown", base));
  item.dispatchEvent(new PointerEvent("pointermove", { ...base, clientY: base.clientY - 40 }));
  item.dispatchEvent(new PointerEvent("pointerup", { ...base, clientY: base.clientY - 40 }));
});
await page.waitForTimeout(400);
const afterSwipe = await readHome();
console.log("8 swipe opens sheet  ", afterSwipe.sheet !== null, JSON.stringify(afterSwipe.sheet?.rows ?? []));

console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
await browser.close();
