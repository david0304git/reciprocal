import React, { useMemo } from "react";
import { Award, ChartColumn, Flame, ListChecks, Target, TrendingUp } from "lucide-react";
import { useApp } from "../lib/store";
import { addDaysISO, formatShort, hexAlpha, todayISO } from "../lib/date";
import { buildLogIndex, habitStats } from "../lib/stats";
import { EmptyState } from "../components/ui";
import { startOfWeek, parseISO, addDays } from "date-fns";

export const StatsView: React.FC = () => {
  const { data, settings } = useApp();
  const today = todayISO();
  const weekStart = settings.weekStart;
  const monthPrefix = today.slice(0, 7);
  const logs = data?.logs ?? [];
  const tasks = data?.tasks ?? [];
  const habits = useMemo(
    () => (data?.habits ?? []).filter((habit) => !habit.archived),
    [data?.habits],
  );
  const index = useMemo(() => buildLogIndex(logs), [logs]);

  const habitStatsList = useMemo(
    () => habits.map((habit) => ({ habit, stats: habitStats(habit, index, today, weekStart) })),
    [habits, index, today, weekStart],
  );

  const totalLogs = logs.length;
  const firstLog = logs.length > 0 ? logs.reduce((min, log) => (log.date < min ? log.date : min), logs[0].date) : null;
  const monthCheckins = logs.filter((log) => log.date.startsWith(monthPrefix)).length;
  const bestStreak = habitStatsList.reduce((max, item) => Math.max(max, item.stats.currentStreak), 0);
  const avgRate =
    habitStatsList.length === 0
      ? 0
      : habitStatsList.reduce((sum, item) => sum + item.stats.rate30, 0) / habitStatsList.length;
  const monthTasksDone = tasks.filter(
    (task) => task.completedAt && task.completedAt.slice(0, 7) === monthPrefix,
  ).length;

  const dailySeries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of logs) counts.set(log.date, (counts.get(log.date) ?? 0) + 1);
    return Array.from({ length: 30 }, (_, offsetValue) => {
      const date = addDaysISO(today, offsetValue - 29);
      return { date, count: counts.get(date) ?? 0 };
    });
  }, [logs, today]);
  const maxDaily = Math.max(1, ...dailySeries.map((entry) => entry.count));

  const weeklySeries = useMemo(() => {
    const currentWeek = startOfWeek(parseISO(today), { weekStartsOn: weekStart });
    return Array.from({ length: 8 }, (_, offsetValue) => {
      const start = addDays(currentWeek, -(7 - offsetValue) * 7);
      const end = addDays(start, 6);
      const startKey = `${start.getFullYear()}-${`${start.getMonth() + 1}`.padStart(2, "0")}-${`${start.getDate()}`.padStart(2, "0")}`;
      const endKey = `${end.getFullYear()}-${`${end.getMonth() + 1}`.padStart(2, "0")}-${`${end.getDate()}`.padStart(2, "0")}`;
      const count = tasks.filter((task) => {
        if (!task.completedAt) return false;
        const completed = task.completedAt.slice(0, 10);
        return completed >= startKey && completed <= endKey;
      }).length;
      return { start, end, count };
    });
  }, [tasks, today, weekStart]);
  const maxWeekly = Math.max(1, ...weeklySeries.map((entry) => entry.count));

  const sortedHabits = [...habitStatsList].sort((a, b) => b.stats.rate30 - a.stats.rate30);
  const strongest = sortedHabits[0];
  const weakest = sortedHabits[sortedHabits.length - 1];

  if (habits.length === 0 && tasks.length === 0) {
    return (
      <div className="page">
        <header className="page__header">
          <div className="page__heading">
            <p className="page__eyebrow">統計</p>
            <h1 className="page__title">看見累積的力量</h1>
            <p className="page__subtitle">開始記錄之後，這裡會慢慢長出你的節奏。</p>
          </div>
        </header>
        <EmptyState
          icon={<ChartColumn size={22} />}
          title="還沒有可以統計的資料"
          text="先建立一個習慣或一項事務，累積幾天之後再回來看看。"
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">統計</p>
          <h1 className="page__title">看見累積的力量</h1>
          <p className="page__subtitle">
            {firstLog ? `從 ${formatShort(firstLog)} 開始 · ` : ""}累積 {totalLogs} 次打卡 ·{" "}
            {monthTasksDone} 項事務完成於本月
          </p>
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-card__icon">
            <Target size={16} />
          </span>
          <span className="stat-card__value">{monthCheckins}</span>
          <span className="stat-card__label">本月打卡次數</span>
          <span className="stat-card__hint">所有習慣加總</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__icon">
            <Flame size={16} />
          </span>
          <span className="stat-card__value">{bestStreak}</span>
          <span className="stat-card__label">目前最長連續</span>
          <span className="stat-card__hint">以「天」計的習慣</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__icon">
            <TrendingUp size={16} />
          </span>
          <span className="stat-card__value">{Math.round(avgRate * 100)}%</span>
          <span className="stat-card__label">近 30 天平均達成率</span>
          <span className="stat-card__hint">所有進行中的習慣</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__icon">
            <ListChecks size={16} />
          </span>
          <span className="stat-card__value">{monthTasksDone}</span>
          <span className="stat-card__label">本月完成事務</span>
          <span className="stat-card__hint">已標記為完成</span>
        </div>
      </div>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">近 30 天打卡趨勢</h2>
            <p className="card__subtitle">每天完成的習慣次數，長條越高代表那天越努力</p>
          </div>
          <span className="badge">
            <Award size={12} /> 高峰 {maxDaily}
          </span>
        </div>
        <div className="bars">
          {dailySeries.map((entry, indexValue) => (
            <div className="bars__col" key={entry.date}>
              <div className="bars__track">
                <div
                  className={`bars__bar ${entry.count === 0 ? "bars__bar--empty" : ""}`}
                  style={{ height: `${Math.max(entry.count === 0 ? 2 : 6, (entry.count / maxDaily) * 100)}%` }}
                  title={`${entry.date}：${entry.count} 次`}
                />
              </div>
              <span className="bars__label">
                {indexValue % 5 === 0 ? formatShort(entry.date) : ""}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="stats-grid">
        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">近 8 週完成事務</h2>
              <p className="card__subtitle">每週實際完成的事務數量</p>
            </div>
          </div>
          <div className="bars bars--week">
            {weeklySeries.map((entry) => (
              <div className="bars__col" key={entry.start.toISOString()}>
                <div className="bars__track">
                  <div
                    className={`bars__bar bars__bar--task ${entry.count === 0 ? "bars__bar--empty" : ""}`}
                    style={{ height: `${Math.max(entry.count === 0 ? 2 : 8, (entry.count / maxWeekly) * 100)}%` }}
                    title={`${formatShort(`${entry.start.getFullYear()}-${`${entry.start.getMonth() + 1}`.padStart(2, "0")}-${`${entry.start.getDate()}`.padStart(2, "0")}`)} 起：${entry.count} 項`}
                  />
                </div>
                <span className="bars__label">
                  {formatShort(
                    `${entry.start.getFullYear()}-${`${entry.start.getMonth() + 1}`.padStart(2, "0")}-${`${entry.start.getDate()}`.padStart(2, "0")}`,
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card card--insight">
          <div className="card__head">
            <div>
              <h2 className="card__title">一點觀察</h2>
              <p className="card__subtitle">從你的紀錄裡讀出來的</p>
            </div>
          </div>
          <div className="insight-list">
            {strongest ? (
              <div className="insight">
                <span className="insight__emoji" style={{ background: hexAlpha(strongest.habit.color, 0.15) }}>
                  {strongest.habit.emoji}
                </span>
                <p>
                  <strong>{strongest.habit.name}</strong> 是目前最穩定的習慣，30 天達成率{" "}
                  {Math.round(strongest.stats.rate30 * 100)}%。
                </p>
              </div>
            ) : null}
            {weakest && strongest && weakest.habit.id !== strongest.habit.id ? (
              <div className="insight">
                <span className="insight__emoji" style={{ background: hexAlpha(weakest.habit.color, 0.15) }}>
                  {weakest.habit.emoji}
                </span>
                <p>
                  <strong>{weakest.habit.name}</strong> 最近比較容易中斷（達成率{" "}
                  {Math.round(weakest.stats.rate30 * 100)}%），要不要把它縮小一點？
                </p>
              </div>
            ) : null}
            <div className="insight">
              <span className="insight__emoji">
                <Flame size={16} />
              </span>
              <p>
                連續紀錄最長的是{" "}
                <strong>
                  {
                    [...habitStatsList].sort((a, b) => b.stats.longestStreak - a.stats.longestStreak)[0]
                      ?.habit.name
                  }
                </strong>
                ，
                {
                  [...habitStatsList].sort((a, b) => b.stats.longestStreak - a.stats.longestStreak)[0]
                    ?.stats.longestStreak
                }
                天。
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">習慣一致性</h2>
            <p className="card__subtitle">近 30 天的達成率與累積次數</p>
          </div>
        </div>
        <div className="table">
          <div className="table__row table__row--head">
            <span>習慣</span>
            <span>30 天達成率</span>
            <span>目前連續</span>
            <span>累積</span>
          </div>
          {habitStatsList.map(({ habit, stats }) => (
            <div className="table__row" key={habit.id}>
              <span className="table__habit">
                <span
                  className="table__emoji"
                  style={{ background: hexAlpha(habit.color, 0.14), color: habit.color }}
                >
                  {habit.emoji}
                </span>
                {habit.name}
              </span>
              <span className="table__rate">
                <span className="progress">
                  <span
                    className="progress__fill"
                    style={{ width: `${Math.round(stats.rate30 * 100)}%`, background: habit.color }}
                  />
                </span>
                <span className="table__pct">{Math.round(stats.rate30 * 100)}%</span>
              </span>
              <span>
                {stats.currentStreak}
                {stats.streakUnit}
              </span>
              <span>{stats.total} 次</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
