import { chromium } from "playwright-core";
const UA = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 873 }, isMobile: true, hasTouch: true, userAgent: UA });
await page.goto("http://localhost:4173", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const describe = () => page.evaluate(() => ({
  order: localStorage.getItem("reciprocal.homeOrder"),
  cards: Array.from(document.querySelectorAll(".home__panels > .home-card")).map((el) => ({
    card: el.firstElementChild?.className.split(" ")[0],
    width: Math.round(el.getBoundingClientRect().width),
  })),
  panelsWidth: Math.round(document.querySelector(".home__panels").getBoundingClientRect().width),
  single: document.querySelector(".home__panels").className,
}));

console.log("initial  ", JSON.stringify(await describe()));

// --- drag the second card to the first position -------------------------------------------
const cards = page.locator(".home__panels > .home-card");
const second = cards.nth(1);
const box = await second.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 40);
await page.mouse.down();
await page.waitForTimeout(520);           // long press
await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 8 });
await page.waitForTimeout(120);
const dragging = await page.evaluate(() => !!document.querySelector(".home-card.is-dragging"));
await page.mouse.up();
await page.waitForTimeout(350);
console.log("dragging ", dragging);
console.log("after    ", JSON.stringify(await describe()));

// --- hide-today test: drop today's blocks from the mock db --------------------------------
await page.evaluate(() => {
  const key = "reciprocal.browser-preview.v1";
  const db = JSON.parse(localStorage.getItem(key));
  const weekday = new Date().getDay() === 0 ? 7 : new Date().getDay();
  db.timetable = db.timetable.filter((block) => block.day !== weekday);
  localStorage.setItem(key, JSON.stringify(db));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
console.log("no blocks", JSON.stringify(await describe()));
await page.screenshot({ path: "artifacts/screenshots/web-home-single-card.png" });

await browser.close();
