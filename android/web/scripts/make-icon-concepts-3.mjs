import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const PAPER = "#F4F1E9";
const GREEN = "#27614F";
const MINT = "#CFDCD2";
const CREAM = "#FFFDF8";
const INK = "#1F1B17";

const concepts = [
  {
    id: "M",
    name: "沙漏",
    desc: "時間在流動：最直覺的「倒數」，輪廓在小尺寸也清楚",
    bg: PAPER,
    body: () => `
      <rect x="36" y="28" width="36" height="6" rx="3" fill="${GREEN}"/>
      <rect x="36" y="74" width="36" height="6" rx="3" fill="${GREEN}"/>
      <path d="M42 34h24l-12 20 12 20H42l12-20z" fill="${GREEN}"/>
      <circle cx="54" cy="70" r="3.4" fill="${MINT}"/>`,
  },
  {
    id: "N",
    name: "四頁長紙",
    desc: "四條並排、其中一頁被選中：直接對應左至右的四頁介面",
    bg: PAPER,
    body: () => {
      const x0 = 31;
      const step = 12.5;
      return [0, 1, 2, 3]
        .map((index) => {
          const active = index === 1;
          const fill = active ? GREEN : MINT;
          const y = active ? 32 : 38;
          const height = active ? 44 : 32;
          return `<rect x="${x0 + index * step}" y="${y}" width="9.5" height="${height}" rx="4.6" fill="${fill}"/>`;
        })
        .join("");
    },
  },
  {
    id: "O",
    name: "時間軸",
    desc: "一條線與「此刻」：行程的節奏，圓點讓它好辨識",
    bg: PAPER,
    body: () => `
      <path d="M28 54h52" stroke="${MINT}" stroke-width="7" stroke-linecap="round"/>
      <circle cx="36" cy="54" r="5" fill="${MINT}"/>
      <circle cx="72" cy="54" r="5" fill="${MINT}"/>
      <circle cx="54" cy="54" r="9" fill="${GREEN}"/>`,
  },
  {
    id: "P",
    name: "打卡勾印",
    desc: "圓角方框＋一筆勾：對應打卡與完成，最中性、最好懂",
    bg: PAPER,
    body: () => `
      <rect x="31" y="31" width="46" height="46" rx="13" fill="none" stroke="${GREEN}" stroke-width="5.6"/>
      <path d="M42 55l9 9 16-19" fill="none" stroke="${GREEN}" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: "Q",
    name: "摺紙三角",
    desc: "對摺的一張紙：幾何、對稱，像一個記號而不是插圖",
    bg: PAPER,
    body: () => `
      <path d="M54 26L84 82H24z" fill="${MINT}"/>
      <path d="M54 26L54 82H24z" fill="${GREEN}"/>
      <path d="M54 26v56" stroke="${PAPER}" stroke-width="4" stroke-linecap="round"/>`,
  },
  {
    id: "R",
    name: "迴圈箭頭",
    desc: "reciprocal 的字義：去又回，方形迴圈比圓形更有辨識度",
    bg: PAPER,
    body: () => `
      <path d="M70 38H42a10 10 0 0 0-10 10v12a10 10 0 0 0 10 10h20a10 10 0 0 0 10-10V50"
            fill="none" stroke="${GREEN}" stroke-width="7.4" stroke-linecap="round"/>
      <path d="M64 26l8 12-14 3z" fill="${GREEN}"/>`,
  },
];

const svg = (concept) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="512" height="512">
  <rect width="108" height="108" fill="${concept.bg}"/>
  ${concept.body()}
</svg>`;

for (const concept of concepts) writeFileSync(`icon-${concept.id}.svg`, svg(concept));

const cells = concepts
  .map(
    (concept) => `
    <div class="cell">
      <div class="big" style="background:${concept.bg}">
        <svg viewBox="0 0 108 108">${concept.body()}</svg>
      </div>
      <div class="meta">
        <div class="name"><b>${concept.id}</b> · ${concept.name}</div>
        <div class="desc">${concept.desc}</div>
        <div class="small-row">
          <div class="small" style="background:${concept.bg}">
            <svg viewBox="0 0 108 108" width="60" height="60">${concept.body()}</svg>
          </div>
          <span class="hint">48dp 實際大小</span>
        </div>
      </div>
    </div>`,
  )
  .join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #f3f0e9; font-family: -apple-system, "Noto Sans TC", sans-serif; color: #1f1b17; }
  h1 { font-size: 20px; margin: 28px 32px 4px; }
  p.sub { margin: 0 32px 20px; color: #6b6459; font-size: 12.5px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; padding: 0 32px 32px; }
  .cell { background: #fffdf8; border: 1px solid #e4dccb; border-radius: 16px; padding: 18px; }
  .big { width: 100%; aspect-ratio: 1; border-radius: 28%; display: grid; place-items: center; overflow: hidden;
         box-shadow: 0 10px 24px rgba(60,50,35,0.16); }
  .big svg { width: 100%; height: 100%; }
  .meta { padding-top: 12px; }
  .name { font-size: 14px; }
  .desc { font-size: 11.5px; color: #6b6459; margin-top: 3px; min-height: 30px; }
  .small-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .small { border-radius: 28%; display: grid; place-items: center; overflow: hidden;
           box-shadow: 0 2px 6px rgba(60,50,35,0.18); }
  .hint { font-size: 10.5px; color: #9a9284; }
</style></head><body>
  <h1>Reciprocal · 第三批方向（6 選）</h1>
  <p class="sub">108×108 adaptive icon 設計框（安全區直徑 66 的圓），純向量。小圖為 48dp 實際大小。</p>
  <div class="grid">${cells}</div>
</body></html>`;

writeFileSync("/tmp/icon-preview-3.html", html);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 2 });
await page.goto("file:///tmp/icon-preview-3.html");
await page.waitForTimeout(400);
await page.screenshot({ path: "/Users/lutszhong/Documents/AndroidStudio/Reciprocal/artifacts/icons/preview-3.png", fullPage: true });
await browser.close();
console.log("preview-3 written");
