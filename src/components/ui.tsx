import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { addDays, parseISO, startOfWeek } from "date-fns";
import { useApp } from "../lib/store";
import type { Habit, HabitLog } from "../lib/types";
import { formatShort, iso, todayISO } from "../lib/date";
import { isScheduledOn, logKey } from "../lib/stats";

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

  return (
    <div className="time-field">
      <select
        className="time-field__select"
        value={hour}
        onChange={(event) => onChange(`${event.target.value}:${minute}`)}
        aria-label={`${label}（小時）`}
      >
        {hourOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="time-field__sep">:</span>
      <select
        className="time-field__select"
        value={minute}
        onChange={(event) => onChange(`${hour}:${event.target.value}`)}
        aria-label={`${label}（分鐘）`}
      >
        {minuteOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
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

/* ---------------------------------------------------------------- heatmap */

interface HeatmapProps {
  habit: Habit;
  index: Map<string, HabitLog>;
  weeks?: number;
  weekStart?: 0 | 1;
  onSelect?: (date: string) => void;
}

export const Heatmap: React.FC<HeatmapProps> = ({
  habit,
  index,
  weeks = 24,
  weekStart = 1,
  onSelect,
}) => {
  const today = parseISO(todayISO());
  const lastColumn = startOfWeek(today, { weekStartsOn: weekStart });
  const firstColumn = addDays(lastColumn, -(weeks - 1) * 7);
  const columns = Array.from({ length: weeks }, (_, weekOffset) => {
    const columnStart = addDays(firstColumn, weekOffset * 7);
    return Array.from({ length: 7 }, (_, dayOffset) => addDays(columnStart, dayOffset));
  });

  return (
    <div className="heatmap" role="grid" aria-label={`${habit.name} 打卡紀錄`}>
      {columns.map((column, columnIndex) => (
        <div className="heatmap__col" key={columnIndex} role="row">
          {column.map((date) => {
            const key = iso(date);
            const isFuture = key > todayISO();
            const done = index.has(logKey(habit.id, key));
            const scheduled = isScheduledOn(habit, key, weekStart) && !isFuture;
            const classes = [
              "heat-cell",
              done ? "heat-cell--done" : "",
              !done && scheduled ? "heat-cell--miss" : "",
              isFuture ? "heat-cell--future" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                className={classes}
                style={done ? { background: habit.color, borderColor: habit.color } : undefined}
                title={`${formatShort(key)}${done ? " · 已完成" : isFuture ? "" : " · 未記錄"}`}
                onClick={() => onSelect?.(key)}
                disabled={isFuture}
                aria-label={`${key}${done ? " 已完成" : ""}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};

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
