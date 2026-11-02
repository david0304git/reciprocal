import React from "react";
import { CalendarDays, ListChecks, Settings as SettingsIcon, Sun } from "lucide-react";
import { useApp } from "../lib/store";
import type { ViewKey } from "../lib/types";

const NAV_ITEMS: Array<{
  key: ViewKey;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  shortcut: string;
}> = [
  { key: "today", label: "主頁", icon: Sun, shortcut: "1" },
  { key: "calendar", label: "日曆", icon: CalendarDays, shortcut: "2" },
  { key: "tasks", label: "安排", icon: ListChecks, shortcut: "3" },
];

const BrandMark: React.FC = () => (
  <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
    <circle cx="11.5" cy="15" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="18.5" cy="15" r="7.6" fill="currentColor" opacity="0.16" />
    <circle cx="18.5" cy="15" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const Sidebar: React.FC = () => {
  const { view, setView } = useApp();
  const isMac = document.documentElement.dataset.platform !== "windows";
  const shortcutPrefix = isMac ? "⌘" : "Ctrl+";

  return (
    <aside className="sidebar">
      <div className="sidebar__drag" data-tauri-drag-region />
      <div className="sidebar__brand" data-tauri-drag-region>
        <span className="brand-mark">
          <BrandMark />
        </span>
        <span className="brand-text">
          <span className="brand-name">Reciprocal</span>
          <span className="brand-sub">日常的往返</span>
        </span>
      </div>

      <nav className="nav" aria-label="主要導覽">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              className={`nav__item ${view === item.key ? "nav__item--active" : ""}`}
              onClick={() => setView(item.key)}
              aria-current={view === item.key ? "page" : undefined}
            >
              <Icon size={16} strokeWidth={1.9} />
              <span className="nav__label">{item.label}</span>
              <span className="nav__kbd">
                {shortcutPrefix}
                {item.shortcut}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar__spacer" />

      <button
        type="button"
        className={`nav__item nav__item--ghost ${view === "settings" ? "nav__item--active" : ""}`}
        onClick={() => setView("settings")}
      >
        <SettingsIcon size={16} strokeWidth={1.9} />
        <span className="nav__label">設定</span>
        <span className="nav__kbd">{isMac ? "⌘," : "Ctrl+,"}</span>
      </button>

      <p className="sidebar__foot">本機資料 · v{__APP_VERSION__}</p>
    </aside>
  );
};
