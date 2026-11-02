export type HabitSchedule = "daily" | "weekdays" | "times_per_week";
export type TimeOfDay = "anytime" | "morning" | "afternoon" | "evening";
export type TaskStatus = "todo" | "doing" | "done";
export type ThemeMode = "auto" | "light" | "dark";

export interface Habit {
  id: number;
  name: string;
  emoji: string;
  color: string;
  notes: string;
  schedule: HabitSchedule;
  weekdays: number[];
  weeklyTarget: number;
  timeOfDay: TimeOfDay;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
}

export interface HabitInput {
  id?: number;
  name: string;
  emoji?: string;
  color?: string;
  notes?: string;
  schedule?: HabitSchedule;
  weekdays?: number[];
  weeklyTarget?: number;
  timeOfDay?: TimeOfDay;
  archived?: boolean;
}

export interface HabitLog {
  id: number;
  habitId: number;
  date: string;
  note: string;
  createdAt: string;
}

export interface EventItem {
  id: number;
  title: string;
  notes: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  color: string;
  location: string;
  category: string;
  source: "local" | "apple" | string;
  externalId: string | null;
  externalCalendar: string | null;
  externalCalendarId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppleCalendarInfo {
  id: string;
  title: string;
  source: string;
  subscribed: boolean;
  kind: string;
  color: string;
  allowsModifications: boolean;
}

export interface AppleCalendarsResponse {
  calendars: AppleCalendarInfo[];
  selected: string[];
  cardSelected: string[];
  eventCalendars: AppleCalendarInfo[];
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  source: string;
}

export interface AppleStatus {
  supported: boolean;
  enabled: boolean;
  authorization: string;
  calendarId: string | null;
  lastSync: string | null;
  importedCount: number;
  mirroredCount: number;
}

export interface EventInput {
  id?: number;
  title: string;
  notes?: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  color?: string;
  location?: string;
  category?: string;
  appleCalendarId?: string | null;
}

export interface Task {
  id: number;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: number;
  dueDate: string | null;
  tags: string[];
  list: string;
  createdAt: string;
  completedAt: string | null;
  sortOrder: number;
}

export interface TaskInput {
  id?: number;
  title: string;
  notes?: string;
  status?: TaskStatus;
  priority?: number;
  dueDate?: string | null;
  tags?: string[];
  list?: string;
}

export interface TimetableBlock {
  id: number;
  /** 1 = Monday … 5 = Friday */
  day: number;
  startTime: string;
  endTime: string;
  title: string;
  notes: string;
  color: string;
  createdAt: string;
}

export interface TimetableInput {
  id?: number;
  day: number;
  startTime: string;
  endTime: string;
  title: string;
  notes?: string;
  color?: string;
}

export interface AppData {
  habits: Habit[];
  logs: HabitLog[];
  events: EventItem[];
  tasks: Task[];
  timetable: TimetableBlock[];
  settings: Record<string, string>;
}

export interface StorageInfo {
  dbPath: string;
  dataDir: string;
  sizeBytes: number;
}

export type ViewKey = "today" | "calendar" | "tasks" | "settings";
