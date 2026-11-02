import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const base = process.env.BASE_URL ?? "http://localhost:1420";
const outDir = path.resolve(".shots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1320, height: 860 },
  deviceScaleFactor: 1,
  colorScheme: "light",
});
const page = await context.newPage();
const problems = [];
const checks = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

const shot = async (name) => {
  if (await page.locator(".toast").count()) {
    await page.waitForTimeout(3500);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`shot ${name}`);
};

const nav = async (label) => {
  await page.locator(".nav__item", { hasText: label }).first().click();
  await page.waitForTimeout(300);
};

const assert = (condition, message) => {
  checks.push({ ok: Boolean(condition), message });
  console.log(`${condition ? "PASS" : "FAIL"} ${message}`);
};

await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".habit-row");

/* ---------------------------------------------------------------- today */
const habitChecks = page.locator(".habit-row .check");
await habitChecks.nth(0).click();
await habitChecks.nth(1).click();
await page.waitForTimeout(400);
assert((await page.locator(".habit-row--done").count()) === 2, "兩個習慣可打卡");
assert((await page.locator(".today-card__ratio").innerText()).trim() === "2/3", "今日進度 2/3");
assert((await page.locator(".timeline__row").count()) >= 2, "今日時間軸含固定安排");
assert(
  (await page.locator(".timeline").innerText()).includes("週計畫與信箱"),
  "今日時間軸顯示週一固定安排",
);
await shot("today");

/* ---------------------------------------------------------------- habits */
await nav("習慣");
await shot("habits");
await page.locator(".habit-card").first().hover();
await shot("habits-hover");

await page.getByRole("button", { name: /新增習慣/ }).first().click();
await page.waitForTimeout(300);
await page.locator("#habit-form input.input").first().fill("拉伸 5 分鐘");
const habitModalBox = await page.locator(".modal").boundingBox();
assert(
  habitModalBox && habitModalBox.y > 0 && habitModalBox.y + habitModalBox.height <= 860,
  "習慣表單 modal 完整顯示",
);
await shot("habit-form");
await page.getByRole("button", { name: "建立習慣" }).click();
await page.waitForTimeout(600);
assert((await page.locator(".habit-card").count()) === 4, "新增習慣後卡片數為 4");

const lastCard = page.locator(".habit-card").last();
await lastCard.hover();
await lastCard.locator(".habit-card__delete").click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "刪除", exact: true }).click();
await page.waitForTimeout(500);
assert((await page.locator(".habit-card").count()) === 3, "可從卡片直接刪除習慣");

await page.locator(".habit-card").first().click();
await page.waitForTimeout(400);
assert(await page.locator(".modal").isVisible(), "習慣詳情 modal 可見");
await shot("habit-detail");
await page.keyboard.press("Escape");

/* ---------------------------------------------------------------- timetable */
await nav("事務");
await shot("tasks");
assert((await page.locator(".tt__hour").count()) === 24, "時間表顯示全天 24 個小時格");
const hourLabels = (await page.locator(".tt__hour").allInnerTexts()).map((label) => label.trim());
assert(hourLabels[0] === "00:00", "時間表從 00:00 開始");
assert(hourLabels[hourLabels.length - 1] === "23:00", "時間表到 24:00 結束（最後一格 23:00）");

const wedColumn = page.locator(".tt__col").nth(2);
await wedColumn.locator(".tt__cell").nth(16).click(); // 全天 00:00 起算，第 16 格 = 16:00
await page.waitForTimeout(350);
assert(await page.locator("#timetable-form").isVisible(), "點空白時段開啟安排表單");
const timetableTimeSelects = page.locator("#timetable-form .time-field select");
assert((await timetableTimeSelects.count()) === 4, "固定安排使用 24 小時時間欄位");
assert((await timetableTimeSelects.first().inputValue()) === "16", "點 16:00 時段會帶入 24 小時制時間");
assert(
  !/上午|下午/.test(await page.locator("#timetable-form").innerText()),
  "固定安排表單沒有 12 小時制文字",
);
const formHourSelects = page.locator("#timetable-form .time-field select");
const startHours = await formHourSelects.nth(0).locator("option").allInnerTexts();
const endHours = await formHourSelects.nth(2).locator("option").allInnerTexts();
assert(startHours[0] === "00" && startHours.includes("23"), "開始時間可選全天 00–23");
assert(endHours[0] === "00" && endHours.includes("23"), "結束時間可選全天 00–23");
await page.locator("#timetable-form input.input").first().fill("客戶拜訪");
await page.waitForTimeout(200);
await shot("timetable-form");
await page.locator('button[form="timetable-form"]').click();
await page.waitForTimeout(600);
assert(
  (await page.locator(".tt__block", { hasText: "客戶拜訪" }).count()) === 1,
  "週時間表新增安排成功",
);
await shot("tasks-after-add");

