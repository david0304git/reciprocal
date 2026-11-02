import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AppleCalendarInfo } from "../lib/types";

interface Props {
  ariaLabel: string;
  calendars: AppleCalendarInfo[];
  selected: string[];
  onToggle: (id: string) => void;
  onAll: (value: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  emptyText: string;
  metaFor?: (calendar: AppleCalendarInfo) => string;
}

export const CalendarMultiSelect: React.FC<Props> = ({
  ariaLabel,
  calendars,
  selected,
  onToggle,
  onAll,
  disabled = false,
  loading = false,
  emptyText,
  metaFor,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const summary = loading
    ? "讀取中…"
    : calendars.length === 0
      ? emptyText
      : selected.length === 0
        ? "尚未選擇"
        : selected.length === calendars.length
          ? "全部日曆"
          : `${selected.length} 個日曆`;

  const selectedNames = calendars
    .filter((calendar) => selected.includes(calendar.id))
    .map((calendar) => calendar.title)
    .join("、");

  return (
    <div className="calendar-multi" ref={rootRef}>
      <button
        type="button"
        className={`calendar-multi__trigger ${open ? "is-open" : ""}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="true"
        title={selectedNames || summary}
        disabled={disabled || loading || calendars.length === 0}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="calendar-multi__summary">{summary}</span>
        <ChevronDown size={14} className={`calendar-multi__chevron ${open ? "is-open" : ""}`} />
      </button>

      {open && !loading && calendars.length > 0 ? (
        <div className="calendar-multi__panel" role="group" aria-label={ariaLabel}>
          <div className="calendar-multi__panel-head">
            <span>
              {selected.length} / {calendars.length} 已選
            </span>
            <div className="calendar-multi__actions">
              <button
                type="button"
                className="mini-btn"
                onClick={() => onAll(true)}
                disabled={disabled}
              >
                全選
              </button>
              <button
                type="button"
                className="mini-btn"
                onClick={() => onAll(false)}
                disabled={disabled}
              >
                全不選
              </button>
            </div>
          </div>

          <div className="calendar-multi__list">
            {calendars.map((calendar) => {
              const checked = selected.includes(calendar.id);
              return (
                <label
                  key={calendar.id}
                  className={`calendar-multi__row ${checked ? "is-on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(calendar.id)}
                  />
                  <span
                    className="calendar-multi__dot"
                    style={{ background: calendar.color }}
                  />
                  <span className="calendar-multi__name">{calendar.title}</span>
                  <span className="calendar-multi__meta">{metaFor?.(calendar) ?? ""}</span>
                </label>
              );
            })}
          </div>

          {calendarBusyNote(disabled)}
        </div>
      ) : null}
    </div>
  );
};

const calendarBusyNote = (disabled: boolean): React.ReactNode =>
  disabled ? <p className="calendar-multi__note">同步中，完成後可繼續勾選…</p> : null;
