import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../lib/store";
import { todayISO } from "../lib/date";
import {
  applyHomeEventOrder,
  homeEventCards,
  readHomeEventOrder,
  readHomeRangeDays,
  writeHomeEventOrder,
} from "../lib/nextUp";
import { EventForm } from "../components/EventForm";
import { AutoFitText } from "../components/AutoFitText";
import type { EventItem } from "../lib/types";

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

/** Long press before a card can be dragged. */
const LONG_PRESS_MS = 360;

interface DragMetrics {
  /** ids in display order at drag start */
  order: number[];
  rects: Map<number, { top: number; height: number }>;
  gap: number;
  height: number;
}

export const TodayView: React.FC = () => {
  const { data } = useApp();
  const [now, setNow] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [customOrder, setCustomOrder] = useState<number[]>(readHomeEventOrder);
  const [drag, setDrag] = useState<{ id: number; dy: number; target: number } | null>(null);

  const pressTimer = useRef<number | null>(null);
  const press = useRef<{ id: number; startY: number; pointerId: number } | null>(null);
  const metrics = useRef<DragMetrics | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const suppressClick = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  // The agenda only changes once a minute; the clock keeps ticking every second.
  const minuteKey = Math.floor(now.getTime() / 60_000);
  const rangeDays = readHomeRangeDays(data?.settings);
  const chronological = useMemo(
    () =>
      homeEventCards({
        events: data?.events ?? [],
        settings: data?.settings,
        nowMs: minuteKey * 60_000,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.events, data?.settings, minuteKey],
  );
  const cards = useMemo(
    () => applyHomeEventOrder(chronological, customOrder),
    [chronological, customOrder],
  );

  const dragging = drag !== null;

  // While a card is lifted the page must not scroll under the finger.
  useEffect(() => {
    if (!dragging) return;
    const blockScroll = (event: TouchEvent) => event.preventDefault();
    document.addEventListener("touchmove", blockScroll, { passive: false });
    return () => document.removeEventListener("touchmove", blockScroll);
  }, [dragging]);

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const openNewEvent = (event: EventItem | null = null) => {
    setEditingEvent(event);
    setFormOpen(true);
  };

  // ---------------------------------------------------------------- drag order

  const targetIndexFor = (dy: number): number => {
    const captured = metrics.current;
    const started = press.current;
    if (!captured || !started) return -1;
    const draggedRect = captured.rects.get(started.id);
    if (!draggedRect) return -1;
    const visualCenter = draggedRect.top + captured.height / 2 + dy;
    const others = captured.order.filter((id) => id !== started.id);
    let target = 0;
    for (const id of others) {
      const rect = captured.rects.get(id);
      if (!rect) continue;
      if (visualCenter > rect.top + rect.height / 2) target += 1;
      else break;
    }
    return target;
  };

  const startPress = (id: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (cards.length < 2) return;
    cancelPress();
    suppressClick.current = false;
    const element = event.currentTarget;
    const startY = event.clientY;
    const { pointerId } = event;
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      const rects = new Map<number, { top: number; height: number }>();
      for (const card of cards) {
        const row = rowRefs.current[card.event.id];
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        rects.set(card.event.id, { top: rect.top, height: rect.height });
      }
      const gap = listRef.current
        ? Number.parseFloat(window.getComputedStyle(listRef.current).rowGap || "0") || 0
        : 0;
      press.current = { id, startY, pointerId };
      metrics.current = {
        order: cards.map((card) => card.event.id),
        rects,
        gap,
        height: rects.get(id)?.height ?? element.offsetHeight,
      };
      suppressClick.current = true;
      setDrag({ id, dy: 0, target: cards.findIndex((card) => card.event.id === id) });
      try {
        element.setPointerCapture(pointerId);
      } catch {
        /* pointer capture is best effort */
      }
      if (typeof navigator.vibrate === "function") navigator.vibrate(8);
    }, LONG_PRESS_MS);
  };

  const movePress = (event: React.PointerEvent<HTMLDivElement>) => {
    const started = press.current;
    if (!started) {
      if (pressTimer.current !== null) cancelPress();
      return;
    }
    const dy = event.clientY - started.startY;
    setDrag({ id: started.id, dy, target: targetIndexFor(dy) });
  };

  const finishPress = () => {
    cancelPress();
    const started = press.current;
    const current = drag;
    press.current = null;
    metrics.current = null;
    setDrag(null);
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (!started || !current) return;
    const from = cards.findIndex((card) => card.event.id === started.id);
    const to = current.target;
    if (from < 0 || to < 0 || to === from) return;
    const ids = cards.map((card) => card.event.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setCustomOrder(ids);
    writeHomeEventOrder(ids);
  };

  const shiftFor = (index: number): number => {
    if (!drag || !metrics.current) return 0;
    const from = metrics.current.order.indexOf(drag.id);
    const to = drag.target;
    if (from < 0 || to < 0 || from === to) return 0;
    const step = metrics.current.height + metrics.current.gap;
    if (to > from && index > from && index <= to) return -step;
    if (to < from && index >= to && index < from) return step;
    return 0;
  };

  const rowProps = (id: number, index: number) => {
    const isDragged = drag?.id === id;
    const shift = isDragged ? 0 : shiftFor(index);
    const transform = isDragged
      ? `translateY(${drag?.dy ?? 0}px)`
      : shift !== 0
        ? `translateY(${shift}px)`
        : undefined;
    return {
      ref: (element: HTMLDivElement | null) => {
        rowRefs.current[id] = element;
      },
      className: `agenda-row${isDragged ? " is-dragging" : ""}`,
      style: transform ? { transform } : undefined,
      onPointerDown: startPress(id),
      onPointerMove: movePress,
      onPointerUp: finishPress,
      onPointerCancel: finishPress,
      onContextMenu: (event: React.MouseEvent) => {
        if (dragging) event.preventDefault();
      },
    };
  };

  return (
    <div className="page home">
      <header className="home__head home__head--row">
        <p className="page__eyebrow">主頁</p>
        <button type="button" className="btn btn--soft btn--sm" onClick={() => openNewEvent()}>
          <Plus size={14} /> 新增行程
        </button>
      </header>

      <div className="home__clock">
        <div className="home__clock-card">
          <p className="home__time" aria-label={`現在時間 ${hours}:${minutes}`}>
            {hours}:{minutes}
            <span className="home__seconds">{seconds}</span>
          </p>
          <p className="home__date">{formatDate(now)}</p>
          <p className="home__greeting">{greetingFor(now.getHours())}</p>
        </div>
      </div>

      <section
        className="home__agenda"
        ref={listRef}
        aria-label="接下來的行程"
        onClickCapture={(event) => {
          // A long press that turned into a drag must not open the editor.
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {cards.map((card, index) => (
          <div key={card.event.id} {...rowProps(card.event.id, index)}>
            <button
              type="button"
              className="agenda-row__main"
              onClick={() => openNewEvent(card.event)}
            >
              <AutoFitText
                text={card.event.title}
                className="agenda-row__title"
                max={20}
                min={15}
              />
              <span className="agenda-row__countdown">{card.countdown}</span>
            </button>
          </div>
        ))}

        {cards.length === 0 ? (
          <div className="card home__empty">
            <p className="home__empty-title">接下來 {rangeDays} 天沒有行程</p>
            <p className="home__empty-hint">
              新增的行程會出現在這裡；顯示範圍可在「設定 → 主頁」調整。
            </p>
            <button type="button" className="btn btn--soft btn--sm" onClick={() => openNewEvent()}>
              <Plus size={14} /> 新增行程
            </button>
          </div>
        ) : null}
      </section>

      <EventForm
        open={formOpen}
        event={editingEvent}
        defaultDate={todayISO()}
        onClose={() => {
          setFormOpen(false);
          setEditingEvent(null);
        }}
      />
    </div>
  );
};
