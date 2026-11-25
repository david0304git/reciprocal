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
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto("http://localhost:4173", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

// open the calendar and the "new event" sheet
await page.getByRole("button", { name: "日曆", exact: false }).first().click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /新增行程/ }).first().click();
await page.waitForTimeout(600);

const nativeSelects = await page.locator(".modal select").count();
console.log("native <select> in modal:", nativeSelects);

// time picker
const trigger = page.locator(".time-field__trigger").first();
console.log("trigger before:", (await trigger.innerText()).replace(/\s+/g, ""));
await trigger.click();
await page.waitForTimeout(300);
await page.screenshot({ path: "artifacts/screenshots/web-event-time-picker.png" });
const pickerVisible = await page.locator(".time-picker").first().isVisible();
await page.locator(".time-picker__col").first().getByRole("option", { name: "14", exact: true }).click();
await page.waitForTimeout(150);
await page.locator(".time-picker__col").nth(1).getByRole("option", { name: "30", exact: true }).click();
await page.waitForTimeout(150);
console.log("trigger after:", (await trigger.innerText()).replace(/\s+/g, ""));
await page.getByRole("button", { name: "完成", exact: true }).first().click();
await page.waitForTimeout(200);
console.log("picker closed:", (await page.locator(".time-picker").count()) === 0);

// custom category
console.log("chips before:", await page.locator(".modal .category-chip").allInnerTexts());
await page.getByRole("button", { name: /自訂/ }).first().click();
await page.waitForTimeout(250);
await page.getByRole("textbox", { name: "新分類名稱" }).fill("冥想");
await page.getByRole("button", { name: "新增", exact: true }).first().click();
await page.waitForTimeout(500);
const chips = await page.locator(".modal .category-chip").allInnerTexts();
console.log("chips after:", chips.map((text) => text.replace(/\s+/g, "")));
const stored = await page.evaluate(() => {
  const raw = localStorage.getItem("reciprocal.browser-preview.v1");
  const db = raw ? JSON.parse(raw) : null;
  return db?.settings?.eventCategories ?? null;
});
console.log("stored eventCategories:", stored);
await page.screenshot({ path: "artifacts/screenshots/web-event-custom-category.png" });

// ---------------------------------------------------------------- date picker
const nativeDateInputs = await page.locator('.modal input[type="date"]').count();
console.log("native date inputs in modal:", nativeDateInputs);
const dateTrigger = page.locator(".date-field__trigger").first();
console.log("date trigger:", (await dateTrigger.innerText()).replace(/\s+/g, " "));
await dateTrigger.click();
await page.waitForTimeout(300);
console.log("date picker open:", await page.locator(".date-picker").first().isVisible());
console.log("month title:", await page.locator(".date-picker__title").first().innerText());
await page.locator('.date-picker__nav[aria-label="下個月"]').first().click();
await page.waitForTimeout(200);
console.log("month after next:", await page.locator(".date-picker__title").first().innerText());
await page.screenshot({ path: "artifacts/screenshots/web-event-date-picker.png" });
await page.locator(".date-picker__day.is-outside").first().click();
await page.waitForTimeout(250);
console.log("date trigger after pick:", (await dateTrigger.innerText()).replace(/\s+/g, " "));
await page.locator(".date-field__trigger").first().click();
await page.waitForTimeout(200);
await page.locator(".date-picker__foot").getByRole("button", { name: "今天", exact: true }).click();
await page.waitForTimeout(250);
console.log("date trigger after today:", (await dateTrigger.innerText()).replace(/\s+/g, " "));

// swiss + dark look of the same sheet
await page.getByRole("button", { name: "取消", exact: true }).first().click();
await page.waitForTimeout(300);
await page.evaluate(() => {
  document.documentElement.dataset.uiStyle = "swiss";
  document.documentElement.dataset.theme = "dark";
});
await page.getByRole("button", { name: /新增行程/ }).first().click();
await page.waitForTimeout(400);
await page.locator(".time-field__trigger").first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: "artifacts/screenshots/web-event-time-picker-swiss-dark.png" });

// ------------------------------------------------------- task due date (optional)
await page.evaluate(() => {
  const cancel = Array.from(document.querySelectorAll(".modal button")).find(
    (el) => el.textContent.trim() === "取消",
  );
  cancel?.click();
  document.documentElement.dataset.uiStyle = "paper";
  document.documentElement.dataset.theme = "light";
});
await page.waitForTimeout(500);
await page.getByRole("button", { name: "安排", exact: false }).first().click();
await page.waitForTimeout(500);
await page.getByRole("tab", { name: /待辦清單/ }).first().click();
await page.waitForTimeout(500);
await page.evaluate(() => {
  const add = Array.from(document.querySelectorAll("button")).find(
    (el) => /新增/.test(el.textContent) && el.offsetParent,
  );
  add?.click();
});
await page.waitForTimeout(600);
const dueTrigger = page.locator(".date-field__trigger").first();
console.log("due trigger (empty):", (await dueTrigger.innerText()).replace(/\s+/g, " "));
await dueTrigger.click();
await page.waitForTimeout(300);
await page.locator(".date-picker__day:not(.is-outside)").nth(10).click();
await page.waitForTimeout(250);
console.log("due after pick:", (await dueTrigger.innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: "artifacts/screenshots/web-task-due-date.png" });
await dueTrigger.click();
await page.waitForTimeout(250);
await page.locator(".date-picker__foot").getByRole("button", { name: "清除", exact: true }).click();
await page.waitForTimeout(250);
console.log("due after clear:", (await dueTrigger.innerText()).replace(/\s+/g, " "));

console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
await browser.close();
