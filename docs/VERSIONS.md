# 版本與平台差異（Desktop ／ Android）

> 一份文件管理兩件事：**每個版本出了什麼**、**桌面版與 Android 版哪裡不一樣**。
> 改動任一平台時，請在同一個 commit 更新這份表；發佈前依「發佈檢查表」走一遍。

平台代號：🖥 = macOS／Windows（Tauri），📱 = Android（Kotlin ＋ WebView）。

## 版本記錄

| 版本 | 平台 | 內容 |
| --- | --- | --- |
| 0.1.0 | 🖥 | 首個版本：主頁時鐘、日曆、習慣、待辦、Apple 日曆整合 |
| 0.1.1 | 🖥 | 修正與微調（見 release notes） |
| 0.1.2 | 🖥 | Windows 側欄快捷鍵提示改為 `Ctrl+…`（macOS 維持 `⌘`） |
| 0.1.3 | 🖥 | 主頁／日曆介面重整：移除「習慣」「統計」；「今日」→「主頁」、「事務」→「安排」 |
| 0.1.4 | 🖥 | 主頁兩張卡等高、底部對齊 |
| 0.1.5 | 🖥 | 日曆不再顯示「到期安排」 |
| 0.1.6 | 🖥 | Apple 事件重複匯入修正（複合鍵 `external_id`＋日期＋開始時間＋全天） |
| 0.1.7 | 🖥 | 介面風格（紙本手帳／液態玻璃／瑞士工具）、液態玻璃側欄交通燈、下拉選單 portal 定位 |
| **0.1.8** | 🖥 📱 | **線稿沙漏圖標＋Android 版首次發佈**；桌面版介面同步手機版（見下） |

### 0.1.8 詳細差異

**桌面版：只做三件事，介面維持 0.1.7**
1. **圖標**換成線稿沙漏（paper tile 58%）。Android 用同一母檔的向量版，縮到 ×0.78（安全區）。
2. **液態玻璃**：只有主頁大字時鐘移除玻璃框；側欄（菜單）維持原本的玻璃面板與圓角。
   App 內的品牌標記（側欄左上角與啟動畫面）也換成同一個沙漏（不再是雙圈）；Android 的啟動畫面同步更換。
3. **改名**：導航／頁面「安排」→「時間表」；每週時段「固定安排」→「時段」；待辦相關文案「安排」→「待辦」。
   連帶更新 Rust 端的使用者可見驗證訊息（「時段標題不能留空」等）。

除此之外桌面版與 0.1.7 相同（主頁兩張卡、瞬切頁面、原生 date/select、`src/` 僅 48 行增刪）。
`git diff v0.1.7 -- src/` 目前只有 11 個檔案、48 insertions／47 deletions，全部是改名與玻璃時鐘。

**Android 版：手機專屬的介面**（與桌面版刻意不同）
行程清單主頁（7／14／30 天、名稱＋倒數、長按拖曳排序）、導航上方 peek 列＋上拉面板、
四頁左至右軌道切換、自製月曆與時間選擇器、自訂行程分類、底部導航。

## 平台差異

