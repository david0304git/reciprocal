# 桌面版 ↔ Android 版 同步現況

最後更新：2026-11-25（0.1.8 出貨後）

## 現在兩邊的關係

- **同一套 React 前端**，但 repo 內是**兩份副本**：`src/`（桌面）與 `android/web/`（Android）。
  目前 `src/` 與 `android/web/src/` 逐位元組相同（`diff -rq` 無輸出）。改 UI 要兩邊一起改，見 `AGENTS.md` 鐵律 1。
- 資料層共用：Android 的 Kotlin 指令與 Rust `src-tauri/src/{db,models,store,commands}.rs` 欄位/驗證對等
  （`android/scripts/verify-parity.py`）。

## 0.1.8 內容（手機版功能已回饋到桌面）

| 功能 | 桌面 | Android |
| --- | --- | --- |
| 主頁行程清單（7／14／30 天、名稱＋倒數、長按拖曳排序） | ✅ | ✅ |
| 「時間表」peek 列＋上拉面板（只有主頁） | ✅ | ✅ |
| 四頁左至右、鏡頭平移 | ✅ | ✅ |
| 自製月曆／時間選擇器、自訂行程分類 | ✅ | ✅ |
| 液態玻璃側欄／主頁時鐘無框 | ✅ | n/a（手機無側欄） |
| 系統日曆整合 | EventKit（macOS） | CalendarContract |
| 底部導航 | 側欄 | 底部導航 |

## 手機版 → 桌面版 變更對照（0.1.8 期間實際改過的項目）

| 主題 | 手機版做了什麼 | 桌面版 |
| --- | --- | --- |
| 命名 | 「安排」→「時間表」；固定時段＝時段；待辦用語統一 | ✅ 同一份前端，已同步 |
| 主頁 | 行程清單（7／14／30 天）、每列「名稱＋倒數」、標題自動縮小到半欄、太長換兩行、長按拖曳排序（即時讓位、存 localStorage） | ✅ 程式相同 |
| 固定時段 | 導航上方 peek 列（現在／下一段）＋上拉面板，**只有主頁顯示**、面板貼在導航列上方 | ✅ 程式相同（桌面上拉改為點擊 + pointer 拖曳） |
| 四頁 | 一條 400% 軌道、鏡頭平移、每頁各自保留捲動位置 | ✅ |
| 選單 | 無（手機是底部導航） | ✅ 液態玻璃側欄**無框** |
| 頂部留白 | 頁名距面板上緣 28px、四頁對齊 | ✅ |
| 行程列 | 列高上限 108px、三張一屏不滾動、無色點 | ✅ |
| 圖標 | 線稿沙漏；Android adaptive 幾何 ×0.78（高度 42dp） | ✅ 桌面 58% tile（刻意不同） |
| 液態玻璃 | 主頁時鐘無框 | ✅ 時鐘與側欄都無框 |

## 桌面版尚未實測的互動（下一步要驗）

1. **主頁長按拖曳排序**（桌面用滑鼠按住 360ms 再拖）：只驗證過手機觸控與瀏覽器，桌面 App 內未實測。
2. **時間表 peek 上拉**：桌面以點擊或 pointer 拖曳觸發，未在 App 內實測手感。
3. 側欄「時間表」按鈕上滑開啟面板的判斷（僅在 `view === "today"` 生效），桌面未測。
4. 列印／鍵盤快捷鍵（⌘1–⌘3）在四頁軌道模式下仍可用，但未回歸測過。

## 發佈檢查表（同一版本號覆蓋時也要做）

```bash
# 1) 版本號同步（見 AGENTS.md 鐵律 3），前端同步，建置
npm run build && npm run tauri build
cd android && ./scripts/build.sh :app:assembleRelease && cd ..
~/Library/Android/sdk/build-tools/36.0.0/apksigner sign --ks ~/.android/debug.keystore \
  --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey \
  --out /tmp/Reciprocal-<ver>-android.apk android/app/build/outputs/apk/release/app-release-unsigned.apk

# 2) macOS 打包（沿用 0.1.7 的命名）
ditto -c -k --sequesterRsrc --keepParent \
  src-tauri/target/release/bundle/macos/Reciprocal.app /tmp/Reciprocal-<ver>-macos-arm64.zip

# 3) Windows：push tag 觸發 .github/workflows/windows.yml，下載 artifact
git tag -f v<ver> && git push origin v<ver> --force
gh run watch <run-id> -R david0304git/reciprocal
gh run download <run-id> -R david0304git/reciprocal -D /tmp/win

# 4) 上傳 + 校驗（先刪舊資產再上傳，版本號不變時務必重算 SHA256SUMS.txt）
gh release upload v<ver> <三個檔> SHA256SUMS.txt -R david0304git/reciprocal
gh release download v<ver> -R david0304git/reciprocal -D /tmp/verify && (cd /tmp/verify && shasum -a 256 -c SHA256SUMS.txt)
```

- **不要設 Prerelease**：桌面 0.1.7+ 的更新檢查讀 `/releases/latest`，標成 prerelease 會讓更新提示消失。
- APK 以 Android **debug keystore** 簽章（`CN=Android Debug`）；換金鑰需先解除安裝。

## 待辦 / 可選

1. 兩份前端合成單一來源（`src/` 由 Android 建置時直接引用），可省掉同步步驟。
2. 產生正式 release keystore，改 CI 簽章 APK。
3. 看板在手機改用 Pointer Events 拖放（目前只能點卡片改狀態）。
4. 手機截圖／文件：`android/README-ANDROID.md` 已含完整驗證紀錄。
