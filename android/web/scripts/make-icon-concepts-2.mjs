import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const PAPER = "#F4F1E9";
const GREEN = "#27614F";
const MINT = "#CFDCD2";
const INK = "#1F1B17";
const CREAM = "#FFFDF8";

const concepts = [
  {
    id: "G",
    name: "進度環",
    desc: "缺口圓環＋中心點：把「倒數」做成記號，小尺寸仍清楚",
    bg: PAPER,
    body: () => `
      <circle cx="54" cy="54" r="23" fill="none" stroke="${GREEN}" stroke-width="9"
              stroke-dasharray="113 32" stroke-linecap="round" transform="rotate(-60 54 54)"/>
      <circle cx="54" cy="54" r="5.5" fill="${GREEN}"/>`,
  },
  {
    id: "H",
    name: "日期格",
    desc: "九宮格中今天被填滿：日曆＋時間表一個記號說完",
    bg: PAPER,
    body: () => {
      const cells = [];
      const size = 13;
      const gap = 5;
      const start = 54 - (size * 3 + gap * 2) / 2;
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          const x = start + col * (size + gap);
          const y = start + row * (size + gap);
          const today = row === 1 && col === 1;
          cells.push(
            `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="3.4" fill="${today ? GREEN : MINT}"/>`,
          );
        }
      }
      return cells.join("");
    },
  },
  {
    id: "I",
    name: "節奏條",
    desc: "四根高低不同的圓角條：一週的節奏，橫向辨識度高",
    bg: PAPER,
    body: () => `
      <g fill="${GREEN}">
        <rect x="31" y="52" width="9" height="22" rx="4.5"/>
        <rect x="45" y="36" width="9" height="38" rx="4.5"/>
        <rect x="59" y="44" width="9" height="30" rx="4.5"/>
        <rect x="73" y="58" width="9" height="16" rx="4.5"/>
      </g>`,
  },
  {
    id: "J",
    name: "紙頁摺角",
    desc: "一張有摺角的紙：對應「一整張紙、鏡頭平移」的介面",
    bg: PAPER,
    body: () => `
      <rect x="33" y="26" width="42" height="56" rx="7" fill="${CREAM}" stroke="${GREEN}" stroke-width="3"/>
      <path d="M61 26h7a7 7 0 0 1 7 7v8L61 26z" fill="${MINT}" stroke="${GREEN}" stroke-width="3" stroke-linejoin="round"/>
      <rect x="42" y="52" width="24" height="3.4" rx="1.7" fill="${MINT}"/>
      <rect x="42" y="60" width="16" height="3.4" rx="1.7" fill="${MINT}"/>
      <rect x="42" y="68" width="20" height="3.4" rx="1.7" fill="${MINT}"/>`,
  },
  {
    id: "K",
    name: "鐘面指針",
    desc: "深綠鐘面＋紙色指針：直接放大主頁那顆大字時鐘",
    bg: PAPER,
    body: () => `
      <circle cx="54" cy="54" r="25" fill="${GREEN}"/>
      <path d="M54 54V37" stroke="${PAPER}" stroke-width="7" stroke-linecap="round"/>
      <path d="M54 54h13" stroke="${PAPER}" stroke-width="7" stroke-linecap="round"/>
      <circle cx="54" cy="54" r="4.4" fill="${PAPER}"/>`,
  },
  {
    id: "L",
    name: "R 字印記",
    desc: "幾何線條構成的 R：純字標，最容易和別家區隔",
    bg: PAPER,
    body: () => `
      <g stroke="${GREEN}" stroke-width="8.4" stroke-linecap="round" fill="none">
        <path d="M40 78V32"/>
        <path d="M40 32h15a13 13 0 0 1 0 26H40"/>
        <path d="M55 58l16 20"/>
      </g>
      <rect x="34" y="84" width="40" height="2.6" rx="1.3" fill="${MINT}"/>`,
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
  <h1>Reciprocal · 不用雙圈的方向（6 選）</h1>
  <p class="sub">同樣是 108×108 adaptive icon 設計框（安全區直徑 66 的圓），全部純向量。小圖為 48dp 實際大小。</p>
  <div class="grid">${cells}</div>
</body></html>`;

writeFileSync("/tmp/icon-preview-2.html", html);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 2 });
await page.goto("file:///tmp/icon-preview-2.html");
await page.waitForTimeout(400);
await page.screenshot({ path: "/Users/lutszhong/Documents/AndroidStudio/Reciprocal/artifacts/icons/preview-2.png", fullPage: true });
await browser.close();
console.log("preview-2 written");
