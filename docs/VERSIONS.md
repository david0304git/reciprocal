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

- **圖標**：兩平台都是線稿沙漏（紙色 `#F4F1E9`、品牌綠 `#27614F`）。桌面 mark 佔 tile **58%**；
  Android adaptive icon 幾何再乘 **0.78**（高度 ≈42dp，依使用者回饋縮小）。
  桌面點陣圖標由 `scripts/make-desktop-icons.mjs` 產生；Android 圖標是向量 drawable，直接改 XML。
- **共用前端**：桌面版改用與 Android 版相同的前端（`src/`），因此以下全部在桌面也生效：
  主頁行程清單（7／14／30 天、名稱＋倒數、自動縮小標題、兩行換行、長按拖曳排序並持久化）、
  「安排」→「時間表」、導航上方 peek 列＋上拉面板（只有主頁）、四頁左至右軌道＋鏡頭平移、
  自製月曆／時間選擇器、自訂行程分類、待辦用語。
- **液態玻璃**：只把**主頁時鐘**的玻璃框拿掉；側欄（菜單）維持原本的玻璃面板與圓角。
- **排版**：頁名距面板上緣 28px 且四頁對齊；行程列高度上限 108px，三張一屏不滾動、無色點。

## 平台差異

| 項目 | 🖥 桌面 | 📱 Android |
| --- | --- | --- |
| 導航 | 左側側欄（可拖曳視窗、⌘1–⌘3 快捷鍵） | 底部導航 4 項（主頁／日曆／時間表／設定） |
| 介面風格 | 三種（紙本手帳／液態玻璃／瑞士工具） | 相同三種 |
| 主頁／清單行為 | 相同前端 | 相同前端 |
| 固定時段面板 | 點擊或 pointer 拖曳上拉 | 觸控上拉（`touch-action: none`） |
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
| 0.1.8 | Android | 底部導航（主頁／日曆／時間表／設定） | 僅手機 |
| 0.1.8 | Android | 匯入 `styles/android.css`、`platform` 偵測含 `Android`、安全區 padding | 僅手機 |
| 0.1.8 | 桌面 | 側欄、`main__drag` 拖曳區、⌘1–⌘3 快捷鍵、視窗尺寸 | 僅桌面 |
| 0.1.8 | 桌面 | 液態玻璃：只有主頁時鐘無框（側欄保留玻璃面板） | 已同步（Android 無側欄） |
| 0.1.8 | 兩平台 | 目前兩份程式碼仍逐位元組相同（除建置設定） | 尚未出現實質分歧 |

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

1. 桌面版尚未實測的互動：主頁長按拖曳排序（滑鼠）、peek 上拉手感、⌘1–⌘3 在軌道模式下的回歸。
2. 把兩份前端合成單一來源（建置時共用），可省掉同步步驟。
3. 產生正式 Android release keystore，改由 CI 簽章。
4. 看板在手機改用 Pointer Events 拖放。
