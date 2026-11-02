import React, { useEffect, useMemo, useState } from "react";
import { addMonths, isSameMonth, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Clock, MapPin, Plus, Timer } from "lucide-react";
import { useApp } from "../lib/store";
import type { EventItem } from "../lib/types";
import {
  formatFullWeekday,
  formatMonthTitle,
  formatShort,
  hexAlpha,
  iso,
  monthGrid,
  todayISO,
  WEEKDAY_LABELS_MON,
} from "../lib/date";
import { buildLogIndex, isScheduledOn, logKey } from "../lib/stats";
import { CheckCircle, EmptyState } from "../components/ui";
import { EventForm } from "../components/EventForm";

const WEEKDAY_LABELS_SUN = ["日", "一", "二", "三", "四", "五", "六"];
const DAY_NAMES = ["", "星期一", "星期二", "星期三", "星期四", "星期五"];

const weekdayOf = (isoDate: string): number => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return weekday === 0 ? 7 : weekday;
};

const startOfDay = (isoDate: string): number => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
};

export const CalendarView: React.FC = () => {
  const { data, actions, settings, setView } = useApp();
  const today = todayISO();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const index = useMemo(() => buildLogIndex(data?.logs ?? []), [data?.logs]);
  const habits = useMemo(
    () => (data?.habits ?? []).filter((habit) => !habit.archived),
    [data?.habits],
  );
  const blocks = data?.timetable ?? [];

  const eventStartMs = (event: EventItem): number => {
    const time = event.allDay || !event.startTime ? "00:00" : event.startTime;
    return new Date(`${event.date}T${time}`).getTime();
  };

  const eventEndMs = (event: EventItem): number => {
    if (event.allDay || !event.startTime) return new Date(`${event.date}T23:59`).getTime();
    const end = event.endTime || event.startTime;
    const endMs = new Date(`${event.date}T${end}`).getTime();
    return endMs === eventStartMs(event) ? endMs + 60 * 60 * 1000 : endMs;
  };

  const countdownLabel = (event: EventItem): string => {
    if (event.allDay) {
      const days = Math.round((startOfDay(event.date) - startOfDay(today)) / 86_400_000);
      if (days <= 0) return "今天";
      if (days === 1) return "明天";
      return `${days} 天後`;
    }
    const diff = eventStartMs(event) - now;
    if (diff <= 0) return "進行中";
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 60) return `${minutes} 分鐘後`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小時 ${minutes % 60} 分後`;
    const days = Math.floor(hours / 24);
    return `${days} 天 ${hours % 24} 小時後`;
  };

  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const event of data?.events ?? []) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.startTime ?? "").localeCompare(b.startTime ?? "");
      });
    }
    return map;
  }, [data?.events]);

  const outstandingTasks = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of data?.tasks ?? []) {
      if (task.status !== "done" && task.dueDate) {
        map.set(task.dueDate, (map.get(task.dueDate) ?? 0) + 1);
      }
    }
    return map;
  }, [data?.tasks]);

  const cardCalendarFilter = useMemo(() => {
    const raw = data?.settings.appleCardCalendarIds;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : null;
    } catch {
      return null;
    }
  }, [data?.settings.appleCardCalendarIds]);

  const upcomingEvents = useMemo(() => {
    return (data?.events ?? [])
      .filter(
        (event) =>
          event.source !== "apple" ||
          cardCalendarFilter === null ||
          !event.externalCalendarId ||
          cardCalendarFilter.includes(event.externalCalendarId),
      )
      .filter((event) => eventEndMs(event) >= now)
      .sort((a, b) => eventStartMs(a) - eventStartMs(b));
  }, [data?.events, now, cardCalendarFilter]);

  const grid = useMemo(() => monthGrid(month, settings.weekStart), [month, settings.weekStart]);
  const weekdayLabels = settings.weekStart === 1 ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN;

  const monthEvents = (data?.events ?? []).filter((event) =>
    isSameMonth(new Date(`${event.date}T00:00:00`), month),
  );
  const monthTasks = (data?.tasks ?? []).filter(
    (task) => task.dueDate && isSameMonth(new Date(`${task.dueDate}T00:00:00`), month),
  );

  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const selectedTasks = (data?.tasks ?? [])
    .filter((task) => task.dueDate === selectedDate)
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  const selectedWeekday = weekdayOf(selectedDate);
  const selectedBlocks =
    selectedWeekday >= 1 && selectedWeekday <= 5
      ? blocks
          .filter((block) => block.day === selectedWeekday)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
      : [];
  const selectedHabits = habits.filter((habit) =>
    isScheduledOn(habit, selectedDate, settings.weekStart),
  );
  const selectedDone = selectedHabits.filter((habit) =>
    index.has(logKey(habit.id, selectedDate)),
  );

  const dayCompletion = (date: string): { done: number; total: number } => {
    const scheduledHabits = habits.filter((habit) => isScheduledOn(habit, date, settings.weekStart));
    const done = scheduledHabits.filter((habit) => index.has(logKey(habit.id, date))).length;
    return { done, total: scheduledHabits.length };
  };

  const openNewEvent = (event: EventItem | null = null) => {
    setEditingEvent(event);
    setEventFormOpen(true);
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">日曆</p>
          <h1 className="page__title">{formatMonthTitle(month)}</h1>
          <p className="page__subtitle">
            {monthEvents.length} 個行程 · {monthTasks.length} 項到期事務 · 左側顯示下一個行程的倒數
          </p>
        </div>
        <div className="page__actions">
          <div className="calendar__nav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMonth((current) => addMonths(current, -1))}
              aria-label="上個月"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={() => {
                setMonth(startOfMonth(new Date()));
                setSelectedDate(today);
              }}
            >
              今天
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMonth((current) => addMonths(current, 1))}
              aria-label="下個月"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => openNewEvent()}>
            <Plus size={15} /> 新增行程
          </button>
        </div>
      </header>

      <div className="calendar-layout">
        <aside className="countdown-panel">
          <div className="countdown-panel__head">
            <div>
              <p className="page__eyebrow">倒數</p>
              <h2 className="countdown-panel__title">接下來的行程</h2>
            </div>
            <span className="badge">
              <Timer size={12} /> {upcomingEvents.length}
            </span>
          </div>

          {upcomingEvents.length === 0 ? (
            <EmptyState
              icon={<Clock size={20} />}
              title="沒有即將到來的行程"
              text={
                cardCalendarFilter
                  ? "目前沒有符合倒數篩選的行程，可在設定調整要顯示的日曆。"
                  : "新增行程之後，這裡會顯示距離每個事件還有多久。"
              }
              action={
                <button
                  type="button"
                  className="btn btn--soft btn--sm"
                  onClick={() => openNewEvent()}
                >
                  <Plus size={13} /> 新增行程
                </button>
              }
            />
          ) : (
            <div className="countdown-list">
              {upcomingEvents.slice(0, 6).map((event) => {
                const soon = eventStartMs(event) - now < 24 * 60 * 60 * 1000;
                return (
                  <button
                    type="button"
                    key={event.id}
                    className={`countdown-card ${soon ? "countdown-card--soon" : ""}`}
                    style={{ borderLeftColor: event.color }}
                    onClick={() => openNewEvent(event)}
                  >
                    <span className="countdown-card__top">
                      <span className="countdown-card__date">
                        {formatShort(event.date)}
                        {event.allDay ? " · 全天" : ` · ${event.startTime ?? ""}`}
                      </span>
                      <span className="chip chip--tiny">{event.category}</span>
                    </span>
                    <span className="countdown-card__title">{event.title}</span>
                    <span className="countdown-card__value">{countdownLabel(event)}</span>
                    <span className="countdown-card__meta">
                      {event.location ? (
                        <>
                          <MapPin size={11} /> {event.location}
                        </>
                      ) : event.notes ? (
                        event.notes
                      ) : (
                        " "
                      )}
                    </span>
                  </button>
                );
              })}
              {upcomingEvents.length > 6 ? (
                <p className="countdown-more">還有 {upcomingEvents.length - 6} 個行程</p>
              ) : null}
            </div>
          )}
        </aside>

        <div className="calendar-main">
          <section className="card calendar">
            <div className="calendar__weekdays">
              {weekdayLabels.map((label) => (
                <span key={label} className="calendar__weekday">
                  {label}
                </span>
              ))}
            </div>
            <div className="calendar-grid">
              {grid.map((date) => {
                const key = iso(date);
                const events = eventsByDate.get(key) ?? [];
                const taskCount = outstandingTasks.get(key) ?? 0;
                const completion = dayCompletion(key);
                const classes = [
                  "day",
                  !isSameMonth(date, month) ? "day--out" : "",
                  key === today ? "day--today" : "",
                  key === selectedDate ? "day--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    type="button"
                    key={key}
                    className={classes}
                    onClick={() => {
                      setSelectedDate(key);
                      if (!isSameMonth(date, month)) setMonth(startOfMonth(date));
                    }}
                    aria-label={`${formatShort(key)}，${events.length} 個行程`}
                  >
                    <span className="day__top">
                      <span className="day__number">{date.getDate()}</span>
                      {taskCount > 0 ? (
                        <span className="day__task-dot" title={`${taskCount} 項到期事務`} />
                      ) : null}
                    </span>
                    <span className="day__events">
                      {events.slice(0, 3).map((event) => (
                        <span
                          key={event.id}
                          className="day__event"
                          style={{ background: hexAlpha(event.color, 0.16), color: event.color }}
                          title={`${event.title}${event.allDay ? "（全天）" : ` ${event.startTime ?? ""}`}`}
                        >
                          {event.allDay ? "全天" : event.startTime} {event.title}
                        </span>
                      ))}
                      {events.length > 3 ? (
                        <span className="day__more">+{events.length - 3}</span>
                      ) : null}
                    </span>
                    {isSameMonth(date, month) && key <= today && completion.total > 0 ? (
                      <span className="day__bar" aria-hidden="true">
                        <span
                          className="day__bar-fill"
                          style={{ width: `${(completion.done / completion.total) * 100}%` }}
                        />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="calendar__legend">
              <span>
                <i className="legend-dot legend-dot--event" /> 行程
              </span>
              <span>
                <i className="legend-dot legend-dot--task" /> 到期事務
              </span>
              <span>
                <i className="legend-dot legend-dot--habit" /> 習慣完成度
              </span>
              <span className="calendar__legend-tip">點選日期查看當天細節</span>
            </div>
          </section>

          <section className="card day-detail">
            <div className="day-detail__head">
              <div>
                <p className="page__eyebrow">{formatFullWeekday(selectedDate)}</p>
                <h2 className="day-detail__title">{formatShort(selectedDate)}</h2>
                <p className="day-detail__meta">
                  {selectedEvents.length} 個行程 · {selectedBlocks.length} 項固定安排 · 習慣{" "}
                  {selectedDone.length}/{selectedHabits.length}
                </p>
              </div>
              <button
                type="button"
                className="btn btn--soft btn--sm"
                onClick={() => openNewEvent()}
              >
                <Plus size={14} /> 新增行程
              </button>
            </div>

            <div className="day-detail__grid">
              <div className="panel-section">
                <div className="panel-section__head">
                  <h3>行程</h3>
                  <span className="badge">{selectedEvents.length}</span>
                </div>
                {selectedEvents.length === 0 ? (
                  <p className="muted-inline">這天還沒有安排。</p>
                ) : (
                  <ul className="event-list">
                    {selectedEvents.map((event) => (
                      <li key={event.id}>
                        <button
                          type="button"
                          className="event-row"
                          onClick={() => openNewEvent(event)}
                        >
                          <span className="event-row__bar" style={{ background: event.color }} />
                          <span className="event-row__body">
                            <span className="event-row__title" title={event.title}>
                              {event.title}
                            </span>
                            <span className="event-row__meta">
                              <Clock size={11} />
                              {event.allDay
                                ? "全天"
                                : `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ""}`}
                              {event.location ? (
                                <>
                                  <MapPin size={11} /> {event.location}
                                </>
                              ) : null}
                            </span>
                          </span>
                          <span className="chip chip--tiny">{event.category}</span>
                          {event.source === "apple" ? (
                            <span className="chip chip--tiny chip--apple">Apple</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="panel-section">
                <div className="panel-section__head">
                  <h3>固定安排</h3>
                  <span className="badge">{selectedBlocks.length}</span>
                  {selectedWeekday >= 1 && selectedWeekday <= 5 ? (
                    <span className="panel-hint">{DAY_NAMES[selectedWeekday]}</span>
                  ) : null}
                </div>
                {selectedBlocks.length === 0 ? (
                  <p className="muted-inline">
                    {selectedWeekday >= 1 && selectedWeekday <= 5
                      ? "這天沒有固定安排。"
                      : "週末沒有固定安排。"}
                  </p>
                ) : (
                  <ul className="tt-list">
                    {selectedBlocks.map((block) => (
                      <li key={block.id} className="tt-list__row">
                        <span className="tt-list__bar" style={{ background: block.color }} />
                        <span className="tt-list__time">
                          {block.startTime}–{block.endTime}
                        </span>
                        <span className="tt-list__title">{block.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="link-inline" onClick={() => setView("tasks")}>
                  在事務頁編輯固定安排
                </button>
              </div>

              <div className="panel-section">
                <div className="panel-section__head">
                  <h3>到期事務</h3>
                  <span className="badge">{selectedTasks.length}</span>
                </div>
                {selectedTasks.length === 0 ? (
                  <p className="muted-inline">沒有到期的事務。</p>
                ) : (
                  <ul className="mini-list">
                    {selectedTasks.map((task) => (
                      <li key={task.id} className="mini-row">
                        <CheckCircle
                          checked={task.status === "done"}
                          color={task.status === "done" ? "var(--accent)" : "var(--text-tertiary)"}
                          size={22}
                          label="切換完成"
                          onClick={() =>
                            void actions.setTaskStatus(
                              task.id,
                              task.status === "done" ? "todo" : "done",
                            )
                          }
                        />
                        <span
                          className={`mini-row__text ${task.status === "done" ? "is-done" : ""}`}
                        >
                          {task.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="panel-section">
                <div className="panel-section__head">
                  <h3>當天習慣</h3>
                  <span className="badge">{selectedHabits.length}</span>
                  {selectedDate > today ? (
                    <span className="panel-hint">未來的日期還不能打卡</span>
                  ) : null}
                </div>
                {selectedHabits.length === 0 ? (
                  <p className="muted-inline">這天沒有排定的習慣。</p>
                ) : (
                  <ul className="mini-list">
                    {selectedHabits.map((habit) => {
                      const done = index.has(logKey(habit.id, selectedDate));
                      return (
                        <li key={habit.id} className="mini-row">
                          <span className={selectedDate > today ? "is-disabled" : undefined}>
                            <CheckCircle
                              checked={done}
                              color={habit.color}
                              size={22}
                              label={`${habit.name} 打卡`}
                              onClick={() =>
                                void actions.toggleHabitLog(habit.id, selectedDate, !done)
                              }
                            />
                          </span>
                          <span className={`mini-row__text ${done ? "is-done" : ""}`}>
                            <span className="mini-row__emoji">{habit.emoji}</span>
                            {habit.name}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      <EventForm
        open={eventFormOpen}
        event={editingEvent}
        defaultDate={selectedDate}
        onClose={() => {
          setEventFormOpen(false);
          setEditingEvent(null);
        }}
      />
    </div>
  );
};