await page.locator(".tt__block", { hasText: "客戶拜訪" }).click();
await page.waitForTimeout(350);
await page.locator(".modal .btn--danger-text").click();
await page.waitForTimeout(250);
await page.locator(".modal .btn--danger").click();
await page.waitForTimeout(500);
assert(
  (await page.locator(".tt__block", { hasText: "客戶拜訪" }).count()) === 0,
  "可刪除固定安排",
);

/* ---------------------------------------------------------------- task tab */
await page.getByRole("tab", { name: "待辦清單" }).click();
await page.waitForTimeout(350);
assert(await page.locator(".task-panel").isVisible(), "可切換到待辦清單");
await shot("tasks-list");

await page.locator(".quick-add--wide input").fill("寫下這週的三個重點");
await page.locator(".quick-add--wide input").press("Enter");
await page.waitForTimeout(500);
assert(
  (await page.locator(".task__title", { hasText: "寫下這週的三個重點" }).count()) === 1,
  "快速新增事務成功",
);

await page.getByRole("tab", { name: "已完成" }).click();
await page.waitForTimeout(300);
assert((await page.locator(".task").count()) >= 1, "已完成篩選能顯示完成項目");
await page.getByRole("tab", { name: "全部" }).click();
await page.waitForTimeout(200);

await page.getByRole("tab", { name: "看板" }).click();
await page.waitForTimeout(400);
await shot("tasks-board");
const card = page.locator(".task-card").first();
const target = page.locator(".board__column").nth(1);
if ((await card.count()) && (await target.count())) {
  await card.dragTo(target);
  await page.waitForTimeout(700);
  const doingCount = await page
    .locator(".board__column")
    .nth(1)
    .locator(".task-card")
    .count();
  assert(doingCount >= 2, "拖曳卡片到「進行中」成功");
}

await page.locator(".task-panel .toolbar .btn--primary").click();
await page.waitForTimeout(350);
const taskBox = await page.locator(".modal").boundingBox();
assert(taskBox && taskBox.y > 0 && taskBox.y + taskBox.height <= 860, "事務表單 modal 完整顯示");
await shot("task-form");
await page.keyboard.press("Escape");

/* ---------------------------------------------------------------- calendar */
await nav("日曆");
await page.waitForTimeout(500);
assert((await page.locator(".countdown-card").count()) >= 1, "倒數卡片有行程");
const countdownText = await page.locator(".countdown-list").innerText();
assert(/後|今天|進行中/.test(countdownText), "倒數卡片顯示剩餘時間");
await shot("calendar");

