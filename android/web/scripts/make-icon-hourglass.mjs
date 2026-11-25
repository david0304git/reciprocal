import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const PAPER = "#F4F1E9";
const GREEN = "#27614F";
const MINT = "#CFDCD2";
const INK = "#1F1B17";

// Hourglass traced from the reference: long rounded bars, straight shoulders, diagonals that
// meet at a narrow waist with a small gap.
const hourglass = ({ barY = [27, 81], barX = [36, 72], bodyX = [37.5, 70.5], shoulderY = 41, waistY = 57, waistGap = 3.2 } = {}) => {
  const [topY, bottomY] = barY;
  const [barLeft, barRight] = barX;
  const [left, right] = bodyX;
  const waistLeft = 54 - waistGap;
  const waistRight = 54 + waistGap;
  return {
    bars: [
      `M${barLeft} ${topY}H${barRight}`,
      `M${barLeft} ${bottomY}H${barRight}`,
    ],
    body: [
      `M${left} ${topY}V${shoulderY}L${waistLeft} ${waistY}L${left} ${bottomY - (bottomY - 73)}V${bottomY}`,
      `M${right} ${topY}V${shoulderY}L${waistRight} ${waistY}L${right} 73V${bottomY}`,
    ],
  };
};

const hourglassSvg = ({ stroke = 3.1, ink = INK, sand = null, scale = 1 }) => {
  const shape = hourglass();
  const paths = [...shape.bars, ...shape.body]
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  const sandDot = sand
    ? `<path d="M50.6 74.4h6.8l-3.4 4.6z" fill="${sand}"/>`
    : "";
  return `<g transform="translate(54 54) scale(${scale}) translate(-54 -54)">${paths}${sandDot}</g>`;
};

const concepts = [
  {
    id: "M1",
    name: "線稿・墨黑",
    desc: "完全照參考圖的細線沙漏（墨黑 on 紙色）",
    bg: PAPER,
    body: () => hourglassSvg({ stroke: 3.1, ink: INK }),
  },
  {
    id: "M2",
    name: "線稿・品牌綠",
    desc: "同一個線稿，改成 App 的品牌綠",
    bg: PAPER,
    body: () => hourglassSvg({ stroke: 3.1, ink: GREEN }),
  },
  {
    id: "M3",
    name: "粗線版",
    desc: "線寬 4.6：48dp 縮圖時仍然清楚（建議值）",
    bg: PAPER,
    body: () => hourglassSvg({ stroke: 4.6, ink: GREEN }),
  },
  {
    id: "M4",
    name: "線稿＋沙粒",
    desc: "細線本體＋一點實心沙粒，兼顧線稿感與辨識",
    bg: PAPER,
    body: () => hourglassSvg({ stroke: 3.4, ink: GREEN, sand: GREEN }),
  },
  {
    id: "M5",
    name: "反白版",
    desc: "深綠底＋紙色線稿：桌面縮圖最跳",
    bg: GREEN,
    body: () => hourglassSvg({ stroke: 4.2, ink: PAPER }),
  },
  {
    id: "M6",
    name: "實心版",
    desc: "沙漏填實（上下橫桿＋三角），最小尺寸也不糊",
    bg: PAPER,
    body: () => `
      <rect x="34" y="25" width="40" height="5.4" rx="2.7" fill="${GREEN}"/>
      <rect x="34" y="77.6" width="40" height="5.4" rx="2.7" fill="${GREEN}"/>
      <path d="M38.5 27.7h31L57 54l12.5 26.3h-31L51 54z" fill="${GREEN}"/>
      <path d="M51.4 54h5.2" stroke="${PAPER}" stroke-width="2.4" stroke-linecap="round"/>`,
  },
];

const svgFile = (concept) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="512" height="512">
  <rect width="108" height="108" fill="${concept.bg}"/>
  ${concept.body()}
</svg>`;

for (const concept of concepts) writeFileSync(`icon-${concept.id}.svg`, svgFile(concept));

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
          <div class="small small--48" style="background:${concept.bg}">
            <svg viewBox="0 0 108 108" width="40" height="40">${concept.body()}</svg>
          </div>
          <span class="hint">48dp / 32dp</span>
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
  .small-row { display: flex; align-items: flex-end; gap: 12px; margin-top: 10px; }
  .small { border-radius: 28%; display: grid; place-items: center; overflow: hidden;
           box-shadow: 0 2px 6px rgba(60,50,35,0.18); padding: 4px; }
  .hint { font-size: 10.5px; color: #9a9284; margin-left: 4px; }
</style></head><body>
  <h1>Reciprocal · 沙漏（依參考圖形）</h1>
  <p class="sub">以你給的線稿沙漏為基礎：長橫桿、直肩、腰間小缺口。全部純向量、可直接轉 Android vector drawable。</p>
  <div class="grid">${cells}</div>
</body></html>`;

writeFileSync("/tmp/icon-hourglass.html", html);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 2 });
await page.goto("file:///tmp/icon-hourglass.html");
await page.waitForTimeout(400);
await page.screenshot({ path: "/Users/lutszhong/Documents/AndroidStudio/Reciprocal/artifacts/icons/preview-hourglass.png", fullPage: true });
await browser.close();
console.log("hourglass preview written");
