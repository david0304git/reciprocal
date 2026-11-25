/*
 * Renders the desktop icon set (icon.png, 32/64/128/128@2x, icon.ico, icon.icns) from the same
 * hourglass mark the Android adaptive icon uses, so both platforms show the same tile.
 *
 * The Android icon itself is a vector adaptive icon
 * (android/app/src/main/res/drawable/ic_launcher_{foreground,monochrome}.xml) and is edited there;
 * this script only regenerates the desktop/Windows raster set.
 *
 *   node scripts/make-desktop-icons.mjs <outDir>
 *
 * Requires: macOS (iconutil), python3 with Pillow, and playwright-core + a local Chrome.
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? "artifacts/desktop-icons";
const PAPER = "#F4F1E9";
const GREEN = "#27614F";

// Same geometry as ic_launcher_foreground.xml (108x108 grid): bars x 36–72, shoulders y 27–41,
// waist y 57 with a small gap.
const hourglass = (scale) => `
  <g transform="translate(54 54) scale(${scale}) translate(-54 -54)">
    <path d="M36 27H72" fill="none" stroke="${GREEN}" stroke-width="3.1" stroke-linecap="round"/>
    <path d="M36 81H72" fill="none" stroke="${GREEN}" stroke-width="3.1" stroke-linecap="round"/>
    <path d="M37.5 27V41L50.8 57L37.5 73V81" fill="none" stroke="${GREEN}" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M70.5 27V41L57.2 57L70.5 73V81" fill="none" stroke="${GREEN}" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

// Desktop tiles are a paper squircle with the mark at 58% of the tile height (the mobile icon is
// smaller on purpose: Android reserves a safe zone around the glyph).
const tileSvg = ({ size, radius = 0.224, markScale = 1.16 }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect x="0" y="0" width="1024" height="1024" rx="${1024 * radius}" fill="${PAPER}"/>
  <svg x="0" y="0" width="1024" height="1024" viewBox="0 0 108 108">${hourglass(markScale)}</svg>
</svg>`;

mkdirSync(outDir, { recursive: true });

// One render at 1024 (exact viewport, transparent corners) then downscale, so every size is a
// clean resize of the same artwork.
const master = path.join(outDir, "icon-1024.png");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(
  `<html><body style="margin:0;padding:0;background:transparent">${tileSvg({ size: 1024 })}</body></html>`,
);
await page.waitForTimeout(150);
await page.screenshot({ path: master, omitBackground: true });
await browser.close();
writeFileSync(path.join(outDir, "icon-1024.svg"), tileSvg({ size: 1024 }));

// PNG sizes + multi-resolution .ico are produced with Pillow.
execFileSync("python3", [
  "-c",
  `from PIL import Image
import sys
master_path, out_dir = sys.argv[1], sys.argv[2]
master = Image.open(master_path).convert("RGBA")
for size in [16, 32, 64, 128, 256, 512]:
    master.resize((size, size), Image.LANCZOS).save(f"{out_dir}/icon-{size}.png")
master.save(f"{out_dir}/icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print("png + ico written")
`,
  master,
  outDir,
]);

// .icns from the rendered PNGs (macOS iconutil).
const iconset = path.join(outDir, "icon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const [source, name] of [
  ["icon-16.png", "icon_16x16.png"],
  ["icon-32.png", "icon_16x16@2x.png"],
  ["icon-32.png", "icon_32x32.png"],
  ["icon-64.png", "icon_32x32@2x.png"],
  ["icon-128.png", "icon_128x128.png"],
  ["icon-256.png", "icon_128x128@2x.png"],
  ["icon-256.png", "icon_256x256.png"],
  ["icon-512.png", "icon_256x256@2x.png"],
  ["icon-512.png", "icon_512x512.png"],
  ["icon-1024.png", "icon_512x512@2x.png"],
]) {
  execFileSync("cp", [path.join(outDir, source), path.join(iconset, name)]);
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(outDir, "icon.icns")]);
rmSync(iconset, { recursive: true, force: true });

console.log("icons written to", outDir);