/* 長標題不應撐寬日曆格子 */
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  const date = new Date();
  date.setDate(date.getDate() + 3);
  const iso = date.toISOString().slice(0, 10);
  raw.events = raw.events.filter((event) => event.id !== 9998);
  raw.events.push({
    id: 9998,
    title: "這是一個非常非常非常長的行程標題用來測試日曆格子會不會被撐寬",
    notes: "",
    date: iso,
    startTime: "10:00",
    endTime: "11:00",
    allDay: false,
    color: "#D98A5F",
    location: "",
    category: "個人",
    source: "local",
    externalId: null,
    externalCalendar: null,
    externalCalendarId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const calendarMetrics = await page.evaluate(() => {
  const card = document.querySelector(".calendar");
  const cell = document.querySelector(".day");
  const chip = [...document.querySelectorAll(".day__event")].find((element) =>
    element.textContent.includes("非常"),
  );
  const style = chip ? getComputedStyle(chip) : null;
  return {
    cardScroll: card.scrollWidth,
    cardClient: card.clientWidth,
    cellWidth: cell.getBoundingClientRect().width,
    chipWidth: chip ? chip.getBoundingClientRect().width : 0,
    textOverflow: style ? style.textOverflow : "",
    whiteSpace: style ? style.whiteSpace : "",
  };
});
assert(
  calendarMetrics.cardScroll <= calendarMetrics.cardClient + 1,
  "長標題不會撐寬日曆",
);
assert(
  !calendarMetrics.chipWidth || calendarMetrics.chipWidth <= calendarMetrics.cellWidth + 1,
  "行程標籤不超出格子",
);
assert(calendarMetrics.textOverflow === "ellipsis", "長標題以省略號截斷");
await page.screenshot({ path: path.join(outDir, "calendar-long-title.png") });

await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  raw.events = raw.events.filter((event) => event.id !== 9998);
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);

const wednesday = page.locator('.day[aria-label*="11 月 4 日"]');
await wednesday.click();
await page.waitForTimeout(400);
assert(
  (await page.locator(".day-detail .tt-list").innerText()).includes("英文課"),
  "當日細節顯示該星期的固定安排",
);
await shot("calendar-day");

await page.locator(".day-detail .btn--soft").click();
await page.waitForTimeout(350);
const eventBox = await page.locator(".modal").boundingBox();
assert(
  eventBox && eventBox.y > 0 && eventBox.y + eventBox.height <= 860,
  "行程表單 modal 完整顯示",
);
assert(
  (await page.locator("#event-form .time-field select").count()) === 4,
  "行程表單使用 24 小時時間欄位",
);
await shot("event-form");
await page.keyboard.press("Escape");

/* ---------------------------------------------------------------- stats + settings */
await nav("統計");
await shot("stats");
await nav("設定");
await shot("settings");

/* Apple 日曆過濾（瀏覽器預覽用 mock 資料） */
await page.evaluate(() => {
  localStorage.setItem("reciprocal.mockApple", "1");
  localStorage.setItem("reciprocal.mockAppleSelected", JSON.stringify(["CAL-WORK", "CAL-PERSONAL"]));
  localStorage.setItem("reciprocal.mockAppleCardSelected", JSON.stringify(["CAL-WORK"]));
});
await page.reload({ waitUntil: "networkidle" });
await nav("設定");
await page.waitForTimeout(900);
const importChoices = page.locator(
  ".calendar-picker:not(.calendar-picker--cards) .calendar-choice",
);
const cardChoices = page.locator(".calendar-picker--cards .calendar-choice");
assert((await importChoices.count()) === 5, "顯示要匯入的日曆清單");
assert(
  (await page
    .locator(".calendar-picker:not(.calendar-picker--cards) .calendar-choice input:checked")
    .count()) === 2,
  "匯入清單預設勾選 2 個",
);
assert((await cardChoices.count()) === 5, "顯示倒數卡片日曆清單");
assert(
  (await page.locator(".calendar-picker--cards .calendar-choice input:checked").count()) === 1,
  "倒數清單獨立勾選 1 個",
);
await page
  .locator('.card:has-text("Apple 日曆")')
  .screenshot({ path: path.join(outDir, "settings-apple-card.png") });
console.log("shot settings-apple-card");

await page
  .locator('.calendar-picker:not(.calendar-picker--cards) .calendar-choice:has-text("24 節氣") input')
  .check();
await page.waitForTimeout(1000);
assert(
  (await page
    .locator(".calendar-picker:not(.calendar-picker--cards) .calendar-choice input:checked")
    .count()) === 3,
  "勾選要匯入的日曆後立即套用",
);
assert(
  (await page.evaluate(
    () => JSON.parse(localStorage.getItem("reciprocal.mockAppleSelected") || "[]").length,
  )) === 3,
  "匯入日曆篩選已寫入設定",
);

await page
  .locator('.calendar-picker--cards .calendar-choice:has-text("生日") input')
  .check();
await page.waitForTimeout(500);
assert(
  (await page.locator(".calendar-picker--cards .calendar-choice input:checked").count()) === 2,
  "倒數卡片日曆可獨立勾選",
);
assert(
  (await page.evaluate(
    () => JSON.parse(localStorage.getItem("reciprocal.mockAppleCardSelected") || "[]"),
  )).includes("CAL-BIRTHDAY"),
  "倒數卡片篩選已獨立寫入設定",
);
await shot("settings-apple");

const rangeSelects = page.locator(".range-control select");
assert((await rangeSelects.count()) === 2, "可設定匯入的過去／未來範圍");
await rangeSelects.first().selectOption("1095");
await page.waitForTimeout(900);
assert(
  (await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1")).settings
        .appleImportPastDays,
  )) === "1095",
  "匯入範圍已寫入設定",
);

