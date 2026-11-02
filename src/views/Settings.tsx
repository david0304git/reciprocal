import React, { useCallback, useEffect, useState } from "react";
import {
  Database,
  Download,
  HardDrive,
  Info,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  Trash,
  Upload,
} from "lucide-react";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { isTauri } from "../lib/api";
import { defaultBackupName, exportInBrowser, pickExportPath, pickImportPath } from "../lib/files";
import type { AppleCalendarInfo, AppleStatus, StorageInfo } from "../lib/types";
import { ConfirmDialog, Segmented } from "../components/ui";
import { CalendarMultiSelect } from "../components/CalendarMultiSelect";

const calendarKindLabel = (calendar: {
  kind: string;
  subscribed: boolean;
  source: string;
}): string => {
  if (calendar.kind === "subscription" || calendar.subscribed) return "訂閱";
  if (calendar.kind === "birthday") return "生日";
  if (calendar.kind === "local") return "本機";
  return calendar.source || "日曆";
};

const PAST_RANGE_OPTIONS = [
  { value: "30", label: "1 個月" },
  { value: "90", label: "3 個月" },
  { value: "180", label: "6 個月" },
  { value: "365", label: "1 年" },
  { value: "1095", label: "3 年" },
  { value: "3650", label: "10 年" },
];

const FUTURE_RANGE_OPTIONS = [
  { value: "30", label: "1 個月" },
  { value: "90", label: "3 個月" },
  { value: "180", label: "6 個月" },
  { value: "365", label: "1 年" },
  { value: "1095", label: "3 年" },
];

const formatSyncTime = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-Hant", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const GITHUB_REPO_URL = "https://github.com/david0304git/reciprocal";

const formatPublished = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-Hant", { year: "numeric", month: "long", day: "numeric" });
};

