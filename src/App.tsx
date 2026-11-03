import React, { useEffect } from "react";
import { X } from "lucide-react";
import { AppProvider, useApp } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { ToastStack } from "./components/ui";
import { TodayView } from "./views/Today";
import { CalendarView } from "./views/Calendar";
import { ScheduleView } from "./views/Schedule";
import { SettingsView } from "./views/Settings";
import type { ViewKey } from "./lib/types";
import { api } from "./lib/api";

const VIEWS: Record<ViewKey, React.ComponentType> = {
  today: TodayView,
  calendar: CalendarView,
  tasks: ScheduleView,
  settings: SettingsView,
};

const BrandGlyph: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
    <circle cx="11.5" cy="15" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="18.5" cy="15" r="7.6" fill="currentColor" opacity="0.16" />
    <circle cx="18.5" cy="15" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const Splash: React.FC = () => (
  <div className="splash">
    <div className="splash__mark">
      <BrandGlyph size={46} />
    </div>
    <p className="splash__text">正在整理你的日常…</p>
  </div>
);

const UpdateBanner: React.FC = () => {
  const { updateInfo, updateDismissed, dismissUpdate } = useApp();
  if (!updateInfo?.updateAvailable || !updateInfo.releaseUrl || updateDismissed) {
    return null;
  }
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__dot" />
      <span>
        有新版本 <strong>v{updateInfo.latestVersion}</strong> 可用
      </span>
      <span className="update-banner__spacer" />
      <button
        type="button"
        className="btn btn--soft btn--sm"
        onClick={() => void api.openExternal(updateInfo.releaseUrl as string)}
      >
        查看更新
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={dismissUpdate}
        aria-label="關閉更新提示"
      >
        <X size={14} />
      </button>
    </div>
  );
};

const Shell: React.FC = () => {
  const { loading, error, data, reload, view, setView, settings } = useApp();
  const View = VIEWS[view];

  useEffect(() => {
    document.documentElement.dataset.uiStyle = settings.uiStyle;
    try {
      localStorage.setItem("reciprocal.uiStyle", settings.uiStyle);
    } catch {
      /* storage may be unavailable */
    }
  }, [settings.uiStyle]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        settings.theme === "auto" ? (media.matches ? "dark" : "light") : settings.theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const shortcuts: Record<string, ViewKey> = {
        "1": "today",
        "2": "calendar",
        "3": "tasks",
        ",": "settings",
      };
      const target = shortcuts[event.key];
      if (target) {
        event.preventDefault();
        setView(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView]);

  if (loading) return <Splash />;

  if (error || !data) {
    return (
      <div className="splash">
        <div className="splash__mark splash__mark--error">!</div>
        <p className="splash__text">{error ?? "無法讀取資料。"}</p>
        <button type="button" className="btn btn--soft" onClick={() => void reload()}>
          重新載入
        </button>
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <div className="main__drag" data-tauri-drag-region />
        <UpdateBanner />
        <div className="main__scroll">
          <View key={view} />
        </div>
      </main>
      <ToastStack />
    </div>
  );
};

const App: React.FC = () => (
  <AppProvider>
    <Shell />
  </AppProvider>
);

export default App;
