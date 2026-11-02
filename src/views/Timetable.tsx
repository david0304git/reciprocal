import React, { useEffect, useMemo, useState } from "react";
import { Clock, Plus } from "lucide-react";
import { useApp } from "../lib/store";
import type { TimetableBlock } from "../lib/types";
import { hexAlpha, todayISO } from "../lib/date";
import { TimetableForm } from "../components/TimetableForm";

const SLOT_HEIGHT = 54;
const START_HOUR = 0;
const END_HOUR = 24;

const DAYS = [
  { day: 1, label: "星期一", short: "一" },
  { day: 2, label: "星期二", short: "二" },
  { day: 3, label: "星期三", short: "三" },
  { day: 4, label: "星期四", short: "四" },
  { day: 5, label: "星期五", short: "五" },
];

const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export const TimetableView: React.FC = () => {
  const { data } = useApp();
  const blocks = data?.timetable ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TimetableBlock | null>(null);
  const [defaultDay, setDefaultDay] = useState(1);
  const [defaultStart, setDefaultStart] = useState("09:00");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR }, (_, offset) => START_HOUR + offset),
    [],
  );
  const rangeStart = START_HOUR * 60;
  const rangeEnd = END_HOUR * 60;

  const totalHours = useMemo(
    () => blocks.reduce((sum, block) => sum + (toMinutes(block.endTime) - toMinutes(block.startTime)) / 60, 0),
    [blocks],
  );

  const today = new Date(`${todayISO()}T00:00:00`);
  const todayDay = today.getDay() === 0 ? 7 : today.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMinutes - rangeStart) / 60) * SLOT_HEIGHT;
  const showNowLine =
    todayDay >= 1 && todayDay <= 5 && nowTop >= 0 && nowTop <= (END_HOUR - START_HOUR) * SLOT_HEIGHT;

  const openNew = (day: number, start: string) => {
    setEditing(null);
    setDefaultDay(day);
    setDefaultStart(start);
    setFormOpen(true);
  };

  const openEdit = (block: TimetableBlock) => {
    setEditing(block);
    setFormOpen(true);
  };

  return (
    <>
      <section className="card tt-card">
        <div className="card__head">
          <div>
            <h2 className="card__title">每週固定安排</h2>
            <p className="card__subtitle">
              共 {blocks.length} 項 · 每週 {Number(totalHours.toFixed(1))} 小時 · 全天 00:00–24:00
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => openNew(1, "09:00")}
          >
            <Plus size={15} /> 新增安排
          </button>
        </div>

        <div className="tt-scroll">
          <div className="tt">
            <div className="tt__head">
            <div className="tt__gutter tt__gutter--head" />
            {DAYS.map((day) => {
              const count = blocks.filter((block) => block.day === day.day).length;
              return (
                <div
                  key={day.day}
                  className={`tt__day-head ${day.day === todayDay ? "is-today" : ""}`}
                >
                  <span className="tt__day-label">{day.label}</span>
                  <span className="tt__day-count">{count} 項</span>
                </div>
              );
            })}
            </div>

          <div className="tt__body">
            <div className="tt__gutter">
              {hours.map((hour) => (
                <div key={hour} className="tt__hour" style={{ height: SLOT_HEIGHT }}>
                  {hourLabel(hour)}
                </div>
              ))}
            </div>

            {DAYS.map((day) => (
              <div
                key={day.day}
                className={`tt__col ${day.day === todayDay ? "is-today" : ""}`}
                style={{ height: hours.length * SLOT_HEIGHT }}
              >
                {hours.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    className="tt__cell"
                    style={{ height: SLOT_HEIGHT }}
                    onClick={() => openNew(day.day, hourLabel(hour))}
                    aria-label={`在${day.label} ${hourLabel(hour)} 新增安排`}
                  />
                ))}

                {blocks
                  .filter((block) => block.day === day.day)
                  .map((block) => {
                    const start = toMinutes(block.startTime);
                    const end = toMinutes(block.endTime);
                    const visibleStart = Math.max(start, rangeStart);
                    const visibleEnd = Math.min(end, rangeEnd);
                    if (visibleEnd <= visibleStart) return null;
                    const top = ((visibleStart - rangeStart) / 60) * SLOT_HEIGHT;
                    const height = Math.max(
                      26,
                      ((visibleEnd - visibleStart) / 60) * SLOT_HEIGHT - 3,
                    );
                    return (
                      <button
                        type="button"
                        key={block.id}
                        className="tt__block"
                        style={{
                          top,
                          height,
                          background: hexAlpha(block.color, 0.14),
                          borderLeftColor: block.color,
                        }}
                        onClick={() => openEdit(block)}
                        title={`${block.title}｜${block.startTime}–${block.endTime}${block.notes ? `\n${block.notes}` : ""}`}
                      >
                        <span className="tt__block-title">{block.title}</span>
                        <span className="tt__block-time">
                          {block.startTime}–{block.endTime}
                        </span>
                        {height > 62 && block.notes ? (
                          <span className="tt__block-notes">{block.notes}</span>
                        ) : null}
                      </button>
                    );
                  })}

                {day.day === todayDay && showNowLine ? (
                  <span className="tt__now" style={{ top: nowTop }} aria-hidden="true">
                    <span className="tt__now-dot" />
                  </span>
                ) : null}
              </div>
            ))}
            </div>
          </div>
        </div>

        <p className="tt__foot">
          <Clock size={12} /> 固定安排每週重複；時間表顯示全天 00:00–24:00，可上下捲動。單次事件請到「日曆」新增。
        </p>
      </section>

      <TimetableForm
        open={formOpen}
        block={editing}
        defaultDay={defaultDay}
        defaultStart={defaultStart}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
    </>
  );
};
