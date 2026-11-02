/**
 * Browser fallback used when the UI runs outside the Tauri shell
 * (`npm run dev` in a plain browser, automated screenshot checks).
 * The real application always goes through the Rust/SQLite backend.
 * Data is kept in localStorage so the preview survives reloads.
 */
import type {
  AppData,
  AppleCalendarInfo,
  EventInput,
  EventItem,
  Habit,
  HabitLog,
  Task,
  TimetableBlock,
} from "./types";
import { iso } from "./date";

const STORAGE_KEY = "reciprocal.browser-preview.v1";
const MOCK_APPLE_KEY = "reciprocal.mockApple";
const MOCK_APPLE_SELECTED_KEY = "reciprocal.mockAppleSelected";
const MOCK_APPLE_CARD_SELECTED_KEY = "reciprocal.mockAppleCardSelected";
const MOCK_APPLE_SYNC_COUNT_KEY = "reciprocal.mockAppleSyncCount";

const mockAppleEnabled = (): boolean =>
  typeof localStorage !== "undefined" && localStorage.getItem(MOCK_APPLE_KEY) === "1";

const MOCK_APPLE_CALENDARS: AppleCalendarInfo[] = [
  {
    id: "CAL-WORK",
    title: "工作",
    source: "iCloud",
    subscribed: false,
    kind: "caldav",
    color: "#5B7DB1",
    allowsModifications: true,
  },
  {
    id: "CAL-PERSONAL",
    title: "個人",
    source: "iCloud",
    subscribed: false,
    kind: "caldav",
    color: "#3F7C6A",
    allowsModifications: true,
  },
  {
    id: "CAL-HOLIDAY",
    title: "香港公眾假期",
    source: "iCloud",
    subscribed: true,
    kind: "subscription",
    color: "#D98A5F",
    allowsModifications: false,
  },
  {
    id: "CAL-SOLAR",
    title: "24 節氣",
    source: "iCloud",
    subscribed: true,
    kind: "subscription",
    color: "#B06AA0",
    allowsModifications: false,
  },
  {
    id: "CAL-BIRTHDAY",
    title: "生日",
    source: "聯絡人",
    subscribed: false,
    kind: "birthday",
    color: "#C2A33C",
    allowsModifications: false,
  },
];

interface MockDb extends AppData {
  seq: number;
}

const nowIso = () => new Date().toISOString();

const offsetISO = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return iso(date);
};