| 項目 | 🖥 桌面 | 📱 Android |
| --- | --- | --- |
| 導航 | 左側側欄（可拖曳視窗、⌘1–⌘3 快捷鍵） | 底部導航 4 項（主頁／日曆／時間表／設定） |
| 介面風格 | 三種（紙本手帳／液態玻璃／瑞士工具） | 相同三種 |
| 頁面切換 | 瞬切 | 四頁左至右軌道、鏡頭平移 |
| 日期／時間輸入 | 原生 date／select | 自製月曆／時間選擇器 |
| 行程分類 | 固定分類 | 固定＋自訂分類 |
| 主頁 | 大字時鐘 ＋ 目前時段／今天明細兩張卡（0.1.7 版） | 行程清單（7／14／30 天、名稱＋倒數、長按排序） |
| 固定時段瀏覽 | 週時間表頁（無 peek 列） | 導航上方 peek 列＋上拉面板（只在主頁） |
| 前後端 | Rust（`src-tauri/`）＋ SQLite | Kotlin 橋接（`android/app/`）＋ SQLite，指令與 Rust 對等 |
| 系統日曆 | EventKit（macOS 14+，選用） | CalendarContract（雙向同步） |
| 待辦看板拖放 | 滑鼠可拖放改狀態 | ❌ HTML5 DnD 在觸控無效 → 點卡片改狀態 |
| 資料位置 | `~/Library/Application Support/com.lutszhong.reciprocal/`（macOS）<br>`%APPDATA%\com.lutszhong.reciprocal\`（Windows） | 應用程式私有目錄 `databases/reciprocal.db` |
| 更新機制 | GitHub `/releases/latest` 檢查 | 同左（`/releases/latest`） |
| 圖標比例 | 沙漏 58% tile | 沙漏 39%（×0.78，安全區留白） |
| 簽章 | macOS ad-hoc；Windows 未簽章 | Android debug keystore（`CN=Android Debug`） |
| 檔案格式／備份 | JSON（`tasks`／`events`／`timetable`／`habits`／`settings`） | 相同格式，可互換 |

## 兩份前端：設計各自獨立（允許分歧）

repo 內有兩份前端，**各自獨立演化、不需要相同**：

| 副本 | 平台 | 建置方式 | 產物 |
| --- | --- | --- | --- |
| `src/` | 桌面（Tauri） | `npm run build` → `dist/` | `tauri build` 打包 |
| `android/web/` | Android（WebView ＋ `WebViewAssetLoader`） | `android/scripts/build-web.sh` | `android/app/src/main/assets/web/` |

規則：

1. **只屬於單一平台的設計改動，就只改那一份**，不用同步到另一邊。
2. 每個分歧都要登記到下面的「差異清單」（改了什麼、哪個平台、為什麼、版本）。
3. 兩平台都要的功能，可以複製或各自實作；同一功能兩邊都改過時，在清單註明「已同步」。
4. 建置設定天生不同，不算分歧：`android/web/vite.config.ts` 有 `base: "./"`（WebView 資產要相對路徑）；
   `index.html` 兩邊相同，`tauri-shim.js` 在桌面端會自行停用（找不到 `window.ReciprocalNative`）。

### 差異清單

> 每次只改單一平台時，**新增一列**；同一列的「已同步」欄要更新。

| 版本 | 平台 | 差異 | 狀態 |
| --- | --- | --- | --- |
| 0.1.8 | 兩平台 | 圖標：桌面沙漏 58% tile／Android ×0.78（≈39%） | 刻意不同（Android 安全區＋回饋） |
| 0.1.8 | 桌面 | 主頁維持 0.1.7 兩張卡；頁面瞬切；原生 date/select；固定分類 | **未移植**手機版的新介面 |
| 0.1.8 | Android | 行程清單主頁、peek 列＋上拉面板、四頁軌道、自製選擇器、自訂分類、底部導航 | 僅手機 |
| 0.1.8 | 兩平台 | 改名（時間表／時段／待辦）與使用者可見驗證訊息 | 已同步 |
| 0.1.8 | 兩平台 | App 內品牌標記（側欄／啟動畫面）＝沙漏 | 已同步 |
| 0.1.8 | 兩平台 | 液態玻璃：只有主頁時鐘無框；桌面側欄保留玻璃面板 | 已同步（Android 無側欄） |
| 0.1.8 | Android | `styles/android.css`、`platform` 偵測含 `Android`、安全區 padding | 僅手機 |
| 0.1.8 | 桌面 | 側欄、`main__drag` 拖曳區、⌘1–⌘3 | 僅桌面 |

## 後端對等檢查

```bash
python3 android/scripts/verify-parity.py     # exit 0 = 一致
```

比對 Rust `db.rs` 的 schema SQL 與 Kotlin `ReciprocalDb.kt`、`models.rs` 與 `Models.kt` 的欄位、
以及前端呼叫的 28 個指令是否都有 Kotlin 實作。種子資料是**刻意分歧**（Android 不塞示範資料）。

## 版本號要同步的檔案

`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、
`android/app/build.gradle.kts`（`versionName` ＋ `versionCode`，目前 0.1.8／2）。

## 檔案整理原則（避免重複與殘留）

| 類別 | 處置 |
| --- | --- |
| `src-tauri/target/`（Rust 建置快取，1.2 GB） | 不進 git；`target/release/bundle/` 的 `.app`／`.dmg` 每次用完即刪，要檔案再 `npm run tauri build` |
| `android/app/build/`、`android/build/`、`android/web/dist/` | 建置產物，不進 git，可隨時刪 |
| `android/web/`（前端副本） | **保留**：Android 版的獨立前端來源（與 `src/` 同步，見上節） |
| `android/app/src/main/assets/web/` | **保留**：已建置的前端打包，讓 Android Studio／Gradle 不必先跑 Node |
| `src-tauri/icons/{android,ios}/` | **已刪除**：那是 Tauri mobile init 的殘留，Android 版用 `android/app/src/main/res` 的向量圖標 |
| icon 探索腳本（`make-icon-concepts*.mjs`） | **已刪除**：只保留產生正式圖標的 `make-desktop-icons.mjs` |
| 上游原始碼對照 `reference/upstream/` | **已刪除**：repo 本身就是上游；`verify-parity.py` 直接讀 `../src-tauri/src/` |

## 發佈檢查表

```bash
# 1) 建置
npm run build && npm run tauri build                       # macOS（產物在 src-tauri/target/release/bundle）
cd android && ./scripts/build.sh :app:assembleRelease && cd ..   # Android（另需 apksigner 簽章）

# 2) 打包（沿用現有命名）
ditto -c -k --sequesterRsrc --keepParent \
  src-tauri/target/release/bundle/macos/Reciprocal.app /tmp/Reciprocal-<ver>-macos-arm64.zip

# 3) Windows：push tag 觸發 .github/workflows/windows.yml，下載 artifact
git tag -f v<ver> && git push origin v<ver> --force
gh run watch <run-id> -R david0304git/reciprocal
gh run download <run-id> -R david0304git/reciprocal -D /tmp/win

# 4) 上傳＋校驗（同一版號覆蓋時：先刪舊資產、重算 SHA256SUMS.txt）
gh release upload v<ver> <macOS.zip> <win.exe> <android.apk> SHA256SUMS.txt -R david0304git/reciprocal
gh release download v<ver> -R david0304git/reciprocal -D /tmp/verify
(cd /tmp/verify && shasum -a 256 -c SHA256SUMS.txt)
```

- **不要標 Prerelease**：桌面版的更新檢查讀 `/releases/latest`，標成 prerelease 會讓更新提示消失
  （Android 版讀同一支 API）。
- APK 用 Android debug keystore 簽章；換金鑰需先解除安裝。

## 待辦／未完成

1. 桌面版若日後要移植手機版介面，需重新評估主頁清單、peek 面板、四頁軌道在滑鼠下的手感。
2. 把兩份前端合成單一來源（建置時共用），可省掉同步步驟。
3. 產生正式 Android release keystore，改由 CI 簽章。
4. 看板在手機改用 Pointer Events 拖放。
