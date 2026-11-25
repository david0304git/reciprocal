import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useApp } from "../lib/store";
import {
  WEEKDAY_LABELS_MON,
  formatFullWeekday,
  formatMonthTitle,
  formatShort,
  isSameMonth,
  isToday,
  iso,
  monthGrid,
  parse,
  todayISO,
} from "../lib/date";

/* ---------------------------------------------------------------- modal */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  width = 520,
  children,
  footer,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
      >
        <header className="modal__head">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle ? <p className="modal__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="關閉">
            <X size={16} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
};

/* ---------------------------------------------------------------- segmented */

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentOption<T>>;
  size?: "sm" | "md";
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: SegmentedProps<T>): React.ReactElement {
  return (
    <div className={`seg seg--${size}`} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`seg__btn ${value === option.value ? "seg__btn--active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- time field */

interface TimeFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  minuteStep?: number;
  minHour?: number;
  maxHour?: number;
}

export const TimeField: React.FC<TimeFieldProps> = ({
  value,
  onChange,
  label,
  minuteStep = 5,
  minHour = 0,
  maxHour = 23,
}) => {
  const [open, setOpen] = useState(false);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  const [rawHour, rawMinute] = (value || "09:00").split(":");
  const hour = String(Number(rawHour) || 0).padStart(2, "0");
  const minute = (rawMinute || "00").slice(0, 2).padStart(2, "0");

  const hourOptions = useMemo(() => {
    const options = new Set<string>();
    for (let step = minHour; step <= maxHour; step += 1) {
      options.add(String(step).padStart(2, "0"));
    }
    options.add(hour);
    return Array.from(options).sort();
  }, [hour, minHour, maxHour]);

  const minuteOptions = useMemo(() => {
    const options = new Set<string>();
    for (let step = 0; step < 60; step += minuteStep) {
      options.add(String(step).padStart(2, "0"));
    }
    options.add(minute);
    return Array.from(options).sort();
  }, [minute, minuteStep]);

  // Bring the current value into view whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    for (const list of [hourListRef.current, minuteListRef.current]) {
      const active = list?.querySelector<HTMLElement>(".time-picker__item.is-active");
      if (!list || !active) continue;
      list.scrollTop = active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2;
    }
  }, [open]);

  return (
    <div className={`time-field${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="time-field__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${label} ${hour}:${minute}`}
      >
        <span className="time-field__value">
          {hour}
          <span className="time-field__colon">:</span>
          {minute}
        </span>
        <ChevronDown size={14} strokeWidth={2} className="time-field__caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="time-picker" role="group" aria-label={label}>
          <div className="time-picker__head" aria-hidden="true">
            <span>時</span>
            <span>分</span>
          </div>
          <div className="time-picker__cols">
            <div
              className="time-picker__col"
              ref={hourListRef}
              role="listbox"
              aria-label={`${label}（小時）`}
            >
              {hourOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={option === hour}
                  className={`time-picker__item${option === hour ? " is-active" : ""}`}
                  onClick={() => onChange(`${option}:${minute}`)}
                >
                  {option}
                </button>
              ))}
            </div>
            <div
              className="time-picker__col"
              ref={minuteListRef}
              role="listbox"
              aria-label={`${label}（分鐘）`}
            >
              {minuteOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={option === minute}
                  className={`time-picker__item${option === minute ? " is-active" : ""}`}
                  onClick={() => onChange(`${hour}:${option}`)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="time-picker__foot">
            <button type="button" className="btn btn--soft btn--sm" onClick={() => setOpen(false)}>
              完成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ---------------------------------------------------------------- date field */

interface DateFieldProps {
  /** `YYYY-MM-DD`, or "" when the field is optional and empty. */
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Show a 清除 button (optional dates such as a task due date). */
  allowClear?: boolean;
}

export const DateField: React.FC<DateFieldProps> = ({
  value,
  onChange,
  label,
  allowClear = false,
}) => {
  const { settings } = useApp();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() => (value ? parse(value) : new Date()));
  const weekStartsOn = settings.weekStart;

  // Re-open on the month of the current value.
  useEffect(() => {
    if (!open) return;
    setMonth(value ? parse(value) : new Date());
  }, [open, value]);

  const grid = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn]);
  const weekdayLabels = useMemo(
    () =>
      weekStartsOn === 1
        ? WEEKDAY_LABELS_MON
        : [WEEKDAY_LABELS_MON[6], ...WEEKDAY_LABELS_MON.slice(0, 6)],
    [weekStartsOn],
  );

  const shiftMonth = (delta: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className={`date-field${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="date-field__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${label} ${value || "未選擇"}`}
      >
        <span className="date-field__value">
          {value ? (
            <>
              {formatShort(value)}
              <span className="date-field__weekday">{formatFullWeekday(value)}</span>
            </>
          ) : (
            <span className="date-field__placeholder">選擇日期</span>
          )}
        </span>
        <ChevronDown size={14} strokeWidth={2} className="date-field__caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="date-picker" role="group" aria-label={label}>
          <div className="date-picker__head">
            <button
              type="button"
              className="date-picker__nav"
              onClick={() => shiftMonth(-1)}
              aria-label="上個月"
            >
              <ChevronLeft size={15} strokeWidth={2} />
            </button>
            <span className="date-picker__title">{formatMonthTitle(month)}</span>
            <button
              type="button"
              className="date-picker__nav"
              onClick={() => shiftMonth(1)}
              aria-label="下個月"
            >
              <ChevronRight size={15} strokeWidth={2} />
            </button>
          </div>

          <div className="date-picker__weekdays" aria-hidden="true">
            {weekdayLabels.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="date-picker__grid" role="grid">
            {grid.map((day) => {
              const dayIso = iso(day);
              const outside = !isSameMonth(day, month);
              const selected = dayIso === value;
              return (
                <button
                  key={dayIso}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  aria-label={dayIso}
                  className={[
                    "date-picker__day",
                    outside ? "is-outside" : "",
                    selected ? "is-selected" : "",
                    isToday(dayIso) ? "is-today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => choose(dayIso)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="date-picker__foot">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => choose(todayISO())}
            >
              今天
            </button>
            {allowClear ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => choose("")}
              >
                清除
              </button>
            ) : null}
            <span className="date-picker__spacer" />
            <button
              type="button"
              className="btn btn--soft btn--sm"
              onClick={() => setOpen(false)}
            >
              完成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ---------------------------------------------------------------- ring */

interface RingProps {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
}

export const ProgressRing: React.FC<RingProps> = ({
  value,
  size = 96,
  stroke = 8,
  color = "var(--accent)",
  children,
}) => {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ring-track)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 480ms cubic-bezier(.22,.75,.3,1)" }}
        />
      </svg>
      <div className="ring__center">{children}</div>
    </div>
  );
};

/* ---------------------------------------------------------------- check */

interface CheckProps {
  checked: boolean;
  color: string;
  onClick: () => void;
  label: string;
  size?: number;
}

export const CheckCircle: React.FC<CheckProps> = ({
  checked,
  color,
  onClick,
  label,
  size = 30,
}) => (
  <button
    type="button"
    className={`check ${checked ? "check--done" : ""}`}
    style={
      {
        width: size,
        height: size,
        "--check-color": color,
      } as React.CSSProperties
    }
    onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}
    aria-pressed={checked}
    aria-label={label}
    title={label}
  >
    {checked ? <Check size={Math.round(size * 0.52)} strokeWidth={3} /> : null}
  </button>
);

/* ---------------------------------------------------------------- toast */

export const ToastStack: React.FC = () => {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast__close"
            onClick={() => dismissToast(toast.id)}
            aria-label="關閉通知"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};

/* ---------------------------------------------------------------- confirm */

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmDialog: React.FC<ConfirmProps> = ({
  open,
  title,
  message,
  confirmLabel = "刪除",
  onConfirm,
  onClose,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title={title}
    width={420}
    footer={
      <>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn btn--danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </>
    }
  >
    <p className="modal__message">{message}</p>
  </Modal>
);

/* ---------------------------------------------------------------- empty */

interface EmptyProps {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyProps> = ({ icon, title, text, action }) => (
  <div className="empty">
    <div className="empty__icon">{icon}</div>
    <h3 className="empty__title">{title}</h3>
    <p className="empty__text">{text}</p>
    {action}
  </div>
);
