import type { EventItem, TimetableBlock } from "./types";
import { parseISO } from "date-fns";
import { todayISO } from "./date";

/**
 * Shared timeline helpers for the calendar countdown and the home hero card.
 *
 * Two different sources live side by side: dated calendar events (one-off commitments) and the
 * weekly timetable (recurring blocks). Both are flattened to milliseconds here so the countdown
 * can be computed without timezone surprises — every `YYYY-MM-DD` / `HH:MM` string is interpreted
 * in the device's local timezone.
 */

/** Local midnight in ms for a `YYYY-MM-DD` string. */
const dayStart = (isoDate: string): number => {
  const date = parseISO(isoDate);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Local midnight in ms for a Date. */
const localDayStart = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export const eventStartMs = (event: EventItem): number => {
  const time = event.allDay || !event.startTime ? "00:00" : event.startTime;
  return new Date(`${event.date}T${time}`).getTime();
};

export const eventEndMs = (event: EventItem): number => {
  if (event.allDay || !event.startTime) return new Date(`${event.date}T23:59`).getTime();
  const start = eventStartMs(event);
  const end = event.endTime || event.startTime;
  const endMs = new Date(`${event.date}T${end}`).getTime();
  return endMs === start ? endMs + 60 * 60 * 1000 : endMs;
};

/** "N 分鐘" / "N 小時 M 分" / "N 天 H 小時" — used for “還有 …”. */
export const spanLabel = (ms: number): string => {
  if (ms <= 0) return "已結束";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "不到 1 分鐘";
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} 小時` : `${hours} 小時 ${minutes % 60} 分`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days} 天` : `${days} 天 ${rest} 小時`;
};

/** Same wording the calendar countdown cards use. */
export const countdownLabel = (event: EventItem, nowMs: number): string => {
  if (event.allDay) {
    const days = Math.round((dayStart(event.date) - localDayStart(new Date(nowMs))) / 86_400_000);
    if (days <= 0) return "今天";
    if (days === 1) return "明天";
    return `${days} 天後`;
  }
  const diff = eventStartMs(event) - nowMs;
  if (diff <= 0) return "進行中";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分鐘後`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時 ${minutes % 60} 分後`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小時後`;
};

/** The “倒數卡片顯示的日曆” setting: null means no filter. */
export const readCardCalendarFilter = (
  settings: Record<string, string> | undefined,
): string[] | null => {
  const raw = settings?.appleCardCalendarIds;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
};

export const isInCardCalendarFilter = (
  event: EventItem,
  filter: string[] | null,
): boolean =>
  event.source !== "apple" ||
  filter === null ||
  !event.externalCalendarId ||
  filter.includes(event.externalCalendarId);

// ------------------------------------------------------------------ timetable

export interface TodayBlock {
  id: number;
  title: string;
  startTime: string;
  endTime: string;
  color: string;
  startMs: number;
  endMs: number;
}

export const buildTodayBlocks = (
  blocks: TimetableBlock[],
  weekday: number,
  nowMs: number,
): TodayBlock[] => {
  const midnight = localDayStart(new Date(nowMs));
  return blocks
    .filter((block) => block.day === weekday)
    .map((block) => {
      const [startHour, startMinute] = block.startTime.split(":").map(Number);
      const [endHour, endMinute] = block.endTime.split(":").map(Number);
      return {
        id: block.id,
        title: block.title,
        startTime: block.startTime,
        endTime: block.endTime,
        color: block.color,
        startMs: midnight + (startHour * 60 + startMinute) * 60_000,
        endMs: midnight + (endHour * 60 + endMinute) * 60_000,
      };
    })
    .sort((a, b) => a.startMs - b.startMs);
};

// ------------------------------------------------------------------ home agenda

export const HOME_RANGE_KEY = "homeEventRangeDays";
export const HOME_RANGE_OPTIONS = [7, 14, 30] as const;
export type HomeRangeDays = (typeof HOME_RANGE_OPTIONS)[number];

export const readHomeRangeDays = (
  settings: Record<string, string> | undefined,
): HomeRangeDays => {
  const value = Number(settings?.[HOME_RANGE_KEY]);
  return HOME_RANGE_OPTIONS.includes(value as HomeRangeDays)
    ? (value as HomeRangeDays)
    : 14;
};

export interface HomeEventCard {
  event: EventItem;
  startMs: number;
  endMs: number;
  /** Already running (timed events only). */
  current: boolean;
  /** “2 天後” / “還有 42 分鐘”. */
  countdown: string;
  /** Compact right-hand time label: “今天 09:00” / “週四 · 全天”. */
  when: string;
}

const addDaysISO = (isoDate: string, days: number): string => {
  const date = parseISO(isoDate);
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${next.getFullYear()}-${month}-${day}`;
};

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];

