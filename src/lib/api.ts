import { invoke } from "@tauri-apps/api/core";
import type {
  AppData,
  EventInput,
  EventItem,
  Habit,
  HabitInput,
  AppleCalendarInfo,
  AppleCalendarsResponse,
  AppleStatus,
  HabitLog,
  UpdateInfo,
  StorageInfo,
  Task,
  TaskInput,
  TimetableBlock,
  TimetableInput,
} from "./types";
import { mockInvoke } from "./mock";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const call = <R,>(cmd: string, args?: Record<string, unknown>): Promise<R> =>
  isTauri ? invoke<R>(cmd, args) : mockInvoke<R>(cmd, args);

export type {
  UpdateInfo,
  AppleCalendarInfo,
  AppleCalendarsResponse,
  AppleStatus,
  AppData,
  EventInput,
  EventItem,
  Habit,
  HabitInput,
  HabitLog,
  StorageInfo,
  Task,
  TaskInput,
  TimetableBlock,
  TimetableInput,
};

export const api = {
  loadApp: (): Promise<AppData> => call<AppData>("load_app"),
  saveHabit: (habit: HabitInput): Promise<Habit> => call<Habit>("save_habit", { habit }),
  deleteHabit: (id: number): Promise<void> => call<void>("delete_habit", { id }),
  setHabitArchived: (id: number, archived: boolean): Promise<Habit> =>
    call<Habit>("set_habit_archived", { id, archived }),
  setHabitLog: (habitId: number, date: string, present: boolean): Promise<HabitLog | null> =>
    call<HabitLog | null>("set_habit_log", { habitId, date, present }),
  saveEvent: (event: EventInput): Promise<EventItem> => call<EventItem>("save_event", { event }),
  deleteEvent: (id: number): Promise<void> => call<void>("delete_event", { id }),
  saveTask: (task: TaskInput): Promise<Task> => call<Task>("save_task", { task }),
  setTaskStatus: (id: number, status: Task["status"]): Promise<Task> =>
    call<Task>("set_task_status", { id, status }),
  deleteTask: (id: number): Promise<void> => call<void>("delete_task", { id }),
  saveTimetable: (block: TimetableInput): Promise<TimetableBlock> =>
    call<TimetableBlock>("save_timetable", { block }),
  deleteTimetable: (id: number): Promise<void> => call<void>("delete_timetable", { id }),
  setSetting: (key: string, value: string): Promise<void> =>
    call<void>("set_setting", { key, value }),
  exportBackup: (path: string): Promise<string> => call<string>("export_backup", { path }),
  importBackup: (path: string): Promise<AppData> => call<AppData>("import_backup", { path }),
  clearAllData: (): Promise<AppData> => call<AppData>("clear_all_data"),
  storageInfo: (): Promise<StorageInfo> => call<StorageInfo>("storage_info"),
  appleStatus: (): Promise<AppleStatus> => call<AppleStatus>("apple_status"),
  appleConnect: (): Promise<AppData> => call<AppData>("apple_connect"),
  appleDisconnect: (): Promise<AppData> => call<AppData>("apple_disconnect"),
  appleSync: (): Promise<AppData> => call<AppData>("apple_sync"),
  appleCalendars: (): Promise<AppleCalendarsResponse> =>
    call<AppleCalendarsResponse>("apple_calendars"),
  appleSetCalendars: (ids: string[]): Promise<AppData> =>
    call<AppData>("apple_set_calendars", { ids }),
  checkForUpdates: (): Promise<UpdateInfo> => call<UpdateInfo>("check_for_updates"),
  openExternal: (url: string): Promise<void> => {
    if (!isTauri) {
      window.open(url, "_blank", "noopener");
      return Promise.resolve();
    }
    return call<void>("open_external", { url });
  },
};
