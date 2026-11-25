import { addDays, differenceInCalendarDays, parseISO, startOfMonth, startOfWeek } from "date-fns";

export const WEEKDAY_LABELS_MON = ["一", "二", "三", "四", "五", "六", "日"];
export const WEEKDAY_FULL = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export const iso = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const parse = (value: string): Date => parseISO(value);

export const todayISO = (): string => iso(new Date());

export const addDaysISO = (value: string, days: number): string => iso(addDays(parseISO(value), days));

/** 1 = Monday … 7 = Sunday (ISO weekday). */
export const weekdayMon = (date: Date): number => (date.getDay() === 0 ? 7 : date.getDay());

export const weekdayLabel = (isoDate: string): string => {
  const day = parseISO(isoDate).getDay();
  return `週${["日", "一", "二", "三", "四", "五", "六"][day]}`;
};

export const formatLong = (isoDate: string): string => {
  const date = parseISO(isoDate);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEKDAY_FULL[date.getDay()]}`;
};

export const formatMonthTitle = (date: Date): string => `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;

export const formatShort = (isoDate: string): string => {
  const date = parseISO(isoDate);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
};

export const formatFullWeekday = (isoDate: string): string =>
  WEEKDAY_FULL[parseISO(isoDate).getDay()];

export type WeekStart = 0 | 1;

export const startOfWeekISO = (isoDate: string, weekStartsOn: WeekStart): string =>
  iso(startOfWeek(parseISO(isoDate), { weekStartsOn }));

export const monthGrid = (month: Date, weekStartsOn: WeekStart): Date[] => {
  const first = startOfMonth(month);
  const gridStart = startOfWeek(first, { weekStartsOn });
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
};

export const isSameMonth = (date: Date, month: Date): boolean =>
  date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();

export const isToday = (isoDate: string): boolean => isoDate === todayISO();

export const isPast = (isoDate: string): boolean => isoDate < todayISO();

export const daysBetween = (from: string, to: string): number =>
  differenceInCalendarDays(parseISO(to), parseISO(from));

/** Human friendly deadline label used on task rows. */
export const dueLabel = (isoDate: string): string => {
  const diff = daysBetween(todayISO(), isoDate);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "後天";
  if (diff === -1) return "逾期 1 天";
  if (diff < -1) return `逾期 ${Math.abs(diff)} 天`;
  if (diff < 7) return `${diff} 天後`;
  return formatShort(isoDate);
};

export const greeting = (): { title: string; hint: string } => {
  const hour = new Date().getHours();
  if (hour < 5) return { title: "夜深了", hint: "把今天的思緒放下，好好休息。" };
  if (hour < 11) return { title: "早安", hint: "從一件小事開始，今天就有了節奏。" };
  if (hour < 14) return { title: "午安", hint: "記得放慢一點，吃頓好好的午餐。" };
  if (hour < 18) return { title: "午後", hint: "還剩下半天，挑一件最重要的事完成。" };
  if (hour < 23) return { title: "晚上好", hint: "把今天的努力收進紀錄裡。" };
  return { title: "晚安", hint: "今天走到這裡已經很好了。" };
};

export const hexAlpha = (hex: string, alpha: number): string => {
  const clean = hex.replace("#", "");
  const value = clean.length === 3
    ? clean
        .split("")
        .map((ch) => ch + ch)
        .join("")
    : clean;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
