import { chromium } from "playwright-core";

const UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/157.0.0.0 Mobile Safari/537.36";
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

const KEY = "reciprocal.browser-preview.v1";
const heroText = () =>
  page.evaluate(() => {
    const card = document.querySelector(".home-now");
    if (!card) return null;
    const pick = (selector) => card.querySelector(selector)?.textContent.trim() ?? null;
    return {
      kicker: pick(".home-now__kicker"),
      title: pick(".home-now__title"),
      countdown: pick(".home-now__countdown"),
      meta: pick(".home-now__meta"),
      note: pick(".home-now__note"),
      hint: pick(".home-now__hint"),
    };
  });

const setDb = async (mutate) => {
  await page.evaluate(
    ([key, source]) => {
      const db = JSON.parse(localStorage.getItem(key));
      // eslint-disable-next-line no-new-func
      const fn = new Function("db", source);
      fn(db);
      localStorage.setItem(key, JSON.stringify(db));
    },
    [KEY, mutate],
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
};

await page.goto("http://localhost:4173", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
console.log("1 default mock        ", JSON.stringify(await heroText()));

// in-progress event today overlapping the 10:00 block, plus a later event
await setDb(`
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = iso(now);
  const at = (minutes) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, minutes); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const endMin = Math.min(nowMin + 20, 23 * 60 + 50);
  db.events = [
    { id: 501, title: "進行中的會議", notes: "", date: today, startTime: at(Math.max(0, nowMin - 20)), endTime: at(endMin), allDay: false, color: "#B06AA0", category: "工作", source: "local", externalId: null, externalCalendar: null, externalCalendarId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: 502, title: "晚上的聚餐", notes: "", date: today, startTime: at(nowMin + 180), endTime: at(nowMin + 240), allDay: false, color: "#D98A5F", category: "社交", source: "local", externalId: null, externalCalendar: null, externalCalendarId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: 503, title: "明天的簡報", notes: "", date: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)), startTime: "09:00", endTime: "10:00", allDay: false, color: "#5B7DB1", category: "工作", source: "local", externalId: null, externalCalendar: null, externalCalendarId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];
  db.timetable = [{ id: 701, day: (now.getDay() === 0 ? 7 : now.getDay()), startTime: "23:00", endTime: "23:59", title: "深夜專注", notes: "", color: "#3F7C6A", createdAt: "2026-01-01T00:00:00.000Z" }];
`);
console.log("2 in-progress + block ", JSON.stringify(await heroText()));
await page.screenshot({ path: "artifacts/screenshots/web-home-hero-event.png" });

// all-day event only
await setDb(`
  db.events = [db.events[0]];
  db.events[0].allDay = true;
  db.events[0].startTime = null;
  db.events[0].endTime = null;
  db.events[0].title = "今天是生日";
  db.timetable = [];
`);
console.log("3 all-day, no blocks  ", JSON.stringify(await heroText()));

// no events, only a block
await setDb(`
  db.events = [];
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const start = Math.max(0, Math.min(nowMin + 30, 23 * 60));
  db.timetable = [{ id: 601, day: (now.getDay() === 0 ? 7 : now.getDay()), startTime: pad(Math.floor(start / 60)) + ":" + pad(start % 60), endTime: pad(Math.floor(start / 60) + 1) + ":" + pad(start % 60), title: "下午的專注時段", notes: "", color: "#3F7C6A", createdAt: "2026-01-01T00:00:00.000Z" }];
`);
console.log("4 block only          ", JSON.stringify(await heroText()));

// nothing at all
await setDb(`
  db.events = [];
  db.timetable = [];
`);
console.log("5 nothing             ", JSON.stringify(await heroText()));

console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
await browser.close();
