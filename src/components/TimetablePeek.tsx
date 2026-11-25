import React, { useEffect, useRef, useState } from "react";
import { ChevronUp, X } from "lucide-react";
import { useApp } from "../lib/store";
import { formatFullWeekday, todayISO } from "../lib/date";
import { blockPeek, buildTodayBlocks } from "../lib/nextUp";

/**
 * The weekly fixed schedule lives in a pull-up panel above the bottom navigation:
 * the peek row always shows what is happening now (or next), tapping it — or swiping up on the
 * 時間表 tab — opens the sheet with today's blocks.
 */
export const TimetablePeek: React.FC<{ active: boolean }> = ({ active }) => {
  const { data, setView, view } = useApp();
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<{ startY: number; dy: number } | null>(null);
  const peekSwipe = useRef<{ startY: number; swiped: boolean } | null>(null);
  const swallowTap = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Opened by swiping up on the 時間表 tab (Sidebar dispatches this).
  useEffect(() => {
    const openSheet = () => setOpen(true);
    window.addEventListener("reciprocal:open-timetable", openSheet);
    return () => window.removeEventListener("reciprocal:open-timetable", openSheet);
  }, []);

  // The nav stays tappable under the sheet, so close it when the page changes.
  useEffect(() => {
    setOpen(false);
  }, [view]);

  // Off the home page the row collapses to zero height so the page area grows smoothly.
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  // Escape closes it, which is also what the Android back button sends (see tauri-shim.js).
  useEffect(() => {
    if (!open) {
      setDragY(0);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const nowMs = now.getTime();
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  const blocks = data?.timetable ?? [];
  const peek = blockPeek(blocks, weekday, nowMs);
  const todayBlocks = buildTodayBlocks(blocks, weekday, nowMs);

  return (
    <>
      <button
        type="button"
        className={`timetable-peek timetable-peek--${peek.tone}${active ? "" : " is-hidden"}`}
        aria-hidden={!active}
        tabIndex={active ? undefined : -1}
        // Pull the row up to open the sheet; a plain tap does the same.
        onPointerDown={(event) => {
          peekSwipe.current = { startY: event.clientY, swiped: false };
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* pointer capture is best effort */
          }
        }}
        onPointerMove={(event) => {
          const started = peekSwipe.current;
          if (!started || started.swiped) return;
          if (started.startY - event.clientY > 24) {
            started.swiped = true;
            swallowTap.current = true;
            setOpen(true);
          }
        }}
        onPointerUp={() => {
          peekSwipe.current = null;
          window.setTimeout(() => {
            swallowTap.current = false;
          }, 400);
        }}
        onPointerCancel={() => {
          peekSwipe.current = null;
        }}
        onClick={() => {
          if (swallowTap.current) return;
          setOpen(true);
        }}
        aria-expanded={open}
        aria-label="時間表"
      >
        <span className="timetable-peek__grip" aria-hidden="true" />
        <span className="timetable-peek__label">{peek.label}</span>
        <span className="timetable-peek__title">{peek.title}</span>
        <span className="timetable-peek__time">{peek.time}</span>
        <ChevronUp size={14} strokeWidth={2} className="timetable-peek__chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="modal-backdrop timetable-sheet-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            className="timetable-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="時間表"
            style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
            onPointerDown={(event) => {
              dragRef.current = { startY: event.clientY, dy: 0 };
            }}
            onPointerMove={(event) => {
              const started = dragRef.current;
              if (!started) return;
              started.dy = Math.max(0, event.clientY - started.startY);
              setDragY(started.dy);
            }}
            onPointerUp={() => {
              const started = dragRef.current;
              dragRef.current = null;
              if (started && started.dy > 80) setOpen(false);
              else setDragY(0);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
              setDragY(0);
            }}
          >
            <span className="timetable-sheet__grip" aria-hidden="true" />
            <div className="timetable-sheet__head">
              <div>
                <p className="page__eyebrow">時間表</p>
                <h2 className="timetable-sheet__title">{formatFullWeekday(todayISO())}</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOpen(false)}
                aria-label="關閉"
              >
                <X size={16} />
              </button>
            </div>

            <div className="timetable-sheet__body">
              {todayBlocks.length === 0 ? (
                <p className="muted-inline">今天沒有時段。</p>
              ) : (
                <ul className="timetable-sheet__list">
                  {todayBlocks.map((block) => {
                    const current = block.startMs <= nowMs && block.endMs > nowMs;
                    const done = block.endMs <= nowMs;
                    return (
                      <li
                        key={block.id}
                        className={`timetable-sheet__row${current ? " is-current" : ""}${
                          done ? " is-done" : ""
                        }`}
                      >
                        <span
                          className="timetable-sheet__bar"
                          style={{ background: block.color }}
                        />
                        <span className="timetable-sheet__time">
                          {block.startTime}–{block.endTime}
                        </span>
                        <span className="timetable-sheet__name">{block.title}</span>
                        {current ? <span className="chip chip--tiny">現在</span> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="timetable-sheet__foot">
              <button
                type="button"
                className="btn btn--soft btn--sm"
                onClick={() => {
                  setOpen(false);
                  setView("tasks");
                }}
              >
                開啟週時間表
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
