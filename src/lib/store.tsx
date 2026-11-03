import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, isTauri } from "./api";
import type {
  AppData,
  EventInput,
  EventItem,
  Habit,
  HabitInput,
  Task,
  TaskInput,
  ThemeMode,
  UpdateInfo,
  TimetableBlock,
  TimetableInput,
  ViewKey,
} from "./types";

export interface Toast {
  id: number;
  message: string;
  tone: "ok" | "error" | "info";
}

export type UiStyle = "paper" | "glass" | "swiss";

export interface Settings {
  theme: ThemeMode;
  weekStart: 0 | 1;
  uiStyle: UiStyle;
}

interface Actions {
  toggleHabitLog: (habitId: number, date: string, present: boolean) => Promise<void>;
  saveHabit: (input: HabitInput) => Promise<Habit | null>;
  deleteHabit: (id: number) => Promise<void>;
  archiveHabit: (id: number, archived: boolean) => Promise<void>;
  saveEvent: (input: EventInput) => Promise<EventItem | null>;
  deleteEvent: (id: number) => Promise<void>;
  saveTask: (input: TaskInput) => Promise<Task | null>;
  setTaskStatus: (id: number, status: Task["status"]) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  saveTimetable: (input: TimetableInput) => Promise<TimetableBlock | null>;
  deleteTimetable: (id: number) => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
  importBackup: (path: string) => Promise<boolean>;
  clearAll: () => Promise<void>;
  appleConnect: () => Promise<boolean>;
  appleDisconnect: () => Promise<boolean>;
  appleSync: (silent?: boolean) => Promise<boolean>;
  appleSetCalendars: (ids: string[]) => Promise<boolean>;
}

interface AppContextValue {
  data: AppData | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  view: ViewKey;
  setView: (view: ViewKey) => void;
  settings: Settings;
  toasts: Toast[];
  notify: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  actions: Actions;
  isBrowserPreview: boolean;
  updateInfo: UpdateInfo | null;
  updateError: string | null;
  checkingUpdates: boolean;
  checkForUpdates: (silent?: boolean) => Promise<UpdateInfo | null>;
  updateDismissed: boolean;
  dismissUpdate: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const storageGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const storageSet = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable (private mode / sandboxed webview) */
  }
};

const readStoredTheme = (): ThemeMode => {
  const stored = storageGet("reciprocal.theme");
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
};

const readStoredView = (): ViewKey => {
  const stored = storageGet("reciprocal.view");
  const allowed: ViewKey[] = ["today", "calendar", "tasks", "settings"];
  return allowed.includes(stored as ViewKey) ? (stored as ViewKey) : "today";
};

