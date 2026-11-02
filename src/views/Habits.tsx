import React, { useMemo, useState } from "react";
import { Archive, ArrowUpRight, Flame, Pencil, Plus, Sprout, Trash, Undo2 } from "lucide-react";
import { useApp } from "../lib/store";
import type { Habit } from "../lib/types";
import {
  buildLogIndex,
  habitStats,
  isScheduledOn,
  logKey,
  scheduleLabel,
  timeOfDayLabel,
} from "../lib/stats";
import {
  addDaysISO,
  formatLong,
  formatShort,
  hexAlpha,
  startOfWeekISO,
  todayISO,
} from "../lib/date";
import { CheckCircle, ConfirmDialog, EmptyState, Heatmap, Modal, Segmented } from "../components/ui";
import { HabitForm } from "../components/HabitForm";

export const HabitsView: React.FC = () => {
  const { data, actions, settings, setView } = useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Habit | null>(null);
  const [filter, setFilter] = useState<"active" | "archived">("active");

  const habits = data?.habits ?? [];
  const activeHabits = habits.filter((habit) => !habit.archived);
  const archivedHabits = habits.filter((habit) => habit.archived);
  const visible = filter === "active" ? activeHabits : archivedHabits;
  const index = useMemo(() => buildLogIndex(data?.logs ?? []), [data?.logs]);
  const today = todayISO();

  const selected = habits.find((habit) => habit.id === selectedId) ?? null;
  const selectedStats = selected ? habitStats(selected, index, today, settings.weekStart) : null;

  const totalCheckins = data?.logs.length ?? 0;

  const traceWeeks = useMemo(() => {
    const firstWeekStart = addDaysISO(
      startOfWeekISO(today, settings.weekStart),
      -51 * 7,
    );
    return Array.from({ length: 52 }, (_, weekIndex) =>
      Array.from({ length: 7 }, (_, dayIndex) =>
        addDaysISO(firstWeekStart, weekIndex * 7 + dayIndex),
      ),
    );
  }, [today, settings.weekStart]);

  const traceLevel = (date: string): number => {
    if (date > today) return 0;
    const scheduledHere = activeHabits.filter((habit) =>
      isScheduledOn(habit, date, settings.weekStart),
    );
    if (scheduledHere.length === 0) return 0;
    const done = scheduledHere.filter((habit) => index.has(logKey(habit.id, date))).length;
    if (done === 0) return 0;
    const ratio = done / scheduledHere.length;
    if (ratio >= 1) return 4;
    if (ratio >= 0.66) return 3;
    if (ratio >= 0.33) return 2;
    return 1;
  };

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">習慣</p>
          <h1 className="page__title">每天一點，往前一點</h1>
          <p className="page__subtitle">
            {activeHabits.length} 個進行中的習慣 · 共累積 {totalCheckins} 次打卡紀錄
          </p>
        </div>
        <div className="page__actions">
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "active", label: `進行中 ${activeHabits.length}` },
              { value: "archived", label: `已封存 ${archivedHabits.length}` },
            ]}
          />
          <button type="button" className="btn btn--primary" onClick={openNew}>
            <Plus size={15} /> 新增習慣
          </button>
        </div>
      </header>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Sprout size={24} />}
          title={filter === "active" ? "還沒有習慣" : "沒有封存的習慣"}
          text={
            filter === "active"
              ? "從一件小到不會失敗的事開始。每天打一個勾，就是在告訴自己：我說到做到。"
              : "暫時停下來的習慣會放在這裡，隨時可以恢復。"
          }
          action={
            filter === "active" ? (
              <button type="button" className="btn btn--primary" onClick={openNew}>
                <Plus size={15} /> 建立第一個習慣
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="habit-grid">
          {visible.map((habit) => {
            const stats = habitStats(habit, index, today, settings.weekStart);
            const todayDone = index.has(logKey(habit.id, today));
            const dotDates = Array.from({ length: 14 }, (_, offsetValue) =>
              addDaysISO(today, offsetValue - 13),
            );
            return (
              <div
                key={habit.id}
                className={`habit-card ${habit.archived ? "habit-card--archived" : ""}`}
                onClick={() => setSelectedId(habit.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setSelectedId(habit.id);
                }}
              >
                <div className="habit-card__top">
                  <span
                    className="habit-card__emoji"
                    style={{ background: hexAlpha(habit.color, 0.15), color: habit.color }}
                  >
                    {habit.emoji}
                  </span>
                  <div className="habit-card__titles">
                    <h3 className="habit-card__name">{habit.name}</h3>
                    <p className="habit-card__meta">
                      {scheduleLabel(habit)} · {timeOfDayLabel[habit.timeOfDay]}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="habit-card__delete"
                    aria-label={`刪除 ${habit.name}`}
                    title="刪除習慣"
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirmDelete(habit);
                    }}
                  >
                    <Trash size={13} />
                  </button>
                  <span onClick={(event) => event.stopPropagation()}>
                    <CheckCircle
                      checked={todayDone}
                      color={habit.color}
                      size={28}
                      label={todayDone ? "取消今日打卡" : "完成今日打卡"}
                      onClick={() => void actions.toggleHabitLog(habit.id, today, !todayDone)}
                    />
                  </span>
                </div>

                <div className="habit-card__stats">
                  <div className="stat">
                    <span className="stat__value">
                      {stats.currentStreak}
                      <small>{stats.streakUnit}</small>
                    </span>
                    <span className="stat__label">目前連續</span>
                  </div>
                  <div className="stat">
                    <span className="stat__value">{Math.round(stats.rate30 * 100)}%</span>
                    <span className="stat__label">30 天達成</span>
                  </div>
                  <div className="stat">
                    <span className="stat__value">{stats.total}</span>
                    <span className="stat__label">累積次數</span>
                  </div>
                </div>

                <div className="dot-strip" aria-hidden="true">
                  {dotDates.map((date) => {
                    const done = index.has(logKey(habit.id, date));
                    const expected = isScheduledOn(habit, date, settings.weekStart);
                    return (
                      <span
                        key={date}
                        className={`dot ${done ? "dot--on" : expected ? "dot--expected" : ""}`}
                        style={done ? { background: habit.color } : undefined}
                        title={date}
                      />
                    );
                  })}
                </div>

                <div className="habit-card__footer">
                  <span className="habit-card__hint">
                    {habit.schedule === "times_per_week"
                      ? `本週 ${stats.weekDone}/${habit.weeklyTarget}`
                      : stats.todayDone
                        ? "今天已完成"
                        : stats.currentStreak > 0
                          ? "別讓連續紀錄中斷"
                          : "今天開始"}
                  </span>
                  <ArrowUpRight size={14} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeHabits.length > 0 ? (
        <section className="card trace-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">過去一年</h2>
              <p className="card__subtitle">
                每一格是一天，顏色越深代表當天完成的習慣越多
              </p>
            </div>
            <div className="trace-legend">
              <span>少</span>
              <i className="trace-cell trace-cell--0" />
              <i className="trace-cell trace-cell--1" />
              <i className="trace-cell trace-cell--2" />
              <i className="trace-cell trace-cell--3" />
              <i className="trace-cell trace-cell--4" />
              <span>多</span>
            </div>
          </div>
          <div className="trace">
            {traceWeeks.map((week, weekIndex) => (
              <div className="trace__col" key={week[0] ?? weekIndex}>
                {week.map((date) => (
                  <span
                    key={date}
                    className={`trace-cell trace-cell--${traceLevel(date)}`}
                    title={`${formatShort(date)}${date > today ? "" : ` · ${traceLevel(date) > 0 ? "有紀錄" : "未記錄"}`}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected ? selected.name : ""}
        subtitle={selected ? `${scheduleLabel(selected)} · ${timeOfDayLabel[selected.timeOfDay]}` : undefined}
        width={620}
        footer={
          selected ? (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--danger-text"
                onClick={() => setConfirmDelete(selected)}
              >
                <Trash size={14} /> 刪除
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void actions.archiveHabit(selected.id, !selected.archived)}
              >
                {selected.archived ? <Undo2 size={14} /> : <Archive size={14} />}
                {selected.archived ? "恢復習慣" : "封存習慣"}
              </button>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setEditing(selected);
                  setFormOpen(true);
                }}
              >
                <Pencil size={14} /> 編輯
              </button>
            </>
          ) : null
        }
      >
        {selected && selectedStats ? (
          <div className="habit-detail">
            <div className="habit-detail__hero">
              <span
                className="habit-detail__emoji"
                style={{ background: hexAlpha(selected.color, 0.16), color: selected.color }}
              >
                {selected.emoji}
              </span>
              <div className="habit-detail__hero-text">
                <p className="habit-detail__label">目前連續</p>
                <p className="habit-detail__streak">
                  <Flame size={18} style={{ color: selected.color }} />
                  {selectedStats.currentStreak}
                  <span>{selectedStats.streakUnit}</span>
                </p>
                <p className="habit-detail__hint">
                  最長 {selectedStats.longestStreak}
                  {selectedStats.streakUnit} · 30 天達成{" "}
                  {Math.round(selectedStats.rate30 * 100)}%
                </p>
              </div>
              <CheckCircle
                checked={selectedStats.todayDone}
                color={selected.color}
                size={34}
                label="今日打卡"
                onClick={() =>
                  void actions.toggleHabitLog(selected.id, today, !selectedStats.todayDone)
                }
              />
            </div>

            <div className="habit-detail__times">
              <span>
                <strong>{selectedStats.total}</strong> 次累積
              </span>
              <span>
                <strong>{selectedStats.weekDone}</strong> / {selectedStats.weekTarget} 本週
              </span>
              <span>建立於 {formatLong(selected.createdAt.slice(0, 10))}</span>
            </div>

            <div className="habit-detail__heatmap">
              <div className="habit-detail__section-title">最近 24 週</div>
              <Heatmap
                habit={selected}
                index={index}
                weeks={24}
                weekStart={settings.weekStart}
                onSelect={(date) => {
                  if (date <= today) {
                    void actions.toggleHabitLog(
                      selected.id,
                      date,
                      !index.has(logKey(selected.id, date)),
                    );
                  }
                }}
              />
            </div>

            {selected.notes ? (
              <div className="habit-detail__notes">
                <div className="habit-detail__section-title">備註</div>
                <p>{selected.notes}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <HabitForm
        open={formOpen}
        habit={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="刪除這個習慣？"
        message={`「${confirmDelete?.name ?? ""}」的所有打卡紀錄也會一併刪除，這個動作無法復原。`}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) {
            await actions.deleteHabit(confirmDelete.id);
            setConfirmDelete(null);
            setSelectedId(null);
          }
        }}
      />

      {activeHabits.length === 0 && filter === "archived" ? (
        <button type="button" className="link-btn" onClick={() => setView("today")}>
          回到今日
        </button>
      ) : null}
    </div>
  );
};