export const SettingsView: React.FC = () => {
  const {
    settings,
    actions,
    notify,
    data,
    reload,
    updateInfo,
    updateError,
    checkingUpdates,
    checkForUpdates,
  } = useApp();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(__APP_VERSION__);
  const [apple, setApple] = useState<AppleStatus | null>(null);
  const [appleBusy, setAppleBusy] = useState(false);
  const [calendars, setCalendars] = useState<AppleCalendarInfo[]>([]);
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>([]);
  const [cardSelectedCalendars, setCardSelectedCalendars] = useState<string[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);

  const loadCalendars = useCallback(async () => {
    setCalendarsLoading(true);
    try {
      const response = await api.appleCalendars();
      setCalendars(response.calendars);
      setSelectedCalendars(response.selected);
      setCardSelectedCalendars(response.cardSelected);
    } catch {
      setCalendars([]);
      setSelectedCalendars([]);
      setCardSelectedCalendars([]);
    } finally {
      setCalendarsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (apple?.enabled) {
      void loadCalendars();
    } else {
      setCalendars([]);
      setSelectedCalendars([]);
      setCardSelectedCalendars([]);
    }
  }, [apple?.enabled, apple?.lastSync, loadCalendars]);

  const refreshApple = useCallback(async () => {
    try {
      setApple(await api.appleStatus());
    } catch {
      setApple(null);
    }
  }, []);

  useEffect(() => {
    void refreshApple();
  }, [refreshApple, data]);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((version) => {
        if (!cancelled) setCurrentVersion(version);
      })
      .catch(() => {
        /* keep the fallback version */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openLink = (url: string) => {
    if (isTauri) {
      void api.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  const handleAppleToggle = async () => {
    if (!apple || appleBusy) return;
    setAppleBusy(true);
    if (apple.enabled) {
      await actions.appleDisconnect();
    } else {
      await actions.appleConnect();
    }
    setAppleBusy(false);
    await refreshApple();
  };

  const handleAppleReconnect = async () => {
    if (appleBusy) return;
    setAppleBusy(true);
    await actions.appleConnect();
    setAppleBusy(false);
    await refreshApple();
  };

  const applyCalendars = async (next: string[]) => {
    setSelectedCalendars(next);
    setCalendarBusy(true);
    await actions.appleSetCalendars(next);
    await reload();
    setCalendarBusy(false);
    await Promise.all([refreshApple(), loadCalendars()]);
  };

  const handleCalendarToggle = (id: string) => {
    if (calendarBusy) return;
    const next = selectedCalendars.includes(id)
      ? selectedCalendars.filter((value) => value !== id)
      : [...selectedCalendars, id];
    void applyCalendars(next);
  };

  const handleCalendarAll = (selectAll: boolean) => {
    if (calendarBusy) return;
    void applyCalendars(selectAll ? calendars.map((calendar) => calendar.id) : []);
  };

  const handleCardToggle = (id: string) => {
    const next = cardSelectedCalendars.includes(id)
      ? cardSelectedCalendars.filter((value) => value !== id)
      : [...cardSelectedCalendars, id];
    setCardSelectedCalendars(next);
    void actions.setSetting("appleCardCalendarIds", JSON.stringify(next));
  };

  const handleCardAll = (selectAll: boolean) => {
    const next = selectAll ? calendars.map((calendar) => calendar.id) : [];
    setCardSelectedCalendars(next);
    void actions.setSetting("appleCardCalendarIds", JSON.stringify(next));
  };

  const handleRangeChange = async (key: string, value: string) => {
    if (appleBusy) return;
    setAppleBusy(true);
    await actions.setSetting(key, value);
    await actions.appleSync();
    setAppleBusy(false);
    await refreshApple();
  };

  const handleAppleSync = async () => {
    if (appleBusy) return;
    setAppleBusy(true);
    await actions.appleSync();
    setAppleBusy(false);
    await Promise.all([refreshApple(), loadCalendars()]);
  };

  const refreshInfo = useCallback(async () => {
    try {
      setInfo(await api.storageInfo());
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    void refreshInfo();
  }, [refreshInfo, data]);

  const handleExport = async () => {
    setExporting(true);
    try {
      if (!isTauri) {
        await exportInBrowser();
        notify("已下載 JSON 備份", "ok");
        return;
      }
      const picked = await pickExportPath(defaultBackupName());
      if (!picked) return;
      const path = picked.toLowerCase().endsWith(".json") ? picked : `${picked}.json`;
      const written = await api.exportBackup(path);
      notify(`已匯出備份：${written.split("/").pop() ?? written}`, "ok");
      void refreshInfo();
    } catch (cause) {
      notify(typeof cause === "string" ? cause : "匯出失敗，請再試一次。", "error");
    } finally {
      setExporting(false);
    }
  };

  const handlePickImport = async () => {
    if (!isTauri) {
      notify("瀏覽器預覽模式不支援匯入備份。", "error");
      return;
    }
    const picked = await pickImportPath();
    if (picked) setPendingImport(picked);
  };

  const handleImport = async () => {
    if (!pendingImport) return;
    setImporting(true);
    const ok = await actions.importBackup(pendingImport);
    setImporting(false);
    setPendingImport(null);
    if (ok) void refreshInfo();
  };

  const pastDays = String(data?.settings.appleImportPastDays ?? "365");
  const futureDays = String(data?.settings.appleImportFutureDays ?? "365");

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">設定</p>
          <h1 className="page__title">讓它更適合你</h1>
          <p className="page__subtitle">所有資料都留在這台電腦上，不會上傳到任何地方。</p>
        </div>
      </header>

      {!isTauri ? (
        <div className="notice">
          <Info size={15} />
          <span>
            目前在瀏覽器預覽模式：資料存在瀏覽器 localStorage，與 App 內的 SQLite 資料庫是分開的。
          </span>
        </div>
      ) : null}

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">外觀</h2>
            <p className="card__subtitle">選擇你喜歡的顯示模式</p>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row__text">
            <p className="setting-row__title">主題</p>
            <p className="setting-row__desc">「自動」會跟隨系統的外觀設定。</p>
          </div>
          <Segmented
            value={settings.theme}
            onChange={(value) => void actions.setSetting("theme", value)}
            options={[
              { value: "auto", label: "自動", icon: <Monitor size={13} /> },
              { value: "light", label: "淺色", icon: <Sun size={13} /> },
              { value: "dark", label: "深色", icon: <Moon size={13} /> },
            ]}
          />
        </div>
        <div className="setting-row">
          <div className="setting-row__text">
            <p className="setting-row__title">一週的起始日</p>
            <p className="setting-row__desc">影響日曆與每週統計的計算方式。</p>
          </div>
          <Segmented
            value={String(settings.weekStart)}
            onChange={(value) => void actions.setSetting("weekStart", value)}
            options={[
              { value: "1", label: "週一" },
              { value: "0", label: "週日" },
            ]}
          />
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">資料</h2>
            <p className="card__subtitle">本機 SQLite 資料庫，可隨時匯出成 JSON 備份</p>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <p className="setting-row__title">
              <Database size={14} /> 資料庫位置
            </p>
            <p className="setting-row__desc setting-row__desc--mono">
              {info?.dbPath ?? "讀取中…"}
            </p>
          </div>
          <div className="setting-row__value">
            <HardDrive size={13} /> {info ? formatBytes(info.sizeBytes) : "—"}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <p className="setting-row__title">匯出備份</p>
            <p className="setting-row__desc">習慣、打卡、行程與安排會一起匯出成一份 JSON 檔。</p>
          </div>
          <button type="button" className="btn btn--soft" onClick={handleExport} disabled={exporting}>
            <Download size={14} /> {exporting ? "匯出中…" : "匯出"}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <p className="setting-row__title">從備份還原</p>
            <p className="setting-row__desc">會以備份內容取代目前所有資料，請先確認要保留哪一份。</p>
          </div>
          <button type="button" className="btn btn--soft" onClick={handlePickImport} disabled={importing}>
            <Upload size={14} /> {importing ? "還原中…" : "選擇備份"}
          </button>
        </div>

        <div className="setting-row setting-row--danger">
          <div className="setting-row__text">
            <p className="setting-row__title">清除所有資料</p>
            <p className="setting-row__desc">刪除全部習慣、打卡、行程與安排，這個動作無法復原。</p>
          </div>
          <button type="button" className="btn btn--danger" onClick={() => setConfirmClear(true)}>
            <Trash size={14} /> 清除
          </button>
        </div>
      </section>

      {apple?.supported ? (
        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Apple 日曆</h2>
              <p className="card__subtitle">
                雙向同步：App 行程寫入「Reciprocal」日曆；其他 Apple 日曆匯入為唯讀。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={apple.enabled}
              aria-label="連結 Apple 日曆"
              className={`switch ${apple.enabled ? "is-on" : ""}`}
              onClick={handleAppleToggle}
              disabled={appleBusy}
            >
              <span className="switch__knob" />
            </button>
          </div>

          <div className="setting-row">
            <div className="setting-row__text">
              <p className="setting-row__title">
                <span className={`status-dot ${apple.enabled ? "is-on" : ""}`} />
                {apple.enabled
                  ? apple.authorization === "fullAccess"
                    ? "已連結 Apple 日曆"
                    : "已連結，但需要重新授權"
                  : "未連結 Apple 日曆"}
              </p>
              <p className="setting-row__desc">
                {appleBusy
                  ? "等待 macOS 授權或同步中…"
                  : apple.enabled
                    ? `已匯入 ${apple.importedCount} 個 Apple 行程${
                        apple.lastSync ? ` · 上次同步 ${formatSyncTime(apple.lastSync)}` : ""
                      }`
                    : apple.authorization === "denied" || apple.authorization === "restricted"
                      ? "權限被拒絕，請到「系統設定 → 隱私權與安全性 → 日曆」開啟 Reciprocal。"
                      : "連結後會建立一個「Reciprocal」日曆，並匯入你其他日曆的行程。"}
              </p>
            </div>
            {apple.enabled ? (
              <button
                type="button"
                className="btn btn--soft"
                onClick={handleAppleSync}
                disabled={appleBusy}
              >
                <RefreshCw size={14} /> {appleBusy ? "同步中…" : "立即同步"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--soft"
                onClick={handleAppleToggle}
                disabled={appleBusy}
              >
                {appleBusy ? "等待授權…" : "連結 Apple 日曆"}
              </button>
            )}
          </div>

          {apple.enabled && apple.authorization !== "fullAccess" ? (
            <div className="notice">
              <Info size={15} />
              <span>
                日曆權限尚未開啟（可能是重新編譯後 macOS 重置了權限）。
              </span>
              <button
                type="button"
                className="mini-btn"
                onClick={handleAppleReconnect}
                disabled={appleBusy}
              >
                重新授權
              </button>
            </div>
          ) : null}

          {apple.enabled ? (
            <>
            <div className="setting-row setting-row--calendar">
              <div className="setting-row__text">
                <p className="setting-row__title">要匯入的日曆</p>
                <p className="setting-row__desc">
                  取消勾選「24 節氣」「公眾假期」等日曆，就不會再匯入，也不會出現在月曆與資料中。
                  只想讓它們不出現在倒數卡片，請用下方的「倒數卡片顯示的日曆」。
                </p>
                {calendarBusy ? <p className="form-hint">同步中…</p> : null}
              </div>
              <CalendarMultiSelect
                ariaLabel="要匯入的日曆"
                calendars={calendars}
                selected={selectedCalendars}
                onToggle={handleCalendarToggle}
                onAll={handleCalendarAll}
                disabled={calendarBusy}
                loading={calendarsLoading}
                emptyText="沒有可匯入的日曆"
                metaFor={calendarKindLabel}
              />
            </div>

            {selectedCalendars.length === 0 ? (
              <p className="form-hint">
                目前沒有匯入任何 Apple 日曆；App 的行程仍會寫入「Reciprocal」日曆。
              </p>
            ) : null}

            <div className="setting-row setting-row--calendar">
              <div className="setting-row__text">
                <p className="setting-row__title">倒數卡片顯示的日曆</p>
                <p className="setting-row__desc">
                  只影響日曆頁左側的倒數卡片；取消的行程仍會出現在月曆與主頁明細。App 內建立的行程一律顯示。
                </p>
              </div>
              <CalendarMultiSelect
                ariaLabel="倒數卡片顯示的日曆"
                calendars={calendars}
                selected={cardSelectedCalendars}
                onToggle={handleCardToggle}
                onAll={handleCardAll}
                loading={calendarsLoading}
                emptyText="沒有可選擇的日曆"
                metaFor={(calendar) =>
                  selectedCalendars.includes(calendar.id)
                    ? calendarKindLabel(calendar)
                    : "未匯入"
                }
              />
            </div>

            </>
          ) : null}

          <div className="setting-row">
            <div className="setting-row__text">
              <p className="setting-row__title">自動同步</p>
              <p className="setting-row__desc">
                關閉後只在按「立即同步」或修改日曆篩選時同步；啟動、儲存行程、每 5 分鐘都不會自動同步。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={data?.settings.appleAutoSync !== "0"}
              aria-label="自動同步"
              className={`switch ${data?.settings.appleAutoSync !== "0" ? "is-on" : ""}`}
              onClick={() =>
                void actions.setSetting(
                  "appleAutoSync",
                  data?.settings.appleAutoSync === "0" ? "1" : "0",
                )
              }
            >
              <span className="switch__knob" />
            </button>
          </div>

          <div className="setting-row">
            <div className="setting-row__text">
              <p className="setting-row__title">匯入時間範圍</p>
              <p className="setting-row__desc">
                越長代表同步越久；寫出不受此限制（App 內行程全部同步到「Reciprocal」日曆）。
                停用後已匯入的行程會保留，但不再更新。
              </p>
            </div>
            <div className="range-controls">
              <label className="range-control">
                <span>過去</span>
                <select
                  className="select select--sm"
                  value={pastDays}
                  disabled={appleBusy}
                  onChange={(event) =>
                    void handleRangeChange("appleImportPastDays", event.target.value)
                  }
                  aria-label="匯入過去的時間範圍"
                >
                  {PAST_RANGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="range-control">
                <span>未來</span>
                <select
                  className="select select--sm"
                  value={futureDays}
                  disabled={appleBusy}
                  onChange={(event) =>
                    void handleRangeChange("appleImportFutureDays", event.target.value)
                  }
                  aria-label="匯入未來的時間範圍"
                >
                  {FUTURE_RANGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">更新</h2>
            <p className="card__subtitle">從 GitHub Releases 檢查是否有新版本</p>
          </div>
          <button
            type="button"
            className="btn btn--soft"
            onClick={() => void checkForUpdates(false)}
            disabled={checkingUpdates}
          >
            <RefreshCw size={14} /> {checkingUpdates ? "檢查中…" : "立即檢查"}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <p className="setting-row__title">目前版本 v{currentVersion}</p>
            <p className="setting-row__desc">
              {updateError
                ? updateError
                : updateInfo
                  ? updateInfo.updateAvailable
                    ? `GitHub 最新版本 v${updateInfo.latestVersion ?? ""}`
                    : `已是最新版本${updateInfo.latestVersion ? `（v${updateInfo.latestVersion}）` : ""}`
                  : "按「立即檢查」查詢 GitHub 上的最新版本"}
            </p>
          </div>
          <button type="button" className="mini-btn" onClick={() => openLink(GITHUB_REPO_URL)}>
            GitHub 專案
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <p className="setting-row__title">啟動時檢查更新</p>
            <p className="setting-row__desc">
              每次啟動 Reciprocal 時向 GitHub 查詢最新版本；有新版本會在頂部顯示提示。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={data?.settings.checkUpdatesOnLaunch === "1"}
            aria-label="啟動時檢查更新"
            className={`switch ${data?.settings.checkUpdatesOnLaunch === "1" ? "is-on" : ""}`}
            onClick={() =>
              void actions.setSetting(
                "checkUpdatesOnLaunch",
                data?.settings.checkUpdatesOnLaunch === "1" ? "0" : "1",
              )
            }
          >
            <span className="switch__knob" />
          </button>
        </div>

        {updateInfo?.updateAvailable && updateInfo.releaseUrl ? (
          <div className="setting-row">
            <div className="setting-row__text">
              <p className="setting-row__title">有新版本可用</p>
              <p className="setting-row__desc">
                v{updateInfo.latestVersion}
                {updateInfo.releaseName && updateInfo.releaseName !== `v${updateInfo.latestVersion}`
                  ? ` · ${updateInfo.releaseName}`
                  : ""}
                {updateInfo.publishedAt ? ` · ${formatPublished(updateInfo.publishedAt)}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => openLink(updateInfo.releaseUrl as string)}
            >
              下載
            </button>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">關於</h2>
            <p className="card__subtitle">Reciprocal {__APP_VERSION__}</p>
          </div>
        </div>
        <div className="about">
          <p>
            Reciprocal 是一個專注在「日常往返」的個人工具：安排行程、追蹤待辦，把每天過得清楚一點。
            名字來自一種相信——你對生活付出的，生活會用另一種方式回到你身上。
          </p>
          <p className="about__meta">Tauri 2 · React · Rust · SQLite · 完全離線</p>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="還原這份備份？"
        message="目前資料庫中的所有內容都會被備份檔取代。建議先匯出一份目前的備份。"
        confirmLabel="還原"
        onClose={() => setPendingImport(null)}
        onConfirm={() => void handleImport()}
      />

      <ConfirmDialog
        open={confirmClear}
        title="清除所有資料？"
        message="所有習慣、打卡紀錄、行程與安排都會被刪除，且無法復原。"
        confirmLabel="確定清除"
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          void actions.clearAll();
        }}
      />
    </div>
  );
};