/** Minimal right-hand label, no date grouping in the list itself. */
export const eventWhenLabel = (event: EventItem, nowMs: number): string => {
  const days = Math.round((dayStart(event.date) - localDayStart(new Date(nowMs))) / 86_400_000);
  const time = event.allDay ? "全天" : event.startTime ?? "";
  if (days === 0) return `今天 · ${time}`;
  if (days === 1) return `明天 · ${time}`;
  if (days === 2) return `後天 · ${time}`;
  if (days > 0 && days < 7) {
    const date = parseISO(event.date);
    return `週${WEEKDAY_SHORT[date.getDay()]} · ${time}`;
  }
  const date = parseISO(event.date);
  return `${date.getMonth() + 1}/${date.getDate()} · ${time}`;
};

/**
 * Every event inside the configured window (7 / 14 / 30 days), nearest first. The window is
 * inclusive of today and counts calendar days, e.g. 7 → today … today+6.
 */
export const homeEventCards = ({
  events,
  settings,
  nowMs,
}: {
  events: EventItem[];
  settings: Record<string, string> | undefined;
  nowMs: number;
}): HomeEventCard[] => {
  const today = todayISO();
  const rangeDays = readHomeRangeDays(settings);
  const lastDay = addDaysISO(today, rangeDays - 1);
  const filter = readCardCalendarFilter(settings);

  return events
    .filter((event) => isInCardCalendarFilter(event, filter))
    .filter((event) => event.date >= today && event.date <= lastDay)
    .filter((event) => eventEndMs(event) >= nowMs)
    .map((event) => {
      const start = eventStartMs(event);
      const end = eventEndMs(event);
      const current = !event.allDay && start <= nowMs && end > nowMs;
      return {
        event,
        startMs: start,
        endMs: end,
        current,
        countdown: current ? `還有 ${spanLabel(end - nowMs)}` : countdownLabel(event, nowMs),
        when: eventWhenLabel(event, nowMs),
      };
    })
    .sort((a, b) => a.startMs - b.startMs);
};

// ------------------------------------------------------------------ timetable peek

export interface BlockPeek {
  /** 現在 / 下一段 / 今天沒有時段 */
  label: string;
  title: string;
  time: string;
  tone: "current" | "next" | "empty";
}

export const blockPeek = (
  blocks: TimetableBlock[],
  weekday: number,
  nowMs: number,
): BlockPeek => {
  const todayBlocks = buildTodayBlocks(blocks, weekday, nowMs);
  const current = todayBlocks.find((block) => block.startMs <= nowMs && block.endMs > nowMs);
  if (current) {
    return {
      label: "現在",
      title: current.title,
      time: `${current.startTime} – ${current.endTime}`,
      tone: "current",
    };
  }
  const next = todayBlocks.find((block) => block.startMs > nowMs);
  if (next) {
    return {
      label: "下一段",
      title: next.title,
      time: `${next.startTime} 開始`,
      tone: "next",
    };
  }
  return { label: "時間表", title: "今天沒有時段", time: "", tone: "empty" };
};

// ------------------------------------------------------------------ custom order

/** Cards follow a hand-made order when the user has dragged them; new events append by date. */
export const HOME_EVENT_ORDER_KEY = "reciprocal.homeEventOrder";

export const readHomeEventOrder = (): number[] => {
  try {
    const raw = localStorage.getItem(HOME_EVENT_ORDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === "number");
  } catch {
    return [];
  }
};

export const writeHomeEventOrder = (ids: number[]): void => {
  try {
    localStorage.setItem(HOME_EVENT_ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* storage may be unavailable */
  }
};

/**
 * Applied to an already chronologically sorted list: ids present in the stored order keep that
 * order (even if their time has changed), everything else keeps the chronological order and lands
 * after them.
 */
export const applyHomeEventOrder = <T extends { event: EventItem }>(
  cards: T[],
  order: number[],
): T[] => {
  if (order.length === 0) return cards;
  const byId = new Map(cards.map((card) => [card.event.id, card]));
  const ordered: T[] = [];
  for (const id of order) {
    const card = byId.get(id);
    if (!card) continue;
    ordered.push(card);
    byId.delete(id);
  }
  for (const card of cards) {
    if (byId.has(card.event.id)) ordered.push(card);
  }
  return ordered;
};
