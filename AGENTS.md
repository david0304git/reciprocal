# Reciprocal — 專案規則（由 DSH workspace loader 自動載入）

> 只放**長期規則**。當前狀態、已出貨內容與待辦放在 [`docs/SYNC.md`](docs/SYNC.md)，開工前先讀它。

## 專案結構

| 路徑 | 內容 |
| --- | --- |
| `src/`、`src-tauri/` | 桌面版（React 19 + Tauri 2 / Rust） |
| `android/` | Android 版（Kotlin ＋ WebView、Gradle）。`android/web/` 是 Android 使用的前端副本 |
| `scripts/make-desktop-icons.mjs` | 圖標母檔腳本：一次產生桌面 `.icns`／`.ico`／Store 圖標＋Tauri mobile mipmap |
| `android/scripts/` | Android 建置／安裝／E2E（Chrome DevTools Protocol） |

## 鐵律

1. **兩份前端必須逐位元組相同**（`src/` ↔ `android/web/src/`）
   ```bash
   rsync -a --exclude .DS_Store src/ android/web/src/
   diff -rq src android/web/src        # 必須無輸出
   ```
   `android/web` 另有自己的 `vite.config.ts`（`base: "./"`，給 WebViewAssetLoader）與 `index.html`，**不要**被桌面版覆蓋掉 base。
2. **圖標只有一條產生路徑**：`node scripts/make-desktop-icons.mjs <outDir> [src-tauri/icons/android]`
   - 桌面／Windows／iOS：同一個沙漏，mark 佔 tile 高度 **58%**
   - Android adaptive icon：`android/app/src/main/res/drawable/ic_launcher_{foreground,monochrome}.xml`，
     幾何再乘 **0.78**（0.1.8 依使用者回饋縮小；0.84→0.78）。**不要手改 PNG**。
3. **版本號要同步**：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、
   `android/app/build.gradle.kts`（`versionName`／`versionCode`）。
4. **介面決策（0.1.8 起，勿回退）**
   - 主頁＝近期行程清單：範圍 7／14／30 天、每列只有「名稱 ＋ 倒數」、長按拖曳自訂排序並持久化
   - 每週固定時段叫 **時間表**：導航上方 peek 列（現在／下一段）＋上拉面板，**只有主頁顯示**
   - 四頁（主頁／日曆／時間表／設定）左至右排成一條軌道，切換＝鏡頭平移（不是各自滑動）
   - 自製月曆／時間選擇器；不用原生 `date`／`select`
   - 液態玻璃：**側欄與主頁時鐘都不加框**
   - 排版：頁名距面板上緣 28px、四頁對齊；行程列 108px 上限、三張一屏不滾動
5. **驗證要求**（宣稱完成前要貼實測輸出，不能只說「應該可以」）
   ```bash
   npm run build                                  # tsc + vite
   npm run tauri build && open .../Reciprocal.app # 桌面：實際啟動
   android/scripts/build.sh :app:assembleDebug    # Android
   node android/scripts/e2e-android.mjs           # 需模擬器（21 項）
   ```
6. 發佈流程（版本、資產、校驗、Prerelease 注意事項）見 `docs/SYNC.md`。

## 已知落差（不要當成 bug 修）

- 看板拖放是 HTML5 DnD → **Android 觸控無效**，手機需點卡片改狀態（桌面可用滑鼠拖）。
- 桌面 mark 58%／Android 39% 是刻意的：Android 有安全區規範。
