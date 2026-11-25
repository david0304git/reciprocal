# Reciprocal — Android 版

> 把每天的小事記錄下來，讓生活慢慢回到自己手上。

這是 [david0304git/reciprocal](https://github.com/david0304git/reciprocal)（Tauri 2 桌面應用）的
**Android 版**。主頁大字時鐘、日曆、時間表（週時間表＋待辦清單/看板）、設定、三種介面風格
（紙本手帳／液態玻璃／瑞士工具）、淺色深色主題、備份匯出還原、更新檢查——功能與桌面版對等，
資料格式（SQLite schema v5 與備份 JSON）也完全互通。

## 架構：WebView 混合

```
┌──────────────────────────── Android App ────────────────────────────┐
│  MainActivity (Compose)                                             │
│    └─ WebView ── https://appassets.androidplatform.net/assets/web/   │
│         │           └─ React 19 + TS 前端（與桌面版同一份原始碼）      │
│         │                                                           │
│         │  window.__TAURI_INTERNALS__.invoke(cmd, args)             │
│         │  ← web/public/tauri-shim.js 把 Tauri IPC 轉接到原生         │
│         ▼                                                           │
│  ReciprocalNative (JavascriptInterface)                             │
│    └─ Bridge ─ CommandRouter ─┬─ StoreCommands    → SQLite           │
│                               ├─ PlatformCommands → SAF / GitHub     │
│                               └─ CalendarCommands → CalendarContract │
└─────────────────────────────────────────────────────────────────────┘
```

- **前端零改動**：`web/` 是上游 `src/` 的 fork，只加了 `tauri-shim.js`、手機版 `android.css`、
  返回鍵處理與少量 Android 文案；所有 UI 邏輯、資料流、設計系統都沿用原版。
- **後端 Kotlin 重寫**：上游 24 個 Tauri 指令（`load_app`、`save_task`、`apple_sync`…）在
  Kotlin 以相同名稱、相同 camelCase JSON 契約重新實作，React 完全不需要知道換了平台。
- **Apple 日曆 → Android 系統日曆**：桌面版的 EventKit 整合改用 `CalendarContract`，
  指令名稱仍是 `apple_*`（前端沿用），行為對等：權限、專用「Reciprocal」日曆、寫出/匯入、
  兩層日曆過濾、待刪除佇列。

## 建置

需求：JDK 17+（實測 25）、Android SDK Platform 37 + Build-Tools 36、Node 20+（僅重建前端時需要）。

```bash
# 1) 前端：打包並同步到 app/src/main/assets/web/
./scripts/build-web.sh

# 2) APK
./gradlew :app:assembleDebug
# 產物：app/build/outputs/apk/debug/app-debug.apk
```

用 Android Studio 直接開這個資料夾也可以（`web` 產生好的 assets 已隨專案提供，
沒裝 Node 也能編譯）。改完前端記得重新跑 `scripts/build-web.sh`。

> 在沙箱 / agent 環境裡請用 `./scripts/build.sh :app:assembleDebug`：它把 `GRADLE_USER_HOME`
> 指到專案內的 `.gradle-home/` 並用檔案鎖讓多個建置排隊，不依賴 `~/.gradle`。

## 驗證

```bash
# 編譯
./scripts/build.sh :app:compileDebugKotlin

# 與 Rust 原版逐條比對：SQL schema（13 條）、seed（6 條）、14 個 wire model 的欄位、
# 前端 28 個指令是否都有實作
python3 scripts/verify-parity.py

# 安裝到已啟動的模擬器 / 實機（並自動啟動）
./scripts/install-apk.sh

# 端到端檢查：透過 Chrome DevTools protocol 直接驅動 WebView 裡的 React 應用
node scripts/e2e-android.mjs
node scripts/e2e-android.mjs --only=backup --json
```

`e2e-android.mjs` 會實際呼叫 bridge：驗證 seed 資料、待辦/行程/時段 CRUD、設定持久化、
備份匯出與還原、資料庫 schema（`PRAGMA user_version = 5`）、更新檢查、系統日曆同步
（含用 `content query` 確認 CalendarProvider 真的建了「Reciprocal」日曆）、底部導覽與返回鍵
行為，並輸出各頁截圖到 `artifacts/screenshots/`。

### 最近一次驗證紀錄（2026-11-24，Pixel 9 模擬器 / Android 16 / API 36；另在 POCO F4 真機手動確認）

| 項目 | 結果 |
| --- | --- |
| `scripts/e2e-android.mjs` | **20/20 PASS**（含空狀態首次啟動、視口高度、日曆雙向同步、備份相容性） |
| `scripts/verify-parity.py` | **PASS**：schema 13/13、seed（Android 刻意無示範資料）、模型 14/14、指令覆蓋 28/28 |
| debug APK | `app-debug.apk`，實機啟動、資料寫入 SQLite 皆正常 |
| release APK（R8） | 以 debug keystore 簽章後安裝可跑（資料、UI、bridge 正常） |

## 首次啟動：沒有任何示範資料

桌面版第一次啟動會寫入 3 個習慣、2 筆行程、3 項待辦、6 個時段當示範；**Android 版刻意不做**：

- 全新安裝開啟即是空狀態（主頁「接下來 N 天沒有行程」、日曆 0 筆、時間表空白、待辦空白）。
- 只會寫入 `settings.onboarded = '1'`（與桌面版相同的「已初始化」標記）。
- `scripts/verify-parity.py` 會斷言這件事：Kotlin 的 seed 不得包含任何 `INSERT INTO habits / habit_logs / events / tasks / timetable`。

### 舊版安裝的清理（DB v6 遷移）

之前安裝過的人，升級後會執行一次 `v5 → v6` 遷移，把舊版寫入的示範資料移除：

| 資料 | 處理 |
| --- | --- |
| 示範行程（與朋友午餐／月度回顧）、時段（6 筆）、待辦（3 筆）、習慣與打卡 | 標題、時間、顏色、分類、備註**完全相符**才刪除 |
| 使用者自己新增或改過的資料 | 保留（例如把「月度回顧」改名後就不會被視為示範資料） |
| 已鏡像到系統日曆的示範行程 | 先寫入 `deleted_external_events` tombstone，下次同步時一併刪掉系統日曆裡的副本 |
| 沒有對應習慣的打卡孤兒列 | 一併清除 |

實測（模擬器，v5 資料庫）：升級後 `user_version = 6`、示範行程／排程／待辦／習慣／打卡全部歸零，
自己新增的行程與待辦保留，被 tombstone 指到的系統日曆副本 `_id=29` 也確實消失。

## 新增行程：自訂分類 ＋ 自製時間選擇器

**1. 分類可以自己加**

- 內建 5 個（個人／工作／社交／健康／學習）永遠存在；按「＋ 自訂」可新增（≤12 字），新增後自動選取。
- 自訂分類存在 `settings.eventCategories`（JSON 陣列，只存自訂的那幾個），所以**匯出備份會一起帶走**。
- 自訂分類的 chip 上有 `×` 可刪除；刪除只影響選單，既有行程的分類字串不會被改寫。
- 若某行程的分類不在清單裡（例如以前刪過的自訂、或 Apple 匯入的分類），它會被補進選單並保持選取，不會被默默改成「個人」。
- 開啟 Apple 日曆同步時，表單仍走原本的 Apple 分類選擇（寫入哪個系統日曆），兩套並存。

**2. 時間選擇器不再用原生樣式**

`TimeField` 原本是兩個原生 `<select>`（在 Android 上會變成系統的 spinner 下拉），現在改成自製面板：

| 項目 | 實作 |
| --- | --- |
| 觸發 | 整寬按鈕顯示 `09:00`＋箭頭，展開後箭頭旋轉、邊框轉強調色 |
| 面板 | 「時」「分」兩欄，各自 `scroll-snap` 捲動，開啟時自動把目前值置中 |
| 選取 | 點小時／分鐘立即生效，`完成` 收起；選中項用強調色填滿 |
| 風格 | 三種介面風格自動跟隨；瑞士工具改直角與黑白反白 |
| 版面 | 手機上「開始／結束」改為上下排列（`field-row--times`），面板才有足夠寬度 |
| 觸控 | Android 上觸發鈕 42px、選項列 40px |

**驗證**：E2E `ui/event-form`（無原生 `<select>`、09:00→14:30 走自製面板、自訂分類新增後寫入 settings 且可刪除），
瀏覽器另有 `web/scripts/verify-event-form.mjs`。

> 日期欄位仍是原生 `<input type="date">`（Android 原生日期選擇器），你只提到小時／分鐘，所以我先沒動；
> 要一起換成自製日曆面板的話說一聲。

### 底部安全區域只算一次

原生層原本就把 WebView 墊高 `bars.bottom`（手勢列 24px），CSS 又用 `env(safe-area-inset-bottom)`
（同一支手機回報 24px）再墊一次 → 導航列下方多出約 24px 死空間。
`MainActivity` 的 inset 監聽改成**只墊鍵盤高度**（`ime.bottom`），手勢列交給網頁處理：
導航列背景一路畫到螢幕底部、標籤靠 `env(safe-area-inset-bottom)` 留在手勢列上方。
實測 `gapBelowLabels` 由 **53px → 29px**，`innerHeight` 845 → 869。

## 主頁版面：行程清單 ＋ 時間表上拉

主頁改成「近期行程 feed」，時間表（每週時段）搬到底部導航上的上拉面板。

**行程清單**

- 範圍可調：**7 / 14 / 30 天**（設定 → 主頁），存在 `settings.homeEventRangeDays`，備份會帶走。
- **所有卡片同款式、只有兩項資訊**：`名稱` ＋ 右側 `多少時間之後`（無色點、無日期、無時間）
  （例如 `1 天 12 小時後`、`42 分鐘後`、`進行中`、全天的 `今天`）。
  **不顯示日期、不顯示具體時間、也沒有「接下來的行程」之類的分類標籤。**
- 依時間排序；沿用「倒數卡片顯示的日曆」篩選，避免匯入的公眾假期塞滿主頁。
- **長按 360ms 可拖曳自訂排序**：
  - 拖過其他列的中央時，其他列會在拖曳過程中即時讓位（不會放手才跳）。
  - 放手後寫入 `localStorage["reciprocal.homeEventOrder"]`（id 陣列），重開 App 仍保留。
  - 新行程／範圍變動後，未在自訂順序中的項目會依時間接在後面；清單少於 2 項時不啟用拖曳。
- **名稱與倒數各佔一半**：兩欄都是 `flex: 1 1 0`（倒數靠右、`tabular-nums`）。
  名稱起始 20px，**自動縮小塞進自己那半欄**（下限 15px），仍放不下就**換行最多兩行**再省略；
  量測用 canvas `measureText`（不依賴當前排版、不會 reflow 迴圈），換行時不會有橫向滾動。
- **長標題不會橫向滾動**：名稱最多換行兩行（`-webkit-line-clamp: 2`），倒數欄保留半欄並省略；
  `.agenda-row` 與 `.main__scroll` 都鎖住橫向溢出，實機 `documentElement.scrollWidth - clientWidth = 0`。
- **卡片會長高填滿頁面**：列用 `flex: 1 0 auto`，上限 108px——三張卡剛好佔滿一屏且**不需要滾動**；
  超過三張才開始捲動（實測 6 張在 393×873 每列 69px、12 張 60px 並可捲動）。
- 範圍內沒有行程 → 顯示空狀態（含「新增行程」），不會出現空的卡片。
- 頁首固定一個 `＋ 新增行程`。

**時間表：peek 列 ＋ 上拉面板**

- 導航列上方永遠有一條 **peek 列**：`現在 深夜專注 22:00 – 23:59` 或 `下一段 14:00 運動`；
  今天沒有時段時顯示 `時間表 今天沒有時段`。
- **點 peek 列** 或 **在「時間表」導航按鈕往上滑 28px** → 打開底部面板：今天所有時段（進行中的標 `現在`、已結束的淡化）＋ `開啟週時間表`。
- 關閉：點背景、拖曳面板往下 80px、Android 返回鍵（沿用 shim 的 Escape 機制）。
- 在「時間表」頁本身不顯示 peek（那頁已經是完整表格）。

## 主頁在沒有卡片時不會滾動

桌面版主頁用 `min-height: calc(100vh - 86px)`，但這個高度沒扣掉手機的底部導覽與頁面內距，所以在 Android 上
主頁**永遠比可視區高 18px**——即使一張卡都沒有，也能被往上拖一小段。改成在 Android 上填滿捲動區：

```css
html[data-platform="android"] .home { min-height: 100%; }
```

實測（393×873 / 360×800 / 412×915，有卡與無卡）：捲動溢出由 18px → **0px**；內容真的變長時（例如當天 8 筆行程）
主頁仍會正常長高並可捲動（實測溢出 256px）。E2E `ui/home-cards` 也加了一條斷言：
沒有行程時 `.main__scroll` 的 `scrollHeight - clientHeight` 必須 ≤ 1。

## 日期也改成自製日曆（不用原生 date picker）

`DateField`（`web/src/components/ui.tsx`）取代了新增行程與待辦的 `<input type="date">`：

| 項目 | 實作 |
| --- | --- |
| 觸發鈕 | 顯示「11 月 24 日 星期二」＋箭頭，展開後箭頭旋轉、邊框轉強調色 |
| 面板 | 月份標題＋上／下個月按鈕、星期列（跟隨設定的一週起始日）、6×7 日期格 |
| 狀態 | 今天用細框標示、選中日填強調色、非本月日期淡化 |
| 頁尾 | 「今天」「完成」；待辦的截止日多一個「清除」（可留空） |
| 版面 | 手機上日期列改為整寬（`field-row--date`），面板才有足夠寬度 |
| 風格 | 三種介面風格自動跟隨；瑞士工具改直角＋黑白反白 |

日期面板用 `lib/date.ts` 既有的 `monthGrid(month, weekStart)`，所以一週起始日與日曆頁一致。

**驗證**：E2E `ui/event-form` —— 表單內 `input[type=date]` 與 `select` 皆為 0、日曆面板可開、
切換月份有效、點選日期會更新欄位；瀏覽器 `web/scripts/verify-event-form.mjs` 另外驗證
「今天」「清除」與待辦截止日的空值狀態。

## 主頁（舊版）：沒有時段就不顯示、卡片可長按換位

**1. 沒有當天的時段時，那張卡不再出現**

原本會顯示「每週時段／今天沒有時段／在「時間表 → 週時間表」新增」的空狀態卡。現在只要今天
沒有進行中、接下來或已結束的時段，這張卡就完全不渲染，主頁只剩時鐘與「今天明細」卡，
明細卡自動變成全寬（`.home__panels--single`）。

**2. 長按卡片 360ms 可上下拖曳換位**

- 長按 360ms → 卡片浮起（放大陰影 + `navigator.vibrate(8)` 震動回饋），手指繼續拖曳即可移動。
- **即時讓位預覽**：拖過「另一張卡高度的一半」時，另一張卡會在拖曳過程中就滑進你要放的位子（不再等到放手才跳上去）。
- 拖曳中會封鎖頁面捲動（`touchmove` preventDefault），放手時若已超過門檻就提交順序。
- 拖曳結束後的那一下點擊會被吞掉，不會誤觸卡片裡的「新增行程」。
- 順序寫進 `localStorage["reciprocal.homeOrder"]`（例如 `["day","now"]`），下次開啟沿用。
- 換位對兩張卡都有效；只有一張卡時不啟用拖曳。

**驗證**：E2E `ui/home-cards` —— 無活動時卡片不存在且明細卡全寬、建立時段後卡片出現、
合成 pointer 事件長按 480ms 後卡片進入 `is-dragging`、拖曳後順序寫入且 DOM 順序改變、最後還原。
`web/scripts/verify-home-cards.mjs` 則在瀏覽器（393×873）做同樣的檢查並截圖。

## 表單不再顯示「例如：…」提示

新增行程／新增時段／新增待辦三個表單移除了範例 placeholder（欄位標籤本來就在上方，提示重複）。
任務清單的搜尋與快速新增輸入框仍保留提示（那些是功能性說明，不是範例）。

## 手機版排版（響應式）

所有規則都在 `web/src/styles/android.css` 內、以 `html[data-platform="android"]` 隔離，桌面版 CSS 未動。

**週時間表（時間表頁）**

| 問題 | 修法 |
| --- | --- |
| 橫向捲動時左側露出前一欄的殘影 | 移除 `.tt-scroll` 的負 margin + padding（6px 縫隙讓內容穿出時間軸），改為 `padding: 0`；`.tt-card` 加 `overflow: hidden` 裁切圓角 |
| 內容貼著狀態列 | `.main__scroll` 頂部留 12px，頁面自身不再加 padding |
| 卡片下方大片留白 | 週時間表頁改為 flex 撐滿可用高度（`page--schedule-week`），**只有格線內部捲動**，整頁不再滾動 |
| 手機上的左右卷軸很醜 | 隱藏 scrollbar（保留滑動與 snap） |
| 平板只看到半週 | ≥600dp 時改 `minmax(0,1fr)`，一屏顯示週一～週五 |

**介面風格的排版差異**

三種風格共用同一份資料與元件，但 CSS 各自有版面覆寫，其中「瑞士工具」的主頁是最後才套用桌面版
`300px + 1fr` 的雙欄格線（排在 `@media (max-width: 960px)` 之後，因此蓋掉了「窄螢幕疊成單欄」的規則）。
在手機上那 300px 欄會把「今天明細」卡壓成幾 px 寬、文字逐字換行。修法：

```css
html[data-platform="android"][data-ui-style="swiss"] .home__panels {
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
}
```

同時把瑞士風格的時鐘字級、底部導覽選中樣式（改用 `inset` 底線，避免溢出導覽列）一起在 Android 上收斂。
`scripts/shoot-android.mjs` 也補上 **主頁 × 三種風格 × 淺/深色** 的截圖矩陣，避免同類問題再次漏掉。

**尺寸斷點**

| 寬度 | 時間軸 | 日期欄寬 | 可見天數 |
| --- | --- | --- | --- |
| ≤360dp | 34dp | 84dp | 約 3 天（可橫滑） |
| 361–430dp | 34dp | 94dp | 約 3–3.5 天 |
| ≥431dp | 34dp | 104dp | 約 3.5 天 |
| ≥600dp（平板／折疊） | 46dp | `1fr` | 5 天全顯示 |

**量測驗證**（Chrome，Android UA，逐尺寸跑 `scripts/shoot-android.mjs` + 版面量測）

| 視窗 | 橫向溢出 | 整頁是否捲動 | 內容距頂 |
| --- | --- | --- | --- |
| 360×800 | 182px（時間表內部，預期） | 否 | 12px |
| 393×873 | 199px（同上） | 否 | 12px |
| 412×915 | 180px（同上） | 否 | 12px |
| 600×960 | 0（5 天全顯示） | 否 | 12px |
| 800×1000 | 0（5 天全顯示） | 否 | 12px |

## App 圖標

**沙漏（線稿・品牌綠）**—— 2026-11 依使用者提供的線稿沙漏重製，取代原本沿用桌面版的雙圈。
全部是向量 adaptive icon（沒有烘進底圖的 PNG，避免圓形遮罩露出白角）。

| 元素 | 值 |
| --- | --- |
| 底色 | `#F4F1E9`（紙色） |
| 線稿 | `#27614F`（品牌綠），線寬 **3.1dp**（畫布的 3.1%），圓端點／圓轉角 |
| 佔用範圍 | x 36–72、y 27–81 → 完全落在 66dp 安全圓內，任何遮罩都不切邊 |
| 造形 | 上下長橫桿（36–72）＋直肩（y 27–41）＋腰間斜線（交於 y 57，中央留 6.4dp 缺口） |

- `res/drawable/ic_launcher_foreground.xml`：108dp 畫布、4 段 stroke path（兩條橫桿＋左右各一）。
- `res/drawable/ic_launcher_monochrome.xml`：Android 13+ 主題圖標，同一個沙漏輪廓。
- `res/mipmap-anydpi-v26/ic_launcher.xml`、`ic_launcher_round.xml`：adaptive icon（minSdk 26，不需要舊版點陣圖）。
- 設計來源檔：`artifacts/icons/icon-M2.svg`（另有 M1、M3–M6 與 A–R 共 18 個方向，`artifacts/icons/preview*.png`）。

## 系統列與深色模式

`prefers-color-scheme` 在 Android WebView 中一律回報 **light**（Activity 用 Light 平台主題），所以：

- 系統列（狀態列／導覽列）用透明 + `enableEdgeToEdge()`，背景由 WebView 的紙色透出。
- 「自動」主題改由原生端提供真正的系統夜間狀態
  （`MainActivity.UiHost.isSystemDark()` → shim 的 `window.__reciprocalSystemDark()`），
  系統切換日夜時 `onConfigurationChanged` 會通知頁面重新解析。

## 兩個實作上的坑（供後續維護參考）

1. **WebView 不要放進 Compose `AndroidView`**：放在 Compose 裡時 Chromium 會得到 0 高度的 CSS
   視口——`100vh`、`100dvh`、甚至百分比高度全部解析成 `0px`（但 `window.innerHeight` 仍是 845，
   `position: fixed` 也正常），整個版面會塌掉。目前 `MainActivity` 用純 `FrameLayout` + 一般
   `WebView` 承載，並用 `ViewCompat.setOnApplyWindowInsetsListener` 處理狀態列／導覽列／鍵盤
   insets。E2E 的 `ui/viewport` 檢查就是防止這個問題回來。
2. **AGP 9 的 `optimization { packageScope = ... }` 會產出非法 dex**：scaffold 產生的
   `release { optimization { enable = true; packageScope = setOf("androidx.**", "kotlin.**", "kotlinx.**") } }`
   會讓 release 版一啟動就 `IllegalAccessError: Class kotlin.collections.e extended by class f1 is
   inaccessible`。移除 `packageScope`（保留 `enable = true`）後 R8 正常。

## 真機注意事項（MIUI／HyperOS）

實測 POCO F4（HyperOS）時遇到兩個 MIUI 限制，與程式無關：

- `adb shell pm grant` 被拒（`GRANT_RUNTIME_PERMISSIONS`），所以日曆權限只能由使用者在 App 內按「連結」授權，
  E2E 的 `calendar/sync` 在真機上無法自動化。
- `adb install` 全新安裝被拒（`INSTALL_FAILED_USER_RESTRICTED`）；從 Android Studio 按 Run（手機上按「安裝」）
  或在開發者選項開啟「USB 安裝／USB 偵錯（安全設定）」即可。
- 另外 `ANDROID_USER_HOME` 會改變 AGP 預設 debug keystore 的位置；`app/build.gradle.kts` 已把 debug 簽章固定到
  `~/.android/debug.keystore`，所以 CLI 與 Android Studio 產生的 APK 可以互相覆蓋安裝。

## Release 版

```bash
./scripts/build.sh :app:assembleRelease
# 產物：app/build/outputs/apk/release/app-release-unsigned.apk（未簽章）

# 本機測試可先用 debug keystore 簽章：
SDK=~/Library/Android/sdk
$SDK/build-tools/36.0.0/apksigner sign --ks ~/.android/debug.keystore \
  --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey \
  --out Reciprocal-release.apk app/build/outputs/apk/release/app-release-unsigned.apk
```

`artifacts/Reciprocal-0.1.7-android-debugkey.apk` 就是這樣簽出來的測試包（**debug key 簽章，不可上架**）。
正式發佈請用自己的 keystore 設定 `signingConfigs`。

## 與桌面版的差異

| 項目 | 桌面版（Tauri） | Android 版 |
| --- | --- | --- |
| 日曆整合 | EventKit（macOS 14+） | `CalendarContract`（系統日曆，權限 READ/WRITE_CALENDAR） |
| 檔案備份 | 原生檔案對話框（真實路徑） | Storage Access Framework（`content://` URI） |
| 視窗 | 側欄 236px + 內容區 | 底部四格導覽 + 全寬內容、modal 由下彈出 |
| 快捷鍵 | ⌘1…⌘3、⌘, | 無（觸控）；返回鍵＝回主頁／關閉 modal／離開 App |
| 標題列 | macOS overlay／Windows 系統列 | 系統狀態列（跟隨 App 主題） |
| 資料庫位置 | `~/Library/Application Support/com.lutszhong.reciprocal/reciprocal.db` | `/data/data/com.lutszhong.reciprocal/databases/reciprocal.db` |

## 已知限制

- 液態玻璃風格在低階 GPU 的 WebView 上可能較耗電（與桌面版相同的建議：切回紙本／瑞士）。
- 日曆同步的系統行程在 App 內是唯讀（與桌面版一致）；改動請回系統日曆。
- 週時間表只顯示週一至週五（沿用桌面版需求）。
- 尚未做系統通知／提醒（桌面版也沒有）。
- 未簽章的 debug APK 僅供測試；正式發佈需要簽章金鑰與 `assembleRelease`。

## 專案結構

```
├── app/src/main/java/com/lutszhong/reciprocal/
│   ├── MainActivity.kt          # Compose + WebView 宿主、SAF/權限、返回鍵
│   ├── AppContainer.kt          # 單例：DB / Store / 平台 / 日曆 / 指令路由
│   ├── bridge/                  # Bridge、CommandRouter、Responder、ActivityHost
│   ├── data/                    # Models、SQLite schema（db.rs 移植）、Store、StoreCommands
│   ├── platform/                # SAF 檔案、GitHub 更新檢查、plugin:* 指令
│   └── calendar/                # CalendarContract 讀寫、雙向同步、apple_* 指令
├── app/src/main/assets/web/     # 前端打包產物（由 scripts/build-web.sh 產生）
├── web/                         # 前端 fork（React + TS + CSS）
│   ├── public/tauri-shim.js     # Tauri IPC → Android bridge shim
│   └── src/styles/android.css   # 手機版排版
├── reference/upstream/          # 上游原始碼（Rust 規格書，僅供對照）
├── scripts/                     # build-web / build / install-apk / e2e-android
└── artifacts/                   # E2E 截圖與資料庫快照
```