const upsert = <T extends { id: number }>(list: T[], item: T): T[] =>
  list.some((entry) => entry.id === item.id)
    ? list.map((entry) => (entry.id === item.id ? item : entry))
    : [...list, item];

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>(readStoredView);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const appleEnabledRef = useRef(false);
  const appleAutoSyncRef = useRef(true);
  const syncInFlight = useRef(false);
  const syncQueued = useRef(false);
  const syncTimer = useRef<number | null>(null);
  const syncErrorNotified = useRef(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const checkingUpdatesRef = useRef(false);

  const notify = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = (toastSeq.current += 1);
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3400);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const fail = useCallback(
    (cause: unknown) => {
      const message =
        typeof cause === "string"
          ? cause
          : cause instanceof Error
            ? cause.message
            : "發生未知錯誤，請再試一次。";
      notify(message, "error");
    },
    [notify],
  );

  const performAppleSync = useCallback(
    async (silent = true): Promise<boolean> => {
      if (syncInFlight.current) {
        syncQueued.current = true;
        return false;
      }
      let succeeded = true;
      const run = async (quiet: boolean): Promise<void> => {
        syncInFlight.current = true;
        try {
          const next = await api.appleSync();
          setData(next);
          syncErrorNotified.current = false;
          if (!quiet) notify("已同步 Apple 日曆", "ok");
        } catch (cause) {
          succeeded = false;
          const message =
            typeof cause === "string" ? cause : "Apple 日曆同步失敗，請再試一次。";
          if (!quiet || !syncErrorNotified.current) {
            syncErrorNotified.current = true;
            notify(message, "error");
          }
        } finally {
          syncInFlight.current = false;
          if (syncQueued.current) {
            syncQueued.current = false;
            await run(quiet);
          }
        }
      };
      await run(silent);
      return succeeded;
    },
    [notify],
  );

  const checkForUpdates = useCallback(
    async (silent = false): Promise<UpdateInfo | null> => {
      if (checkingUpdatesRef.current) return null;
      checkingUpdatesRef.current = true;
      setCheckingUpdates(true);
      try {
        const info = await api.checkForUpdates();
        setUpdateInfo(info);
        setUpdateError(null);
        if (info.updateAvailable) setUpdateDismissed(false);
        if (!silent) {
          notify(
            info.updateAvailable
              ? `有新版本 v${info.latestVersion ?? ""} 可用`
              : "目前已是最新版本",
            info.updateAvailable ? "info" : "ok",
          );
        }
        return info;
      } catch (cause) {
        const message =
          typeof cause === "string" ? cause : "檢查更新失敗，請確認網路連線。";
        setUpdateError(message);
        if (!silent) notify(message, "error");
        return null;
      } finally {
        checkingUpdatesRef.current = false;
        setCheckingUpdates(false);
      }
    },
    [notify],
  );

  const dismissUpdate = useCallback(() => setUpdateDismissed(true), []);

  const requestAppleSync = useCallback(
    (delay = 600) => {
      if (!appleEnabledRef.current || !appleAutoSyncRef.current) return;
      if (syncTimer.current !== null) {
        window.clearTimeout(syncTimer.current);
      }
      syncTimer.current = window.setTimeout(() => {
        syncTimer.current = null;
        if (appleEnabledRef.current && appleAutoSyncRef.current) {
          void performAppleSync(true);
        }
      }, delay);
    },
    [performAppleSync],
  );

  const reload = useCallback(async () => {
    try {
      const next = await api.loadApp();
      setData(next);
      setError(null);
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "無法讀取資料庫，請重新啟動 Reciprocal。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const initialAppleSync = useRef(false);
  useEffect(() => {
    if (!data) return;
    appleEnabledRef.current = data.settings.appleSyncEnabled === "1";
    appleAutoSyncRef.current = data.settings.appleAutoSync !== "0";
    if (initialAppleSync.current) return;
    initialAppleSync.current = true;
    if (appleEnabledRef.current && appleAutoSyncRef.current) {
      requestAppleSync(900);
    }
  }, [data, requestAppleSync]);

  const initialUpdateCheck = useRef(false);
  useEffect(() => {
    if (!data || initialUpdateCheck.current) return;
    initialUpdateCheck.current = true;
    if (data.settings.checkUpdatesOnLaunch === "1") {
      void checkForUpdates(true);
    }
  }, [data, checkForUpdates]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (appleEnabledRef.current && appleAutoSyncRef.current && document.visibilityState === "visible") {
        void performAppleSync(true);
      }
    }, 5 * 60 * 1000);
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        appleEnabledRef.current &&
        appleAutoSyncRef.current
      ) {
        void performAppleSync(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [performAppleSync]);


  useEffect(() => {
    storageSet("reciprocal.view", view);
  }, [view]);

  const settings = useMemo<Settings>(() => {
    const theme = (data?.settings.theme as ThemeMode | undefined) ?? readStoredTheme();
    const storedUi = data?.settings.uiStyle;
    const uiStyle: UiStyle =
      storedUi === "glass" || storedUi === "swiss" ? storedUi : "paper";
    return {
      theme: theme === "light" || theme === "dark" ? theme : "auto",
      weekStart: Number(data?.settings.weekStart ?? 1) === 0 ? 0 : 1,
      uiStyle,
    };
  }, [data?.settings.theme, data?.settings.weekStart, data?.settings.uiStyle]);

  useEffect(() => {
    storageSet("reciprocal.theme", settings.theme);
  }, [settings.theme]);

  const saveTimetable = useCallback(
    async (input: TimetableInput) => {
      try {
        const block = await api.saveTimetable(input);
        setData((current) =>
          current ? { ...current, timetable: upsert(current.timetable, block) } : current,
        );
        notify(input.id ? "安排已更新" : "已新增固定安排", "ok");
        return block;
      } catch (cause) {
        fail(cause);
        return null;
      }
    },
    [fail, notify],
  );

  const deleteTimetable = useCallback(
    async (id: number) => {
      try {
        await api.deleteTimetable(id);
        setData((current) =>
          current
            ? { ...current, timetable: current.timetable.filter((block) => block.id !== id) }
            : current,
        );
        notify("安排已刪除", "ok");
      } catch (cause) {
        fail(cause);
      }
    },
    [fail, notify],
  );

  const setSetting = useCallback(
    async (key: string, value: string) => {
      setData((current) =>
        current ? { ...current, settings: { ...current.settings, [key]: value } } : current,
      );
      try {
        await api.setSetting(key, value);
      } catch (cause) {
        fail(cause);
        void reload();
      }
    },
    [fail, reload],
  );

  const toggleHabitLog = useCallback(
    async (habitId: number, date: string, present: boolean) => {
      setData((current) => {
        if (!current) return current;
        const filtered = current.logs.filter(
          (log) => !(log.habitId === habitId && log.date === date),
        );
        return {
          ...current,
          logs: present
            ? [
                ...filtered,
                {
                  id: -Date.now(),
                  habitId,
                  date,
                  note: "",
                  createdAt: new Date().toISOString(),
                },
              ]
            : filtered,
        };
      });
      try {
        const log = await api.setHabitLog(habitId, date, present);
        setData((current) => {
          if (!current) return current;
          const filtered = current.logs.filter(
            (entry) => !(entry.habitId === habitId && entry.date === date),
          );
          return { ...current, logs: log ? [...filtered, log] : filtered };
        });
      } catch (cause) {
        fail(cause);
        void reload();
      }
    },
    [fail, reload],
  );

  const saveHabit = useCallback(
    async (input: HabitInput) => {
      try {
        const habit = await api.saveHabit(input);
        setData((current) =>
          current ? { ...current, habits: upsert(current.habits, habit) } : current,
        );
        notify(input.id ? "習慣已更新" : "已建立新習慣", "ok");
        return habit;
      } catch (cause) {
        fail(cause);
        return null;
      }
    },
    [fail, notify],
  );

  const deleteHabit = useCallback(
    async (id: number) => {
      try {
        await api.deleteHabit(id);
        setData((current) =>
          current
            ? {
                ...current,
                habits: current.habits.filter((habit) => habit.id !== id),
                logs: current.logs.filter((log) => log.habitId !== id),
              }
            : current,
        );
        notify("習慣已刪除", "ok");
      } catch (cause) {
        fail(cause);
      }
    },
    [fail, notify],
  );

  const archiveHabit = useCallback(
    async (id: number, archived: boolean) => {
      try {
        const habit = await api.setHabitArchived(id, archived);
        setData((current) =>
          current ? { ...current, habits: upsert(current.habits, habit) } : current,
        );
        notify(archived ? "習慣已封存" : "習慣已恢復", "ok");
      } catch (cause) {
        fail(cause);
      }
    },
    [fail, notify],
  );

  const saveEvent = useCallback(
    async (input: EventInput) => {
      try {
        const event = await api.saveEvent(input);
        setData((current) =>
          current ? { ...current, events: upsert(current.events, event) } : current,
        );
        notify(input.id ? "行程已更新" : "已新增行程", "ok");
        requestAppleSync(400);
        return event;
      } catch (cause) {
        fail(cause);
        return null;
      }
    },
    [fail, notify, requestAppleSync],
  );

  const deleteEvent = useCallback(
    async (id: number) => {
      try {
        await api.deleteEvent(id);
        setData((current) =>
          current ? { ...current, events: current.events.filter((event) => event.id !== id) } : current,
        );
        notify("行程已刪除", "ok");
        requestAppleSync(400);
      } catch (cause) {
        fail(cause);
      }
    },
    [fail, notify, requestAppleSync],
  );

  const saveTask = useCallback(
    async (input: TaskInput) => {
      try {
        const task = await api.saveTask(input);
        setData((current) => (current ? { ...current, tasks: upsert(current.tasks, task) } : current));
        if (input.id) notify("安排已更新", "ok");
        return task;
      } catch (cause) {
        fail(cause);
        return null;
      }
    },
    [fail, notify],
  );

  const setTaskStatus = useCallback(
    async (id: number, status: Task["status"]) => {
      try {
        const task = await api.setTaskStatus(id, status);
        setData((current) => (current ? { ...current, tasks: upsert(current.tasks, task) } : current));
      } catch (cause) {
        fail(cause);
      }
    },
    [fail],
  );

  const deleteTask = useCallback(
    async (id: number) => {
      try {
        await api.deleteTask(id);
        setData((current) =>
          current ? { ...current, tasks: current.tasks.filter((task) => task.id !== id) } : current,
        );
        notify("安排已刪除", "ok");
      } catch (cause) {
        fail(cause);
      }
    },
    [fail, notify],
  );

  const importBackup = useCallback(
    async (path: string) => {
      try {
        const next = await api.importBackup(path);
        setData(next);
        notify("備份已還原", "ok");
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    [fail, notify],
  );

  const appleConnect = useCallback(async () => {
    try {
      const next = await api.appleConnect();
      setData(next);
      notify("已連結 Apple 日曆", "ok");
      return true;
    } catch (cause) {
      fail(cause);
      return false;
    }
  }, [fail, notify]);

  const appleDisconnect = useCallback(async () => {
    try {
      const next = await api.appleDisconnect();
      setData(next);
      notify("已停止 Apple 日曆同步", "ok");
      return true;
    } catch (cause) {
      fail(cause);
      return false;
    }
  }, [fail, notify]);

  const appleSetCalendars = useCallback(
    async (ids: string[]) => {
      try {
        const next = await api.appleSetCalendars(ids);
        setData(next);
        notify("已更新要匯入的 Apple 日曆", "ok");
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    [fail, notify],
  );

  const appleSync = useCallback(
    async (silent = false) => performAppleSync(silent),
    [performAppleSync],
  );

  const clearAll = useCallback(async () => {
    try {
      const next = await api.clearAllData();
      setData(next);
      notify("所有資料已清除", "ok");
    } catch (cause) {
      fail(cause);
    }
  }, [fail, notify]);

  const actions = useMemo<Actions>(
    () => ({
      toggleHabitLog,
      saveHabit,
      deleteHabit,
      archiveHabit,
      saveEvent,
      deleteEvent,
      saveTask,
      setTaskStatus,
      deleteTask,
      saveTimetable,
      deleteTimetable,
      setSetting,
      importBackup,
      clearAll,
      appleConnect,
      appleDisconnect,
      appleSync,
      appleSetCalendars,
    }),
    [
      toggleHabitLog,
      saveHabit,
      deleteHabit,
      archiveHabit,
      saveEvent,
      deleteEvent,
      saveTask,
      setTaskStatus,
      deleteTask,
      saveTimetable,
      deleteTimetable,
      setSetting,
      importBackup,
      clearAll,
      appleConnect,
      appleDisconnect,
      appleSync,
      appleSetCalendars,
    ],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      data,
      loading,
      error,
      reload,
      view,
      setView,
      settings,
      toasts,
      notify,
      dismissToast,
      actions,
      isBrowserPreview: !isTauri,
      updateInfo,
      updateError,
      checkingUpdates,
      checkForUpdates,
      updateDismissed,
      dismissUpdate,
    }),
    [
      data,
      loading,
      error,
      reload,
      view,
      settings,
      toasts,
      notify,
      dismissToast,
      actions,
      updateInfo,
      updateError,
      checkingUpdates,
      checkForUpdates,
      updateDismissed,
      dismissUpdate,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = (): AppContextValue => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp 必須在 AppProvider 內使用");
  return context;
};
