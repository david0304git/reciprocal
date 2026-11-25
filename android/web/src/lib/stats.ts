import { addDays, differenceInCalendarDays, parseISO, startOfWeek } from "date-fns";
import type { Habit, HabitLog, Task } from "./types";
import { iso, todayISO, weekdayMon } from "./date";

export interface HabitStats {
  currentStreak: number;
  longestStreak: number;
  streakUnit: "天" | "週";
  todayDone: boolean;
  weekDone: number;
  weekTarget: number;
  rate30: number;
  total: number;
}

export const logKey = (habitId: number, date: string): string => `${habitId}:${date}`;

export const buildLogIndex = (logs: HabitLog[]): Map<string, HabitLog> => {
  const index = new Map<string, HabitLog>();
  for (const log of logs) index.set(logKey(log.habitId, log.date), log);
  return index;
};

const weekdayOfISO = (date: string): number => weekdayMon(parseISO(date));

/** Is the habit expected on this calendar day? */
export const isScheduledOn = (habit: Habit, date: string, _weekStart: 0 | 1 = 1): boolean => {
  if (habit.schedule === "weekdays") return habit.weekdays.includes(weekdayOfISO(date));
  return true;
};

/** Number of logs the habit has within the week containing `date`. */
export const weekProgress = (
  habit: Habit,
  index: Map<string, HabitLog>,
  date: string,
  weekStart: 0 | 1,
): number => {
  const start = startOfWeek(parseISO(date), { weekStartsOn: weekStart });
  let count = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = iso(addDays(start, offset));
    if (index.has(logKey(habit.id, day))) count += 1;
  }
  return count;
};

const scheduledDaysBetween = (habit: Habit, from: string, to: string, weekStart: 0 | 1): number => {
  let count = 0;
  let cursor = parseISO(from);
  const end = parseISO(to);
  while (cursor <= end) {
    if (isScheduledOn(habit, iso(cursor), weekStart)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
};

export const habitStats = (
  habit: Habit,
  index: Map<string, HabitLog>,
  today = todayISO(),
  weekStart: 0 | 1 = 1,
): HabitStats => {
  const created = habit.createdAt.slice(0, 10);
  const start = created < today ? created : today;
  const todayDone = index.has(logKey(habit.id, today));
  const weekDone = weekProgress(habit, index, today, weekStart);
  const weekTarget = habit.schedule === "times_per_week" ? habit.weeklyTarget : 7;

  let total = 0;
  for (let cursor = parseISO(start); cursor <= parseISO(today); cursor = addDays(cursor, 1)) {
    if (index.has(logKey(habit.id, iso(cursor)))) total += 1;
  }

  const scheduled30 = scheduledDaysBetween(habit, iso(addDays(parseISO(today), -29)), today, weekStart);
  let done30 = 0;
  for (let cursor = addDays(parseISO(today), -29); cursor <= parseISO(today); cursor = addDays(cursor, 1)) {
    if (index.has(logKey(habit.id, iso(cursor)))) done30 += 1;
  }
  const rate30 =
    habit.schedule === "times_per_week"
      ? Math.min(1, done30 / Math.max(1, Math.round((habit.weeklyTarget / 7) * 30)))
      : scheduled30 === 0
        ? 0
        : Math.min(1, done30 / scheduled30);

  if (habit.schedule === "times_per_week") {
    // Streaks measured in whole weeks that hit the weekly target.
    const target = Math.max(1, habit.weeklyTarget);
    let current = 0;
    let cursor = startOfWeek(parseISO(today), { weekStartsOn: weekStart });
    const thisWeekDone = weekProgress(habit, index, iso(cursor), weekStart);
    if (thisWeekDone >= target) current += 1;
    cursor = addDays(cursor, -7);
    while (true) {
      let done = 0;
      for (let offset = 0; offset < 7; offset += 1) {
        if (index.has(logKey(habit.id, iso(addDays(cursor, offset))))) done += 1;
      }
      if (done >= target) {
        current += 1;
        cursor = addDays(cursor, -7);
      } else break;
    }

    let longest = 0;
    let run = 0;
    let week = startOfWeek(parseISO(start), { weekStartsOn: weekStart });
    const lastWeek = startOfWeek(parseISO(today), { weekStartsOn: weekStart });
    while (week <= lastWeek) {
      let done = 0;
      for (let offset = 0; offset < 7; offset += 1) {
        if (index.has(logKey(habit.id, iso(addDays(week, offset))))) done += 1;
      }
      if (done >= target) {
        run += 1;
        longest = Math.max(longest, run);
      } else run = 0;
      week = addDays(week, 7);
    }
    return {
      currentStreak: current,
      longestStreak: Math.max(longest, current),
      streakUnit: "週",
      todayDone,
      weekDone,
      weekTarget,
      rate30,
      total,
    };
  }

  // Daily / weekday streaks: walk backwards over scheduled days.
  let current = 0;
  let cursor = parseISO(today);
  if (!todayDone) cursor = addDays(cursor, -1); // today is still grace, not a break
  while (true) {
    const day = iso(cursor);
    if (day < start) break;
    if (isScheduledOn(habit, day, weekStart)) {
      if (index.has(logKey(habit.id, day))) {
        current += 1;
      } else break;
    }
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  for (let day = parseISO(start); day <= parseISO(today); day = addDays(day, 1)) {
    const key = iso(day);
    if (isScheduledOn(habit, key, weekStart)) {
      if (index.has(logKey(habit.id, key))) {
        run += 1;
        longest = Math.max(longest, run);
      } else run = 0;
    }
  }

  return {
    currentStreak: current,
    longestStreak: Math.max(longest, current),
    streakUnit: "天",
    todayDone,
    weekDone,
    weekTarget,
    rate30,
    total,
  };
};

export const scheduleLabel = (habit: Habit): string => {
  if (habit.schedule === "times_per_week") return `每週 ${habit.weeklyTarget} 次`;
  if (habit.schedule === "weekdays") {
    if (habit.weekdays.length === 7) return "每天";
    if (habit.weekdays.length === 5 && [1, 2, 3, 4, 5].every((day) => habit.weekdays.includes(day))) {
      return "週一到週五";
    }
    const names = ["一", "二", "三", "四", "五", "六", "日"];
    return `週${habit.weekdays.map((day) => names[day - 1]).join("・")}`;
  }
  return "每天";
};

export const timeOfDayLabel: Record<string, string> = {
  anytime: "任何時候",
  morning: "早上",
  afternoon: "下午",
  evening: "晚上",
};

export const PRIORITY_LABELS = ["無", "低", "中", "高"] as const;

export const isTaskOverdue = (task: Task, today = todayISO()): boolean =>
  Boolean(task.dueDate && task.status !== "done" && task.dueDate < today);

export const todayTasks = (tasks: Task[], today = todayISO()): Task[] =>
  tasks.filter((task) => task.status !== "done" && task.dueDate && task.dueDate <= today);

export const taskDueBucket = (task: Task, today = todayISO()): "overdue" | "today" | "soon" | "later" | "none" => {
  if (!task.dueDate) return "none";
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  if (differenceInCalendarDays(parseISO(task.dueDate), parseISO(today)) <= 7) return "soon";
  return "later";
};
