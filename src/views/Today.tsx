import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarPlus,
  Check,
  Flame,
  ListChecks,
  Plus,
  Sprout,
} from "lucide-react";
import { useApp } from "../lib/store";
import {
  buildLogIndex,
  habitStats,
  isScheduledOn,
  logKey,
  scheduleLabel,
  timeOfDayLabel,
} from "../lib/stats";
import {
  dueLabel,
  formatLong,
  greeting,
  hexAlpha,
  startOfWeekISO,
  todayISO,
  addDaysISO,
} from "../lib/date";
import { CheckCircle, EmptyState, ProgressRing } from "../components/ui";
import { TaskForm } from "../components/TaskForm";
import { EventForm } from "../components/EventForm";
import type { EventItem, Task } from "../lib/types";

export const TodayView: React.FC = () => {
  const { data, actions, setView, settings, notify } = useApp();
  const [quickTitle, setQuickTitle] = useState("");
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);

  const today = todayISO();
  const hourGreeting = greeting();

  const habits = useMemo(
    () => (data?.habits ?? []).filter((habit) => !habit.archived),
    [data?.habits],
  );
  const index = useMemo(() => buildLogIndex(data?.logs ?? []), [data?.logs]);

  const scheduled = habits.filter((habit) => isScheduledOn(habit, today, settings.weekStart));
  const doneToday = scheduled.filter((habit) => index.has(logKey(habit.id, today)));
  const ratio = scheduled.length === 0 ? 0 : doneToday.length / scheduled.length;

  const logStreak = useMemo(() => {
    const loggedDays = new Set((data?.logs ?? []).map((log) => log.date));
    let cursor = new Date();
    let streak = 0;
    // Today counts only once something is logged; otherwise start from yesterday.
    if (!loggedDays.has(today)) cursor.setDate(cursor.getDate() - 1);
    for (let guard = 0; guard < 400; guard += 1) {
      const year = cursor.getFullYear();
      const month = `${cursor.getMonth() + 1}`.padStart(2, "0");
      const day = `${cursor.getDate()}`.padStart(2, "0");
      const key = `${year}-${month}-${day}`;
      if (!loggedDays.has(key)) break;
      streak += 1;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    return streak;
  }, [data?.logs, today]);

  const todayTaskList = useMemo(() => {
    const tasks = data?.tasks ?? [];
    return tasks
      .filter((task) => task.status !== "done" && task.dueDate && task.dueDate <= today)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  }, [data?.tasks, today]);

  const weekDone = useMemo(() => {
    const logs = data?.logs ?? [];
    const start = new Date();
    const day = start.getDay() === 0 ? 6 : start.getDay() - 1;
    start.setDate(start.getDate() - day);
    const startKey = `${start.getFullYear()}-${`${start.getMonth() + 1}`.padStart(2, "0")}-${`${start.getDate()}`.padStart(2, "0")}`;
    return logs.filter((log) => log.date >= startKey && log.date <= today).length;
  }, [data?.logs, today]);

  const todayWeekday = new Date().getDay() === 0 ? 7 : new Date().getDay();

  interface TimelineItem {
    key: string;
    kind: "block" | "event";
    title: string;
    start: string | null;
    end: string | null;
    color: string;
    meta: string;
    allDay: boolean;
    sortKey: number;
    event?: EventItem;
  }

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    for (const block of data?.timetable ?? []) {
      if (block.day !== todayWeekday) continue;
      const [hour, minute] = block.startTime.split(":").map(Number);
      items.push({
        key: `block-${block.id}`,
        kind: "block",
        title: block.title,
        start: block.startTime,
        end: block.endTime,
        color: block.color,
        meta: "固定安排",
        allDay: false,
        sortKey: hour * 60 + minute,
      });
    }
    for (const event of data?.events ?? []) {
      if (event.date !== today) continue;
      if (event.allDay || !event.startTime) {
        items.push({
          key: `event-${event.id}`,
          kind: "event",
          title: event.title,
          start: null,
          end: null,
          color: event.color,
          meta: event.location || event.category,
          allDay: true,
          sortKey: -1,
          event,
        });
      } else {
        const [hour, minute] = event.startTime.split(":").map(Number);
        items.push({
          key: `event-${event.id}`,
          kind: "event",
          title: event.title,
          start: event.startTime,
          end: event.endTime,
          color: event.color,
          meta: event.location || event.category,
          allDay: false,
          sortKey: hour * 60 + minute,
          event,
        });
      }
    }
    return items.sort((a, b) => a.sortKey - b.sortKey);
  }, [data?.timetable, data?.events, today, todayWeekday]);

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const nextItem =
    timeline.find((item) => !item.allDay && item.sortKey >= nowMinutes) ?? timeline[0] ?? null;
  const nextInMinutes =
    nextItem && !nextItem.allDay && nextItem.start
      ? nextItem.sortKey - nowMinutes
      : null;
  const nextLabel =
    nextInMinutes === null || nextInMinutes <= 0
      ? nextInMinutes !== null && nextInMinutes <= 0
        ? "進行中"
        : null
      : nextInMinutes < 60
        ? `${nextInMinutes} 分鐘後`
        : nextInMinutes % 60 === 0
          ? `${nextInMinutes / 60} 小時後`
          : `${Math.floor(nextInMinutes / 60)} 小時 ${nextInMinutes % 60} 分後`;

  const activeTaskCount = (data?.tasks ?? []).filter((task) => task.status !== "done").length;

  const weekDays = useMemo(() => {
    const start = startOfWeekISO(today, settings.weekStart);
    const labels =
      settings.weekStart === 1
        ? ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]
        : ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    return labels.map((label, offsetValue) => {
      const date = addDaysISO(start, offsetValue);
      const scheduledHere = habits.filter((habit) =>
        isScheduledOn(habit, date, settings.weekStart),
      );
      const done = scheduledHere.filter((habit) => index.has(logKey(habit.id, date))).length;
      return {
        date,
        label,
        done,
        total: scheduledHere.length,
        ratio: scheduledHere.length === 0 ? 0 : done / scheduledHere.length,
        isToday: date === today,
        isFuture: date > today,
      };
    });
  }, [today, settings.weekStart, habits, index]);

  const openNewTask = () => {
    setEditingTask(null);
    setTaskFormOpen(true);
  };

  const openNewEvent = () => {
    setEditingEvent(null);
    setEventFormOpen(true);
  };

  const submitQuick = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quickTitle.trim()) return;
    const created = await actions.saveTask({ title: quickTitle, dueDate: today, status: "todo" });
    if (created) {
      setQuickTitle("");
      notify("已加入今日事務", "ok");
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">{formatLong(today)}</p>
          <h1 className="page__title">{hourGreeting.title}</h1>
          <p className="page__subtitle">{hourGreeting.hint}</p>
        </div>
        <div className="page__actions">
          <button type="button" className="btn btn--ghost" onClick={openNewEvent}>
            <CalendarPlus size={15} /> 新增行程
          </button>
          <button type="button" className="btn btn--primary" onClick={openNewTask}>
            <Plus size={15} /> 新增事務
          </button>
        </div>
      </header>

      <div className="today-grid">
      <div className="today-main">
          <section className="card card--habits">
            <div className="card__head">
              <div>
                <h2 className="card__title">今日習慣</h2>
                <p className="card__subtitle">
                  {scheduled.length === 0
                    ? "今天沒有排定的習慣"
                    : `已完成 ${doneToday.length} / ${scheduled.length}，${ratio === 1 ? "今天全部達成了 🎉" : "一項一項來就好"}`}
                </p>
              </div>
              <ProgressRing value={ratio} size={72} stroke={7}>
                <span className="ring__value">{Math.round(ratio * 100)}%</span>
                <span className="ring__caption">今日</span>
              </ProgressRing>
            </div>

            {scheduled.length === 0 ? (
              <EmptyState
                icon={<Sprout size={22} />}
                title="還沒有今天的習慣"
                text="建立一個每天都能做到的小習慣，從今天開始累積。"
                action={
                  <button type="button" className="btn btn--soft" onClick={() => setView("habits")}>
                    建立習慣 <ArrowRight size={14} />
                  </button>
                }
              />
            ) : (
              <div className="habit-list">
                {scheduled.map((habit) => {
                  const done = index.has(logKey(habit.id, today));
                  const stats = habitStats(habit, index, today, settings.weekStart);
                  return (
                    <div
                      key={habit.id}
                      className={`habit-row ${done ? "habit-row--done" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void actions.toggleHabitLog(habit.id, today, !done)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void actions.toggleHabitLog(habit.id, today, !done);
                        }
                      }}
                    >
                      <CheckCircle
                        checked={done}
                        color={habit.color}
                        label={done ? `取消 ${habit.name} 打卡` : `完成 ${habit.name}`}
                        onClick={() => void actions.toggleHabitLog(habit.id, today, !done)}
                      />
                      <span
                        className="habit-row__emoji"
                        style={{ background: hexAlpha(habit.color, 0.14), color: habit.color }}
                      >
                        {habit.emoji}
                      </span>
                      <span className="habit-row__body">
                        <span className="habit-row__name">{habit.name}</span>
                        <span className="habit-row__meta">
                          {scheduleLabel(habit)}
                          {habit.timeOfDay !== "anytime" ? ` · ${timeOfDayLabel[habit.timeOfDay]}` : ""}
                          {habit.schedule === "times_per_week"
                            ? ` · 本週 ${stats.weekDone}/${habit.weeklyTarget}`
                            : ""}
                        </span>
                      </span>
                      <span className="habit-row__streak">
                        {stats.currentStreak > 0 ? (
                          <>
                            <Flame size={12} /> {stats.currentStreak}
                            {stats.streakUnit}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="card week-card">
            <div className="card__head">
              <div>
                <h2 className="card__title">本週節奏</h2>
                <p className="card__subtitle">每天完成的習慣，讓一週的形狀看得見</p>
              </div>
              <span className="badge">
                <Check size={12} /> 本週 {weekDone} 次
              </span>
            </div>
            <div className="week-rows">
              {weekDays.map((day) => (
                <div
                  key={day.date}
                  className={`week-row ${day.isToday ? "week-row--today" : ""} ${day.isFuture ? "week-row--future" : ""}`}
                  title={`${day.label} · ${day.done}/${day.total}`}
                >
                  <span className="week-row__label">{day.label}</span>
                  <div className="week-row__track">
                    <div
                      className="week-row__fill"
                      style={{ width: `${Math.round(day.ratio * 100)}%` }}
                    />
                  </div>
                  <span className="week-row__count">
                    {day.total === 0 ? "—" : `${day.done}/${day.total}`}
                  </span>
                </div>
              ))}
            </div>
          </section>
      </div>

        <div className="today-side">
          <section className="card">
            <div className="card__head card__head--tight">
              <div>
                <h2 className="card__title">今日事務</h2>
                <p className="card__subtitle">
                  {todayTaskList.length > 0
                    ? `${todayTaskList.length} 項待處理`
                    : "今天沒有到期的事務"}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setView("tasks")}
                aria-label="前往事務頁"
              >
                <ArrowRight size={15} />
              </button>
            </div>

            <form className="quick-add" onSubmit={submitQuick}>
              <Plus size={15} />
              <input
                value={quickTitle}
                onChange={(event) => setQuickTitle(event.target.value)}
                placeholder="快速新增今日事務…"
                aria-label="快速新增今日事務"
              />
              {quickTitle.trim() ? (
                <button type="submit" className="mini-btn mini-btn--accent">
                  加入
                </button>
              ) : null}
            </form>

            {todayTaskList.length === 0 ? (
              <p className="muted-inline">沒有待辦，享受一點空白。</p>
            ) : (
              <ul className="mini-list">
                {todayTaskList.slice(0, 6).map((task) => (
                  <li key={task.id} className="mini-row">
                    <button
                      type="button"
                      className="mini-check"
                      onClick={() => void actions.setTaskStatus(task.id, "done")}
                      aria-label={`完成 ${task.title}`}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      className="mini-row__text"
                      onClick={() => {
                        setEditingTask(task);
                        setTaskFormOpen(true);
                      }}
                    >
                      {task.title}
                    </button>
                    <span
                      className={`mini-due ${task.dueDate && task.dueDate < today ? "mini-due--late" : ""}`}
                    >
                      {task.dueDate ? dueLabel(task.dueDate) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card__head card__head--tight">
              <div>
                <h2 className="card__title">今天的安排</h2>
                <p className="card__subtitle">
                  {timeline.length === 0
                    ? "今天沒有安排，留給自己。"
                    : `${timeline.length} 項 · 下一個 ${nextItem?.allDay ? "全天" : nextItem?.start} ${nextItem?.title ?? ""}${nextLabel ? `（${nextLabel}）` : ""}`}
                </p>
              </div>
              <button type="button" className="icon-btn" onClick={openNewEvent} aria-label="新增行程">
                <Plus size={15} />
              </button>
            </div>
            {timeline.length === 0 ? (
              <p className="muted-inline">今天沒有排定的行程或固定安排。</p>
            ) : (
              <ul className="timeline">
                {timeline.map((item) => (
                  <li key={item.key} className="timeline__row">
                    <button
                      type="button"
                      className="timeline__btn"
                      onClick={() => {
                        if (item.kind === "event" && item.event) {
                          setEditingEvent(item.event);
                          setEventFormOpen(true);
                        } else {
                          setView("tasks");
                        }
                      }}
                    >
                      <span className="timeline__time">{item.allDay ? "全天" : item.start}</span>
                      <span className="timeline__bar" style={{ background: item.color }} />
                      <span className="timeline__body">
                        <span className="timeline__title">{item.title}</span>
                        <span className="timeline__meta">
                          {item.kind === "block"
                            ? `固定安排${item.end ? ` · ${item.start}–${item.end}` : ""}`
                            : item.meta}
                        </span>
                      </span>
                      <span
                        className={`chip chip--tiny ${
                          item.kind === "event" && item.event?.source === "apple"
                            ? "chip--apple"
                            : ""
                        }`}
                      >
                        {item.kind === "block"
                          ? "固定"
                          : item.event?.source === "apple"
                            ? "Apple"
                            : "行程"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card card--stats">
            <div className="mini-stat-grid">
              <div className="mini-stat">
                <span className="mini-stat__value">
                  <Flame size={16} /> {logStreak}
                </span>
                <span className="mini-stat__label">連續紀錄天數</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat__value">
                  <Check size={16} /> {weekDone}
                </span>
                <span className="mini-stat__label">本週完成次數</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat__value">
                  <ListChecks size={16} /> {activeTaskCount}
                </span>
                <span className="mini-stat__label">待辦事務</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <TaskForm
        open={taskFormOpen}
        task={editingTask}
        onClose={() => {
          setTaskFormOpen(false);
          setEditingTask(null);
        }}
      />
      <EventForm
        open={eventFormOpen}
        event={editingEvent}
        defaultDate={today}
        onClose={() => {
          setEventFormOpen(false);
          setEditingEvent(null);
        }}
      />
    </div>
  );
};