/* 倒數卡片過濾：注入一個 CAL-HOLIDAY 的 Apple 行程驗證 */
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = tomorrow.toISOString().slice(0, 10);
  raw.events = raw.events.filter((event) => event.id !== 9999);
  raw.events.push({
    id: 9999,
    title: "節氣測試事件",
    notes: "",
    date: iso,
    startTime: "10:00",
    endTime: "11:00",
    allDay: false,
    color: "#5B7DB1",
    location: "",
    category: "Apple",
    source: "apple",
    externalId: "EXT-TEST-1",
    externalCalendar: "24 節氣",
    externalCalendarId: "CAL-HOLIDAY",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  raw.settings.appleCardCalendarIds = JSON.stringify(["CAL-WORK"]);
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
  localStorage.setItem("reciprocal.mockAppleCardSelected", JSON.stringify(["CAL-WORK"]));
});
await page.reload({ waitUntil: "networkidle" });
await nav("日曆");
await page.waitForTimeout(600);
assert(
  (await page.locator(".countdown-card", { hasText: "節氣測試事件" }).count()) === 0,
  "倒數卡片過濾掉未勾選的日曆",
);
await page.screenshot({ path: path.join(outDir, "calendar-card-filter.png") });

await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  raw.settings.appleCardCalendarIds = JSON.stringify(["CAL-WORK", "CAL-HOLIDAY"]);
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
  localStorage.setItem(
    "reciprocal.mockAppleCardSelected",
    JSON.stringify(["CAL-WORK", "CAL-HOLIDAY"]),
  );
});
await page.reload({ waitUntil: "networkidle" });
await nav("日曆");
await page.waitForTimeout(600);
assert(
  (await page.locator(".countdown-card", { hasText: "節氣測試事件" }).count()) === 1,
  "勾選後倒數卡片顯示該日曆的行程",
);

await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  raw.events = raw.events.filter((event) => event.id !== 9999);
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
});
/* 建立行程時使用 Apple 分類（顏色＋日曆） */
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  raw.settings.appleSyncEnabled = "1";
  raw.settings.appleCalendarId = "CAL-RECIP";
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
});
await page.evaluate(() => localStorage.setItem("reciprocal.mockAppleSyncCount", "0"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1600);
assert(
  Number((await page.evaluate(() => localStorage.getItem("reciprocal.mockAppleSyncCount"))) ?? 0) >= 1,
  "啟動後會自動同步 Apple 日曆",
);
await nav("日曆");
await page.waitForTimeout(500);
await page.locator(".page__actions .btn--primary").click();
await page.waitForTimeout(1000);
assert((await page.locator(".apple-category").count()) === 3, "建立行程時可選 Apple 分類");
await page.locator('.apple-category', { hasText: "工作" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, "event-form-apple.png") });
await page.locator("#event-form input.input").first().fill("分類測試行程");
await page.evaluate(() => localStorage.setItem("reciprocal.mockAppleSyncCount", "0"));
await page.locator('button[form="event-form"]').click();
await page.waitForTimeout(1600);
assert(
  Number((await page.evaluate(() => localStorage.getItem("reciprocal.mockAppleSyncCount"))) ?? 0) >= 1,
  "儲存行程後會自動同步 Apple 日曆",
);

