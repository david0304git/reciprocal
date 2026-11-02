import React, { useEffect, useState } from "react";
import { useApp } from "../lib/store";
import { todayISO } from "../lib/date";
import { DayDetailCard } from "../components/DayDetailCard";

const greetingFor = (hour: number): string => {
  if (hour < 5) return "夜深了，早點休息。";
  if (hour < 12) return "早安。";
  if (hour < 18) return "午安。";
  if (hour < 23) return "晚安。";
  return "夜深了，早點休息。";
};

const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat("zh-Hant", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);

export const TodayView: React.FC = () => {
  const { data } = useApp();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  const todayBlocks = (data?.timetable ?? [])
    .filter((block) => block.day === weekday)
    .map((block) => {
      const [startHour, startMinute] = block.startTime.split(":").map(Number);
      const [endHour, endMinute] = block.endTime.split(":").map(Number);
      return {
        ...block,
        start: startHour * 60 + startMinute,
        end: endHour * 60 + endMinute,
      };
    })
    .sort((a, b) => a.start - b.start);

  const currentBlock = todayBlocks.find(
    (block) => block.start <= nowMinutes && block.end > nowMinutes,
  );
  const nextBlock = todayBlocks.find((block) => block.start > nowMinutes);
  const lastBlock = [...todayBlocks].reverse().find((block) => block.end <= nowMinutes);

  let nowLabel = "每週固定安排";
  let nowTitle = weekday >= 1 && weekday <= 5 ? "今天沒有固定安排" : "週末沒有固定安排";
  let nowMeta =
    weekday >= 1 && weekday <= 5
      ? "在「安排 → 週時間表」新增"
      : "固定安排只排星期一至五";
  let nowTone = "empty";
  let nowColor = "var(--text-tertiary)";

  if (currentBlock) {
    nowLabel = "目前安排";
    nowTitle = currentBlock.title;
    nowMeta = `${currentBlock.startTime} – ${currentBlock.endTime}`;
    nowTone = "current";
    nowColor = currentBlock.color;
  } else if (nextBlock) {
    nowLabel = "接下來";
    nowTitle = nextBlock.title;
    nowMeta = `${nextBlock.startTime} 開始 · ${nextBlock.start - nowMinutes} 分鐘後`;
    nowTone = "next";
    nowColor = nextBlock.color;
  } else if (lastBlock) {
    nowLabel = "今天的安排已結束";
    nowTitle = lastBlock.title;
    nowMeta = `${lastBlock.startTime} – ${lastBlock.endTime}`;
    nowTone = "done";
    nowColor = lastBlock.color;
  }

  return (
    <div className="page home">
      <header className="home__head">
        <p className="page__eyebrow">主頁</p>
      </header>

      <div className="home__clock">
        <p className="home__time" aria-label={`現在時間 ${hours}:${minutes}`}>
          {hours}:{minutes}
          <span className="home__seconds">{seconds}</span>
        </p>
        <p className="home__date">{formatDate(now)}</p>
        <p className="home__greeting">{greetingFor(now.getHours())}</p>
      </div>

      <div className="home__panels">
        <section
          className={`home-now home-now--${nowTone}`}
          style={{ "--now-color": nowColor } as React.CSSProperties}
        >
          <div className="home-now__head">
            <span className="home-now__dot" />
            <span className="home-now__kicker">{nowLabel}</span>
          </div>
          <p className="home-now__title">{nowTitle}</p>
          <p className="home-now__meta">{nowMeta}</p>
        </section>

        <DayDetailCard date={todayISO()} />
      </div>
    </div>
  );
};
