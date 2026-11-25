import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.max(
      8,
      Math.min(rect.right - width, window.innerWidth - width - 8),
    );
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(180, Math.min(360, openAbove ? spaceAbove : spaceBelow));
    const top = openAbove
      ? Math.max(8, rect.top - maxHeight - 6)
      : rect.bottom + 6;
    setPanelStyle({
      position: "fixed",
      top,
      left,
      right: "auto",
      width,
      maxHeight,
      zIndex: 130,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return;
    }
    updatePanelPosition();
    const onScroll = () => updatePanelPosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
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
        ref={triggerRef}
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

      {open && !loading && calendars.length > 0 && panelStyle
        ? createPortal(
        <div
          ref={panelRef}
          className="calendar-multi__panel"
          style={panelStyle}
          role="group"
          aria-label={ariaLabel}
        >
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
        </div>,
        document.body,
      )
        : null}
    </div>
  );
};

const calendarBusyNote = (disabled: boolean): React.ReactNode =>
  disabled ? <p className="calendar-multi__note">同步中，完成後可繼續勾選…</p> : null;
