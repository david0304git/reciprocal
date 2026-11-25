import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

// 108x108 adaptive-icon design box, safe zone = circle r 33 around (54,54)
const mark = ({ stroke = 5.6, ink = "#2F6B57", fill = "#C9D6CB", left = 45, right = 63, r = 18 } = {}) => `
  <circle cx="${left}" cy="54" r="${r}" fill="none" stroke="${ink}" stroke-width="${stroke}"/>
  <circle cx="${right}" cy="54" r="${r}" fill="${fill}"/>
  <circle cx="${right}" cy="54" r="${r}" fill="none" stroke="${ink}" stroke-width="${stroke}"/>`;

const concepts = [
  {
    id: "A",
    name: "雙圈 · 精修",
    desc: "沿用電腦版標記，線條加粗、對比提高",
    bg: "#F4F1E9",
    body: (strokeGrow = 0) => mark({ stroke: 5.6 + strokeGrow, ink: "#27614F", fill: "#CFDCD2" }),
  },
  {
    id: "B",
    name: "實心互鎖",
    desc: "深綠底＋挖空負空間，小尺寸最清楚",
    bg: "#2F6B57",
    body: () => `
      <circle cx="45" cy="54" r="18" fill="none" stroke="#F4F1E9" stroke-width="5.6"/>
      <circle cx="63" cy="54" r="18" fill="#F4F1E9"/>`,
  },
  {
    id: "C",
    name: "單線極簡",
    desc: "只有兩條線，適合主題圖示（monochrome）",
    bg: "#F7F4EC",
    body: () => `
      <circle cx="45" cy="54" r="18" fill="none" stroke="#1F1B17" stroke-width="4.6"/>
      <circle cx="63" cy="54" r="18" fill="none" stroke="#1F1B17" stroke-width="4.6"/>`,
  },
  {
    id: "D",
    name: "手帳印章",
    desc: "紙感＋錯位壓印，對應紙本手帳風格",
    bg: "#F7F4EC",
    body: () => `
      <g opacity="0.5" transform="translate(1.4,1.6)">
        <circle cx="45" cy="54" r="18" fill="none" stroke="#D9CFB6" stroke-width="5.2"/>
        <circle cx="63" cy="54" r="18" fill="#D9CFB6"/>
      </g>
      ${mark({ ink: "#2C6653", fill: "#CBD8CD", stroke: 5.2 })}
      <rect x="36" y="76" width="36" height="2.4" rx="1.2" fill="#C7BFA8"/>`,
  },
  {
    id: "E",
    name: "瑞士工具",
    desc: "嚴格幾何＋單一信號色，對應瑞士風格",
    bg: "#FFFFFF",
    body: () => `
      <path d="M18 36h72M18 54h72M18 72h72" stroke="#111111" stroke-width="0.8" opacity="0.18"/>
      <path d="M36 18v72M54 18v72M72 18v72" stroke="#111111" stroke-width="0.8" opacity="0.18"/>
      <circle cx="45" cy="54" r="17" fill="none" stroke="#111111" stroke-width="5"/>
      <circle cx="63" cy="54" r="17" fill="#111111"/>
      <rect x="66" y="66" width="10" height="10" fill="#E5484D"/>`,
  },
  {
    id: "F",
    name: "液態玻璃",
    desc: "柔和漸層＋玻璃圈，對應液態玻璃風格",
    bg: "gradient",
    body: () => `
      <circle cx="45" cy="54" r="18" fill="rgba(255,255,255,0.16)" stroke="rgba(28,44,38,0.30)" stroke-width="6.4"/>
      <circle cx="63" cy="54" r="18" fill="rgba(255,255,255,0.42)" stroke="rgba(28,44,38,0.30)" stroke-width="6.4"/>
      <circle cx="45" cy="54" r="18" fill="none" stroke="rgba(255,255,255,0.96)" stroke-width="4.6"/>
      <circle cx="63" cy="54" r="18" fill="none" stroke="rgba(255,255,255,0.96)" stroke-width="4.6"/>
      <path d="M54 39.5a18 18 0 0 1 9 27" stroke="rgba(255,255,255,0.98)" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  },
];

const svg = (concept) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFE2C6"/>
      <stop offset="0.5" stop-color="#E6D8F5"/>
      <stop offset="1" stop-color="#C9F0E2"/>
    </linearGradient>
  </defs>
  <rect width="108" height="108" fill="${concept.bg === "gradient" ? "url(#g)" : concept.bg}"/>
  ${concept.body()}
</svg>`;

for (const concept of concepts) {
  writeFileSync(`icon-${concept.id}.svg`, svg(concept));
}

const cells = concepts
  .map(
    (concept) => `
    <div class="cell">
      <div class="big" style="background:${concept.bg === "gradient" ? "linear-gradient(135deg,#FFE2C6,#E6D8F5,#C9F0E2)" : concept.bg}">
        <svg viewBox="0 0 108 108">${concept.body()}</svg>
      </div>
      <div class="meta">
        <div class="name"><b>${concept.id}</b> · ${concept.name}</div>
        <div class="desc">${concept.desc}</div>
        <div class="small-row">
          <div class="small" style="background:${concept.bg === "gradient" ? "linear-gradient(135deg,#FFE2C6,#E6D8F5,#C9F0E2)" : concept.bg}">
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
  h1 { font-size: 20px; margin: 28px 32px 4px; letter-spacing: 0.01em; }
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
  <h1>Reciprocal · 圖標方向（6 選）</h1>
  <p class="sub">全部以 Android adaptive icon 的 108×108 設計框製作（安全區：直徑 66 的圓），可直接輸成 vector drawable。下方小圖為 48dp 實際顯示大小。</p>
  <div class="grid">${cells}</div>
</body></html>`;

writeFileSync("/tmp/icon-preview.html", html);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 2 });
await page.goto("file:///tmp/icon-preview.html");
await page.waitForTimeout(400);
await page.screenshot({ path: "/Users/lutszhong/Documents/AndroidStudio/Reciprocal/artifacts/icons/preview.png", fullPage: true });
await browser.close();
console.log("preview written");
