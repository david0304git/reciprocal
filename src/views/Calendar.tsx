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
import { EmptyState, Modal } from "../components/ui";
import { EventForm } from "../components/EventForm";

const WEEKDAY_LABELS_SUN = ["日", "一", "二", "三", "四", "五", "六"];
const startOfDay = (isoDate: string): number => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
};

export const CalendarView: React.FC = () => {
  const { data, settings } = useApp();
  const today = todayISO();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dayDialogOpen, setDayDialogOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);


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
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
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
            {monthEvents.length} 個行程 · 左側顯示下一個行程的倒數
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
                      setDayDialogOpen(true);
                      if (!isSameMonth(date, month)) setMonth(startOfMonth(date));
                    }}
                    aria-label={`${formatShort(key)}，${events.length} 個行程`}
                  >
                    <span className="day__top">
                      <span className="day__number">{date.getDate()}</span>
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
                  </button>
                );
              })}
            </div>
            <div className="calendar__legend">
              <span className="calendar__legend-tip">點選日期顯示與編輯行程</span>
            </div>
          </section>

        </div>
      </div>

      <Modal
        open={dayDialogOpen}
        onClose={() => setDayDialogOpen(false)}
        title={formatShort(selectedDate)}
        subtitle={`${formatFullWeekday(selectedDate)} · ${selectedEvents.length} 個行程`}
        width={560}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDayDialogOpen(false)}
            >
              關閉
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setDayDialogOpen(false);
                openNewEvent();
              }}
            >
              <Plus size={14} /> 新增行程
            </button>
          </>
        }
      >
        <div className="day-dialog">
          {selectedEvents.length === 0 ? (
            <p className="muted-inline">這天還沒有行程。</p>
          ) : (
            <ul className="event-list">
              {selectedEvents.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    className="event-row"
                    onClick={() => {
                      setDayDialogOpen(false);
                      openNewEvent(event);
                    }}
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
          <p className="form-hint">點擊行程即可編輯或刪除；也可以新增行程。</p>
        </div>
      </Modal>

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