const seed = (): MockDb => {
  const createdAt = `${offsetISO(-30)}T08:00:00.000Z`;
  const habits: Habit[] = [
    {
      id: 1,
      name: "早晨伸展",
      emoji: "🌅",
      color: "#D98A5F",
      notes: "起床後花 10 分鐘活動筋骨，讓身體醒過來。",
      schedule: "daily",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      weeklyTarget: 7,
      timeOfDay: "morning",
      sortOrder: 0,
      archived: false,
      createdAt,
    },
    {
      id: 2,
      name: "閱讀 20 分鐘",
      emoji: "📖",
      color: "#3F7C6A",
      notes: "",
      schedule: "daily",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      weeklyTarget: 7,
      timeOfDay: "evening",
      sortOrder: 1,
      archived: false,
      createdAt,
    },
    {
      id: 3,
      name: "運動 3 次",
      emoji: "🏃",
      color: "#5B7DB1",
      notes: "每週至少三次，每次 30 分鐘以上。",
      schedule: "times_per_week",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      weeklyTarget: 3,
      timeOfDay: "afternoon",
      sortOrder: 2,
      archived: false,
      createdAt,
    },
  ];

  const logDates: Array<[number, string]> = [
    [1, offsetISO(-1)],
    [1, offsetISO(-2)],
    [1, offsetISO(-4)],
    [1, offsetISO(-8)],
    [1, offsetISO(-10)],
    [1, offsetISO(-12)],
    [2, offsetISO(-1)],
    [2, offsetISO(-2)],
    [2, offsetISO(-3)],
    [2, offsetISO(-9)],
    [3, offsetISO(-2)],
    [3, offsetISO(-5)],
    [3, offsetISO(-9)],
  ];
  const logs: HabitLog[] = logDates.map(([habitId, date], index) => ({
    id: index + 1,
    habitId,
    date,
    note: "",
    createdAt: `${date}T21:00:00.000Z`,
  }));

  const events: EventItem[] = [
    {
      id: 1,
      title: "與朋友午餐",
      notes: "",
      date: offsetISO(1),
      startTime: "12:30",
      endTime: "14:00",
      allDay: false,
      color: "#D98A5F",
      location: "巷口的越南菜",
      category: "社交",
      source: "local",
      externalId: null,
      externalCalendar: null,
      externalCalendarId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 2,
      title: "月度回顧",
      notes: "檢視這個月的習慣與目標。",
      date: offsetISO(3),
      startTime: null,
      endTime: null,
      allDay: true,
      color: "#5B7DB1",
      location: "",
      category: "個人",
      source: "local",
      externalId: null,
      externalCalendar: null,
      externalCalendarId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  const tasks: Task[] = [
    {
      id: 1,
      title: "買新的筆記本",
      notes: "文具店或線上書店都可以",
      status: "todo",
      priority: 1,
      dueDate: offsetISO(0),
      tags: ["生活"],
      list: "個人",
      createdAt: nowIso(),
      completedAt: null,
      sortOrder: 2,
    },
    {
      id: 2,
      title: "整理這週的照片",
      notes: "備份到外接硬碟",
      status: "doing",
      priority: 2,
      dueDate: offsetISO(2),
      tags: ["數位"],
      list: "個人",
      createdAt: nowIso(),
      completedAt: null,
      sortOrder: 1,
    },
    {
      id: 3,
      title: "讀完《原子習慣》第 3 章",
      notes: "",
      status: "done",
      priority: 0,
      dueDate: offsetISO(-1),
      tags: ["閱讀"],
      list: "學習",
      createdAt: nowIso(),
      completedAt: nowIso(),
      sortOrder: 0,
    },
  ];

  const timetable: TimetableBlock[] = [
    {
      id: 1,
      day: 1,
      startTime: "09:00",
      endTime: "10:00",
      title: "週計畫與信箱",
      notes: "看一遍這週的行事曆與待辦。",
      color: "#5B7DB1",
      createdAt,
    },
    {
      id: 2,
      day: 1,
      startTime: "19:00",
      endTime: "20:00",
      title: "運動",
      notes: "重訓或有氧都可以。",
      color: "#3F7C6A",
      createdAt,
    },
    {
      id: 3,
      day: 2,
      startTime: "10:00",
      endTime: "12:00",
      title: "深度工作",
      notes: "關掉通知，只做最重要的一件事。",
      color: "#B06AA0",
      createdAt,
    },
    {
      id: 4,
      day: 3,
      startTime: "14:00",
      endTime: "15:30",
      title: "英文課",
      notes: "",
      color: "#C2A33C",
      createdAt,
    },
    {
      id: 5,
      day: 4,
      startTime: "09:30",
      endTime: "10:30",
      title: "團隊同步",
      notes: "",
      color: "#5B7DB1",
      createdAt,
    },
    {
      id: 6,
      day: 5,
      startTime: "18:00",
      endTime: "18:30",
      title: "週回顧",
      notes: "寫下這週完成的三件事。",
      color: "#D98A5F",
      createdAt,
    },
  ];

  return {
    habits,
    logs,
    events,
    tasks,
    timetable,
    settings: { onboarded: "1" },
    seq: 100,
  };
};

let cache: MockDb | null = null;

const load = (): MockDb => {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cache = JSON.parse(raw) as MockDb;
      return cache;
    }
  } catch {
    /* ignore corrupt preview data */
  }
  cache = seed();
  persist(cache);
  return cache;
};

const persist = (db: MockDb): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* storage may be unavailable */
  }
};

