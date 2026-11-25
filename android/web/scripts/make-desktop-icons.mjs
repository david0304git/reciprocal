/*
 * Renders the desktop icon set (macOS .icns, Windows .ico, Tauri PNG sizes) from the same
 * hourglass mark used by the Android adaptive icon, so both platforms show the same tile.
 *
 *   node scripts/make-desktop-icons.mjs <outDir>
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const outDir = process.argv[2] ?? "artifacts/desktop-icons";
const PAPER = "#F4F1E9";
const GREEN = "#27614F";

// Same geometry as res/drawable/ic_launcher_foreground.xml (108x108 grid): bars x 36–72,
// shoulders y 27–41, waist y 57 with a 6.4 gap.
const hourglass = (scale) => `
  <g transform="translate(54 54) scale(${scale}) translate(-54 -54)">
    <path d="M36 27H72" fill="none" stroke="${GREEN}" stroke-width="3.1" stroke-linecap="round"/>
    <path d="M36 81H72" fill="none" stroke="${GREEN}" stroke-width="3.1" stroke-linecap="round"/>
    <path d="M37.5 27V41L50.8 57L37.5 73V81" fill="none" stroke="${GREEN}" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M70.5 27V41L57.2 57L70.5 73V81" fill="none" stroke="${GREEN}" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

// macOS/Windows both get the paper squircle; the mark fills 58% of the tile height.
const tileSvg = ({ size, radius = 0.224, markScale = 1.16, circle = false }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"${
  circle
    ? `><circle cx="512" cy="512" r="512" fill="${PAPER}"/>`
    : `><rect x="0" y="0" width="1024" height="1024" rx="${1024 * radius}" fill="${PAPER}"/>`
}
  <svg x="0" y="0" width="1024" height="1024" viewBox="0 0 108 108">${hourglass(markScale)}</svg>
</svg>`;

// Adaptive-icon foreground layer: transparent canvas, mark sized for the 66dp safe circle (the
// launcher draws the background). Mark height 50% of the canvas, as in the Gradle project.
const foregroundSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 108 108">
  ${hourglass(1)}
</svg>`;

const sizes = [16, 32, 64, 128, 256, 512, 1024];
mkdirSync(outDir, { recursive: true });

// Render once at 1024 (exact viewport, transparent background) and downscale with PIL so every
// size is a clean resize of the same artwork.
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(
  `<html><body style="margin:0;padding:0;background:transparent">${tileSvg({ size: 1024 })}</body></html>`,
);
await page.waitForTimeout(150);
const master = path.join(outDir, "icon-1024.png");
await page.screenshot({ path: master, omitBackground: true });
await browser.close();
writeFileSync(path.join(outDir, "icon-1024.svg"), tileSvg({ size: 1024 }));

// Extra masters for the Tauri mobile (Android) icon folders
const extras = [
  ["tile-round-1024.png", tileSvg({ size: 1024, circle: true })],
  ["foreground-1024.png", foregroundSvg()],
];
const extraBrowser = await chromium.launch({ channel: "chrome", headless: true });
const extraPage = await extraBrowser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [name, markup] of extras) {
  await extraPage.setContent(
    `<html><body style="margin:0;padding:0;background:transparent">${markup}</body></html>`,
  );
  await extraPage.waitForTimeout(120);
  await extraPage.screenshot({ path: path.join(outDir, name), omitBackground: true });
}
await extraBrowser.close();

execFileSync("python3", [
  "-c",
  `from PIL import Image
import sys
src, out_dir = sys.argv[1], sys.argv[2]
master = Image.open(src).convert("RGBA")
for size in [16, 32, 64, 128, 256, 512]:
    master.resize((size, size), Image.LANCZOS).save(f"{out_dir}/icon-{size}.png")
print("resized")
`,
  master,
  outDir,
]);

// .icns via iconutil (macOS) from the rendered PNGs
const iconset = path.join(outDir, "icon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
const icnsMap = [
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
];
for (const [source, name] of icnsMap) {
  execFileSync("cp", [path.join(outDir, source), path.join(iconset, name)]);
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(outDir, "icon.icns")]);
rmSync(iconset, { recursive: true, force: true });

// Tauri mobile (Android) mipmaps, when a Tauri icons directory is given as the second argument
const tauriIcons = process.argv[3];
if (tauriIcons) {
  const mipmaps = { "mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192 };
  execFileSync("python3", [
    "-c",
    `from PIL import Image
import sys, os
out_dir, round_src, fg_src = sys.argv[1], sys.argv[2], sys.argv[3]
tile = Image.open(os.path.join(out_dir, "icon-1024.png")).convert("RGBA")
circle = Image.open(round_src).convert("RGBA")
fg = Image.open(fg_src).convert("RGBA")
sizes = ${JSON.stringify(mipmaps)}
for folder, size in sizes.items():
    base = os.path.join(sys.argv[4], folder)
    os.makedirs(base, exist_ok=True)
    tw = tile.resize((size, size), Image.LANCZOS)
    tw.save(os.path.join(base, "ic_launcher.png"))
    circle.resize((size, size), Image.LANCZOS).save(os.path.join(base, "ic_launcher_round.png"))
    fg.resize((size, size), Image.LANCZOS).save(os.path.join(base, "ic_launcher_foreground.png"))
print("tauri mobile mipmaps written")
`,
    outDir,
    path.join(outDir, "tile-round-1024.png"),
    path.join(outDir, "foreground-1024.png"),
    tauriIcons,
  ]);
}

console.log("icons written to", outDir, sizes.join(", "), tauriIcons ? `+ mipmaps in ${tauriIcons}` : "");
