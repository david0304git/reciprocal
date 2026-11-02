import React, { useEffect, useMemo, useState } from "react";
import { Trash } from "lucide-react";
import { useApp } from "../lib/store";
import { ConfirmDialog, Modal, Segmented, TimeField } from "./ui";
import type { TimetableBlock } from "../lib/types";

const COLORS = ["#5B7DB1", "#3F7C6A", "#D98A5F", "#B06AA0", "#C2A33C", "#B4493A"];

const DAY_OPTIONS = [
  { value: "1", label: "週一" },
  { value: "2", label: "週二" },
  { value: "3", label: "週三" },
  { value: "4", label: "週四" },
  { value: "5", label: "週五" },
];

interface Props {
  open: boolean;
  block: TimetableBlock | null;
  defaultDay: number;
  defaultStart: string;
  onClose: () => void;
}

export const TimetableForm: React.FC<Props> = ({
  open,
  block,
  defaultDay,
  defaultStart,
  onClose,
}) => {
  const { actions } = useApp();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(String(defaultDay));
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState("10:00");
  const [color, setColor] = useState(COLORS[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    const start = block?.startTime ?? defaultStart;
    const startHour = Number(start.slice(0, 2)) || 9;
    setTitle(block?.title ?? "");
    setDay(String(block?.day ?? defaultDay));
    setStartTime(start);
    setEndTime(block?.endTime ?? `${String(Math.min(23, startHour + 1)).padStart(2, "0")}:${start.slice(3, 5)}`);
    setColor(block?.color ?? COLORS[0]);
    setNotes(block?.notes ?? "");
    setSaving(false);
    setConfirmDelete(false);
  }, [open, block, defaultDay, defaultStart]);

  const invalidTime = useMemo(
    () => !startTime || !endTime || endTime <= startTime,
    [startTime, endTime],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || invalidTime || saving) return;
    setSaving(true);
    const saved = await actions.saveTimetable({
      id: block?.id,
      day: Number(day),
      startTime,
      endTime,
      title,
      notes,
      color,
    });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={block ? "編輯固定安排" : "新增固定安排"}
        subtitle={block ? "這是每週重複的安排，會出現在每個對應的星期。" : "星期一至五，每週重複出現。"}
        width={520}
        footer={
          <>
            {block ? (
              <button
                type="button"
                className="btn btn--ghost btn--danger-text"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash size={14} /> 刪除
              </button>
            ) : null}
            <span className="spacer" />
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              form="timetable-form"
              className="btn btn--primary"
              disabled={!title.trim() || invalidTime || saving}
            >
              {saving ? "儲存中…" : block ? "儲存變更" : "新增安排"}
            </button>
          </>
        }
      >
        <form id="timetable-form" className="form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">安排名稱</span>
            <input
              className="input"
              value={title}
              onChange={(changeEvent) => setTitle(changeEvent.target.value)}
              placeholder="例如：深度工作、英文課、運動"
              autoFocus
              maxLength={60}
            />
          </label>

          <div className="field">
            <span className="field__label">星期</span>
            <Segmented
              value={day}
              onChange={setDay}
              options={DAY_OPTIONS}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <span className="field__label">開始</span>
              <TimeField value={startTime} onChange={setStartTime} label="開始時間" />
            </div>
            <div className="field">
              <span className="field__label">結束</span>
              <TimeField value={endTime} onChange={setEndTime} label="結束時間" />
            </div>
          </div>
          {invalidTime ? (
            <p className="form-hint form-hint--error">結束時間必須晚於開始時間。</p>
          ) : null}

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

          <label className="field">
            <span className="field__label">備註（選填）</span>
            <textarea
              className="textarea"
              rows={2}
              value={notes}
              onChange={(changeEvent) => setNotes(changeEvent.target.value)}
              placeholder="這段時間要做什麼？"
            />
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="刪除這項固定安排？"
        message={`「${block?.title ?? ""}」會從每個星期移除。`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (block) await actions.deleteTimetable(block.id);
          setConfirmDelete(false);
          onClose();
        }}
      />
    </>
  );
};