const nextId = (db: MockDb): number => {
  db.seq += 1;
  return db.seq;
};

const snapshot = (db: MockDb): AppData => ({
  habits: db.habits,
  logs: db.logs,
  events: db.events,
  tasks: db.tasks,
  timetable: db.timetable,
  settings: db.settings,
});

const touch = (db: MockDb): AppData => {
  persist(db);
  return snapshot(db);
};

const findHabit = (db: MockDb, id: number): Habit => {
  const habit = db.habits.find((item) => item.id === id);
  if (!habit) throw "找不到這個習慣";
  return habit;
};

const findTask = (db: MockDb, id: number): Task => {
  const task = db.tasks.find((item) => item.id === id);
  if (!task) throw "找不到這項事務";
  return task;
};

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const db = load();
  const payload = (args ?? {}) as Record<string, any>;

  switch (cmd) {
    case "load_app":
      return snapshot(db) as T;

    case "save_habit": {
      const input = payload.habit as Habit;
      if (!input.name?.trim()) throw "習慣名稱不能留空";
      if (input.id) {
        const habit = findHabit(db, input.id);
        Object.assign(habit, {
          name: input.name.trim(),
          emoji: input.emoji || habit.emoji,
          color: input.color || habit.color,
          notes: input.notes ?? "",
          schedule: input.schedule ?? habit.schedule,
          weekdays: input.weekdays?.length ? input.weekdays : [1, 2, 3, 4, 5, 6, 7],
          weeklyTarget: input.weeklyTarget || 7,
          timeOfDay: input.timeOfDay ?? habit.timeOfDay,
          archived: Boolean(input.archived),
        });
        return touch(db).habits.find((item) => item.id === habit.id) as T;
      }
      const habit: Habit = {
        id: nextId(db),
        name: input.name.trim(),
        emoji: input.emoji || "🌱",
        color: input.color || "#3F7C6A",
        notes: input.notes ?? "",
        schedule: input.schedule ?? "daily",
        weekdays: input.weekdays?.length ? input.weekdays : [1, 2, 3, 4, 5, 6, 7],
        weeklyTarget: input.weeklyTarget || 7,
        timeOfDay: input.timeOfDay ?? "anytime",
        sortOrder: db.habits.length,
        archived: Boolean(input.archived),
        createdAt: nowIso(),
      };
      db.habits.push(habit);
      persist(db);
      return habit as T;
    }

    case "delete_habit": {
      const id = payload.id as number;
      db.habits = db.habits.filter((habit) => habit.id !== id);
      db.logs = db.logs.filter((log) => log.habitId !== id);
      return touch(db) as T;
    }

    case "set_habit_archived": {
      const habit = findHabit(db, payload.id as number);
      habit.archived = Boolean(payload.archived);
      persist(db);
      return habit as T;
    }

    case "set_habit_log": {
      const habitId = payload.habitId as number;
      const date = payload.date as string;
      const present = Boolean(payload.present);
      findHabit(db, habitId);
      db.logs = db.logs.filter((log) => !(log.habitId === habitId && log.date === date));
      if (present) {
        const log: HabitLog = { id: nextId(db), habitId, date, note: "", createdAt: nowIso() };
        db.logs.push(log);
        persist(db);
        return log as T;
      }
      persist(db);
      return null as T;
    }

    case "save_event": {
      const input = payload.event as EventInput;
      if (!input.title?.trim()) throw "行程標題不能留空";
      const start = input.allDay ? null : input.startTime || null;
      const end = input.allDay ? null : input.endTime || null;
      if (input.id) {
        const event = db.events.find((item) => item.id === input.id);
        if (!event) throw "找不到要更新的行程";
        Object.assign(event, {
          title: input.title.trim(),
          notes: input.notes ?? "",
          date: input.date,
          startTime: start,
          endTime: end,
          allDay: Boolean(input.allDay),
          color: input.color || event.color,
          location: input.location ?? "",
          category: input.category || "個人",
          externalCalendarId: input.appleCalendarId ?? event.externalCalendarId,
          updatedAt: nowIso(),
        });
        persist(db);
        return event as T;
      }
      const event: EventItem = {
        id: nextId(db),
        title: input.title.trim(),
        notes: input.notes ?? "",
        date: input.date,
        startTime: start,
        endTime: end,
        allDay: Boolean(input.allDay),
        color: input.color || "#5B7DB1",
        location: input.location ?? "",
        category: input.category || "個人",
        source: "local",
        externalId: null,
        externalCalendar: null,
        externalCalendarId: input.appleCalendarId ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.events.push(event);
      persist(db);
      return event as T;
    }

    case "delete_event":
      db.events = db.events.filter((event) => event.id !== payload.id);
      return touch(db) as T;

    case "save_task": {
      const input = payload.task as Task;
      if (!input.title?.trim()) throw "事務標題不能留空";
      const status = (input.status ?? "todo") as Task["status"];
      if (input.id) {
        const task = findTask(db, input.id);
        Object.assign(task, {
          title: input.title.trim(),
          notes: input.notes ?? "",
          status,
          priority: Number(input.priority ?? 0),
          dueDate: input.dueDate || null,
          tags: input.tags ?? [],
          list: input.list || "個人",
          completedAt:
            status === "done" ? task.completedAt ?? nowIso() : null,
        });
        persist(db);
        return task as T;
      }
      const task: Task = {
        id: nextId(db),
        title: input.title.trim(),
        notes: input.notes ?? "",
        status,
        priority: Number(input.priority ?? 0),
        dueDate: input.dueDate || null,
        tags: input.tags ?? [],
        list: input.list || "個人",
        createdAt: nowIso(),
        completedAt: status === "done" ? nowIso() : null,
        sortOrder: db.tasks.length,
      };
      db.tasks.push(task);
      persist(db);
      return task as T;
    }

    case "set_task_status": {
      const task = findTask(db, payload.id as number);
      task.status = payload.status as Task["status"];
      task.completedAt = task.status === "done" ? task.completedAt ?? nowIso() : null;
      persist(db);
      return task as T;
    }

    case "delete_task":
      db.tasks = db.tasks.filter((task) => task.id !== payload.id);
      return touch(db) as T;

    case "save_timetable": {
      const input = payload.block as TimetableBlock;
      if (!input.title?.trim()) throw "安排標題不能留空";
      if (![1, 2, 3, 4, 5].includes(Number(input.day))) throw "固定安排只支援星期一至星期五";
      if (!input.startTime || !input.endTime) throw "請填寫開始與結束時間";
      if (input.endTime <= input.startTime) throw "結束時間必須晚於開始時間";
      const block: TimetableBlock = {
        id: input.id ?? nextId(db),
        day: Number(input.day),
        startTime: input.startTime,
        endTime: input.endTime,
        title: input.title.trim(),
        notes: input.notes ?? "",
        color: input.color || "#5B7DB1",
        createdAt: input.id ? (db.timetable.find((item) => item.id === input.id)?.createdAt ?? nowIso()) : nowIso(),
      };
      const existing = db.timetable.findIndex((item) => item.id === block.id);
      if (existing >= 0) db.timetable[existing] = block;
      else db.timetable.push(block);
      persist(db);
      return block as T;
    }

    case "delete_timetable":
      db.timetable = db.timetable.filter((block) => block.id !== payload.id);
      return touch(db) as T;

    case "set_setting": {
      const key = payload.key as string;
      const value = String(payload.value);
      db.settings[key] = value;
      if (key === "appleCardCalendarIds" && typeof localStorage !== "undefined") {
        localStorage.setItem(MOCK_APPLE_CARD_SELECTED_KEY, value);
      }
      persist(db);
      return undefined as T;
    }

    case "check_for_updates": {
      const hasUpdate = localStorage.getItem("reciprocal.mockUpdate") === "1";
      return {
        currentVersion: __APP_VERSION__,
        latestVersion: hasUpdate ? "0.2.0" : __APP_VERSION__,
        updateAvailable: hasUpdate,
        releaseUrl: hasUpdate
          ? "https://github.com/david0304git/reciprocal/releases/tag/v0.2.0"
          : `https://github.com/david0304git/reciprocal/releases/tag/v${__APP_VERSION__}`,
        releaseName: hasUpdate ? "v0.2.0" : `v${__APP_VERSION__}`,
        publishedAt: nowIso(),
        source: "release",
      } as T;
    }

    case "open_external":
      return undefined as T;

    case "apple_status":
      if (!mockAppleEnabled()) {
        return {
          supported: false,
          enabled: false,
          authorization: "unsupported",
          calendarId: null,
          lastSync: null,
          importedCount: 0,
          mirroredCount: 0,
        } as T;
      }
      return {
        supported: true,
        enabled: true,
        authorization: "fullAccess",
        calendarId: "CAL-RECIP",
        lastSync: nowIso(),
        importedCount: 42,
        mirroredCount: 3,
      } as T;

    case "apple_calendars": {
      if (!mockAppleEnabled()) throw "Apple 日曆整合只能在 macOS App 中使用。";
      const stored = localStorage.getItem(MOCK_APPLE_SELECTED_KEY);
      const selected = stored
        ? (JSON.parse(stored) as string[])
        : ["CAL-WORK", "CAL-PERSONAL"];
      const storedCards = localStorage.getItem(MOCK_APPLE_CARD_SELECTED_KEY);
      const cardSelected = storedCards ? (JSON.parse(storedCards) as string[]) : selected;
      const dedicated = {
        id: "CAL-RECIP",
        title: "Reciprocal",
        source: "iCloud",
        subscribed: false,
        kind: "caldav",
        color: "#2F6B57",
        allowsModifications: true,
      };
      const eventCalendars = MOCK_APPLE_CALENDARS.filter(
        (calendar) => calendar.allowsModifications,
      ).concat([dedicated]);
      return {
        calendars: MOCK_APPLE_CALENDARS,
        selected,
        cardSelected,
        eventCalendars,
      } as T;
    }

    case "apple_set_calendars": {
      if (!mockAppleEnabled()) throw "Apple 日曆整合只能在 macOS App 中使用。";
      localStorage.setItem(MOCK_APPLE_SELECTED_KEY, JSON.stringify(payload.ids ?? []));
      return snapshot(db) as T;
    }

    case "apple_connect":
    case "apple_disconnect":
      if (mockAppleEnabled()) return snapshot(db) as T;
      throw "Apple 日曆整合只能在 macOS App 中使用。";

    case "apple_sync": {
      if (!mockAppleEnabled()) throw "Apple 日曆整合只能在 macOS App 中使用。";
      const count = Number(localStorage.getItem(MOCK_APPLE_SYNC_COUNT_KEY) ?? "0");
      localStorage.setItem(MOCK_APPLE_SYNC_COUNT_KEY, String(count + 1));
      return snapshot(db) as T;
    }

    case "storage_info":
      return {
        dbPath: "瀏覽器預覽模式（未連接 Tauri）",
        dataDir: "localStorage",
        sizeBytes: JSON.stringify(snapshot(db)).length,
      } as T;

    case "export_backup":
      throw "瀏覽器預覽模式不支援直接寫檔，請使用 App 內的匯出。";

    case "import_backup":
      throw "瀏覽器預覽模式不支援匯入備份。";

    case "clear_all_data": {
      const fresh = seed();
      fresh.habits = [];
      fresh.logs = [];
      fresh.events = [];
      fresh.tasks = [];
      fresh.timetable = [];
      fresh.settings = { onboarded: "1" };
      fresh.seq = 100;
      cache = fresh;
      return touch(fresh) as T;
    }

    default:
      throw `未實作的預覽命令：${cmd}`;
  }
}