/* 關閉自動同步後，儲存不應再觸發同步 */
await nav("設定");
await page.waitForTimeout(600);
await page.getByRole("switch", { name: "自動同步", exact: true }).click();
await page.waitForTimeout(500);
assert(
  (await page.evaluate(
    () => JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1")).settings.appleAutoSync,
  )) === "0",
  "可關閉自動同步",
);
await nav("日曆");
await page.locator(".page__actions .btn--primary").click();
await page.waitForTimeout(900);
await page.locator("#event-form input.input").first().fill("關閉自動同步測試");
await page.evaluate(() => localStorage.setItem("reciprocal.mockAppleSyncCount", "0"));
await page.locator('button[form="event-form"]').click();
await page.waitForTimeout(1600);
assert(
  Number((await page.evaluate(() => localStorage.getItem("reciprocal.mockAppleSyncCount"))) ?? 0) === 0,
  "關閉自動同步後儲存不會自動同步",
);
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  raw.events = raw.events.filter((event) => event.title !== "關閉自動同步測試");
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
});
const createdEvent = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  const event = raw.events.find((item) => item.title === "分類測試行程");
  return event
    ? {
        category: event.category,
        color: event.color,
        calendarId: event.externalCalendarId,
      }
    : null;
});
assert(createdEvent?.category === "工作", "新行程使用 Apple 分類");
assert(createdEvent?.calendarId === "CAL-WORK", "新行程指定 Apple 日曆");
assert(createdEvent?.color === "#5B7DB1", "新行程顏色跟隨 Apple 分類");

await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  raw.events = raw.events.filter((event) => event.title !== "分類測試行程");
  delete raw.settings.appleSyncEnabled;
  delete raw.settings.appleCalendarId;
  delete raw.settings.appleAutoSync;
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
});
await page.evaluate(() => {
  localStorage.removeItem("reciprocal.mockApple");
  localStorage.removeItem("reciprocal.mockAppleSelected");
  localStorage.removeItem("reciprocal.mockAppleCardSelected");
});
await page.reload({ waitUntil: "networkidle" });
await nav("設定");
await page.waitForTimeout(400);

/* 更新檢查（mock GitHub 最新版本 0.2.0） */
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  raw.settings.checkUpdatesOnLaunch = "1";
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
  localStorage.setItem("reciprocal.mockUpdate", "1");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1400);
assert(
  (await page.locator(".update-banner").innerText()).includes("0.2.0"),
  "啟動時檢查更新並顯示新版本提示",
);
await page.getByRole("button", { name: "關閉更新提示" }).click();
await page.waitForTimeout(300);
assert((await page.locator(".update-banner").count()) === 0, "可關閉更新提示");
await nav("設定");
await page.waitForTimeout(500);
assert(
  (await page.getByRole("switch", { name: "啟動時檢查更新" }).getAttribute("aria-checked")) ===
    "true",
  "啟動時檢查更新開關狀態",
);
assert(
  (await page.locator('.card:has-text("從 GitHub Releases 檢查")').innerText()).includes("0.2.0"),
  "設定頁顯示 GitHub 最新版本",
);
await page.screenshot({ path: path.join(outDir, "update-settings.png") });
await page
  .locator('.card:has-text("從 GitHub Releases 檢查")')
  .screenshot({ path: path.join(outDir, "update-card.png") });
console.log("shot update-card");
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("reciprocal.browser-preview.v1"));
  delete raw.settings.checkUpdatesOnLaunch;
  localStorage.setItem("reciprocal.browser-preview.v1", JSON.stringify(raw));
  localStorage.removeItem("reciprocal.mockUpdate");
});
await page.reload({ waitUntil: "networkidle" });
await nav("設定");
await page.waitForTimeout(400);

await page.getByRole("tab", { name: /深色/ }).click();
await page.waitForTimeout(450);
assert(
  (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark",
  "切換深色主題立即生效",
);
await nav("今日");
await shot("today-dark");
await nav("日曆");
await shot("calendar-dark");
await nav("事務");
await shot("tasks-dark");

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
assert(
  (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark",
  "重新載入後仍保持深色主題",
);

await nav("設定");
await page.getByRole("tab", { name: /淺色/ }).click();
await page.waitForTimeout(350);

const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (problems.length) {
  console.log("PROBLEMS:");
  for (const problem of problems.slice(0, 20)) console.log(" -", problem);
} else {
  console.log("no console errors");
}
await browser.close();
process.exit(failed.length ? 1 : 0);
