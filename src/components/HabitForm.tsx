import React, { useEffect, useState } from "react";
import { useApp } from "../lib/store";
import { Modal, Segmented } from "./ui";
import type { Habit, HabitInput, HabitSchedule, TimeOfDay } from "../lib/types";
import { WEEKDAY_LABELS_MON } from "../lib/date";

const EMOJIS = [
  "🌱", "🌅", "📖", "🏃", "🧘", "💧", "🥗", "😴",
  "✍️", "🎹", "🧹", "☎️", "💊", "🚶", "🧠", "🎨",
  "🌙", "☀️", "🫁", "🧴", "📚", "🏋️", "🧊", "🌿",
];

const COLORS = [
  "#3F7C6A", "#D98A5F", "#5B7DB1", "#B06AA0",
  "#C2A33C", "#7A8B5A", "#B4493A", "#6B7B8C",
];

const TIME_OPTIONS: Array<{ value: TimeOfDay; label: string }> = [
  { value: "anytime", label: "任何時候" },
  { value: "morning", label: "早上" },
  { value: "afternoon", label: "下午" },
  { value: "evening", label: "晚上" },
];

interface Props {
  open: boolean;
  habit: Habit | null;
  onClose: () => void;
}

export const HabitForm: React.FC<Props> = ({ open, habit, onClose }) => {
  const { actions } = useApp();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🌱");
  const [customEmoji, setCustomEmoji] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [schedule, setSchedule] = useState<HabitSchedule>("daily");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [weeklyTarget, setWeeklyTarget] = useState(3);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("anytime");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(habit?.name ?? "");
    setEmoji(habit?.emoji ?? "🌱");
    setCustomEmoji("");
    setColor(habit?.color ?? COLORS[0]);
    setSchedule(habit?.schedule ?? "daily");
    setWeekdays(habit?.weekdays ?? [1, 2, 3, 4, 5]);
    setWeeklyTarget(habit?.weeklyTarget ?? 3);
    setTimeOfDay(habit?.timeOfDay ?? "anytime");
    setNotes(habit?.notes ?? "");
    setSaving(false);
  }, [open, habit]);

  const toggleWeekday = (day: number) => {
    setWeekdays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day).sort((a, b) => a - b)
        : [...current, day].sort((a, b) => a - b),
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const input: HabitInput = {
      id: habit?.id,
      name,
      emoji,
      color,
      notes,
      schedule,
      weekdays: schedule === "weekdays" ? weekdays : [1, 2, 3, 4, 5, 6, 7],
      weeklyTarget: schedule === "times_per_week" ? weeklyTarget : 7,
      timeOfDay,
      archived: habit?.archived ?? false,
    };
    const saved = await actions.saveHabit(input);
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={habit ? "編輯習慣" : "建立新習慣"}
      subtitle={habit ? "調整這個習慣的節奏與提醒方式。" : "先從一個小到不會失敗的動作開始。"}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            form="habit-form"
            className="btn btn--primary"
            disabled={!name.trim() || saving}
          >
            {saving ? "儲存中…" : habit ? "儲存變更" : "建立習慣"}
          </button>
        </>
      }
    >
      <form id="habit-form" className="form" onSubmit={submit}>
        <div className="habit-preview">
          <span className="habit-preview__emoji" style={{ background: `${color}1F`, color }}>
            {emoji}
          </span>
          <div>
            <div className="habit-preview__name">{name.trim() || "新的習慣"}</div>
            <div className="habit-preview__hint">預覽</div>
          </div>
        </div>

        <label className="field">
          <span className="field__label">習慣名稱</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：睡前閱讀 20 分鐘"
            autoFocus
            maxLength={40}
          />
        </label>

        <div className="field">
          <span className="field__label">圖示</span>
          <div className="emoji-grid">
            {EMOJIS.map((item) => (
              <button
                key={item}
                type="button"
                className={`emoji-btn ${emoji === item ? "emoji-btn--active" : ""}`}
                onClick={() => setEmoji(item)}
                aria-label={`選擇 ${item}`}
              >
                {item}
              </button>
            ))}
            <input
              className="input emoji-input"
              value={customEmoji}
              onChange={(event) => {
                const value = Array.from(event.target.value).slice(0, 2).join("");
                setCustomEmoji(value);
                if (value.trim()) setEmoji(value.trim());
              }}
              placeholder="自訂"
              maxLength={4}
              aria-label="自訂圖示"
            />
          </div>
        </div>

        <div className="field">
          <span className="field__label">顏色</span>
          <div className="color-grid">
            {COLORS.map((item) => (
              <button
                key={item}
                type="button"
                className={`swatch ${color === item ? "swatch--active" : ""}`}
                style={{ background: item }}
                onClick={() => setColor(item)}
                aria-label={`選擇顏色 ${item}`}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">頻率</span>
          <Segmented
            value={schedule}
            onChange={(value) => setSchedule(value)}
            options={[
              { value: "daily", label: "每天" },
              { value: "weekdays", label: "指定星期" },
              { value: "times_per_week", label: "每週次數" },
            ]}
          />
        </div>

        {schedule === "weekdays" ? (
          <div className="field">
            <span className="field__label">重複於</span>
            <div className="weekday-grid">
              {WEEKDAY_LABELS_MON.map((label, index) => {
                const day = index + 1;
                return (
                  <button
                    key={label}
                    type="button"
                    className={`weekday-chip ${weekdays.includes(day) ? "weekday-chip--on" : ""}`}
                    onClick={() => toggleWeekday(day)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {schedule === "times_per_week" ? (
          <div className="field">
            <span className="field__label">每週目標</span>
            <div className="stepper">
              <button
                type="button"
                className="stepper__btn"
                onClick={() => setWeeklyTarget((value) => Math.max(1, value - 1))}
                aria-label="減少"
              >
                −
              </button>
              <span className="stepper__value">{weeklyTarget} 次</span>
              <button
                type="button"
                className="stepper__btn"
                onClick={() => setWeeklyTarget((value) => Math.min(7, value + 1))}
                aria-label="增加"
              >
                +
              </button>
            </div>
          </div>
        ) : null}

        <div className="field">
          <span className="field__label">時段</span>
          <Segmented
            size="sm"
            value={timeOfDay}
            onChange={(value) => setTimeOfDay(value)}
            options={TIME_OPTIONS}
          />
        </div>

        <label className="field">
          <span className="field__label">備註（選填）</span>
          <textarea
            className="textarea"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="為什麼想做這件事？"
          />
        </label>
      </form>
    </Modal>
  );
};
