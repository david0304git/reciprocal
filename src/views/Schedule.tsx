import React, { useMemo, useState } from "react";
import { CalendarDays, ListChecks } from "lucide-react";
import { useApp } from "../lib/store";
import { Segmented } from "../components/ui";
import { todayISO } from "../lib/date";
import { TimetableView } from "./Timetable";
import { TasksPanel } from "./Tasks";

type Tab = "week" | "tasks";

export const ScheduleView: React.FC = () => {
  const { data } = useApp();
  const [tab, setTab] = useState<Tab>("week");

  const blocks = data?.timetable ?? [];
  const tasks = data?.tasks ?? [];
  const today = todayISO();

  const stats = useMemo(() => {
    const active = tasks.filter((task) => task.status !== "done").length;
    const overdue = tasks.filter(
      (task) => task.status !== "done" && task.dueDate && task.dueDate < today,
    ).length;
    const weeklyHours = blocks.reduce((sum, block) => {
      const [startHour, startMinute] = block.startTime.split(":").map(Number);
      const [endHour, endMinute] = block.endTime.split(":").map(Number);
      return sum + (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
    }, 0);
    return { active, overdue, weeklyHours: Number(weeklyHours.toFixed(1)) };
  }, [tasks, blocks, today]);

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">安排</p>
          <h1 className="page__title">
            {tab === "week" ? "一週的節奏" : "把事情放在對的位置"}
          </h1>
          <p className="page__subtitle">
            {tab === "week"
              ? `每週 ${blocks.length} 項固定安排（${stats.weeklyHours} 小時） · ${stats.active} 項待辦${stats.overdue > 0 ? ` · ${stats.overdue} 項逾期` : ""}`
              : `${stats.active} 項待處理 · ${stats.overdue} 項逾期 · 固定安排每週 ${stats.weeklyHours} 小時`}
          </p>
        </div>
        <div className="page__actions">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "week", label: "週時間表", icon: <CalendarDays size={13} /> },
              { value: "tasks", label: "待辦清單", icon: <ListChecks size={13} /> },
            ]}
          />
        </div>
      </header>

      {tab === "week" ? <TimetableView /> : <TasksPanel />}
    </div>
  );
};
