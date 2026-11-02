import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useApp } from "../lib/store";
import { ConfirmDialog, Modal, Segmented } from "./ui";
import type { Task, TaskStatus } from "../lib/types";
import { addDaysISO, todayISO } from "../lib/date";
import { PRIORITY_LABELS } from "../lib/stats";

const LISTS = ["個人", "工作", "學習", "家庭"];

interface Props {
  open: boolean;
  task: Task | null;
  initialStatus?: TaskStatus;
  onClose: () => void;
}

export const TaskForm: React.FC<Props> = ({ open, task, initialStatus, onClose }) => {
  const { actions } = useApp();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [list, setList] = useState("個人");
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setStatus(task?.status ?? initialStatus ?? "todo");
    setPriority(task?.priority ?? 0);
    setDueDate(task?.dueDate ?? "");
    setList(task?.list ?? "個人");
    setTagsText((task?.tags ?? []).join(", "));
    setSaving(false);
    setConfirmDelete(false);
  }, [open, task, initialStatus]);

  const tags = useMemo(
    () =>
      tagsText
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 6),
    [tagsText],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    const saved = await actions.saveTask({
      id: task?.id,
      title,
      notes,
      status,
      priority,
      dueDate: dueDate || null,
      tags,
      list,
    });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={task ? "編輯安排" : "新增安排"}
        subtitle={task ? undefined : "把腦中的待辦倒出來，留給重要的那一件事。"}
        width={520}
        footer={
          <>
            {task ? (
              <button
                type="button"
                className="btn btn--ghost btn--danger-text"
                onClick={() => setConfirmDelete(true)}
              >
                刪除
              </button>
            ) : null}
            <span className="spacer" />
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              form="task-form"
              className="btn btn--primary"
              disabled={!title.trim() || saving}
            >
              {saving ? "儲存中…" : task ? "儲存變更" : "新增安排"}
            </button>
          </>
        }
      >
        <form id="task-form" className="form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">要做什麼</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：整理這週的照片"
              autoFocus
              maxLength={120}
            />
          </label>

          <div className="field">
            <span className="field__label">狀態</span>
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: "todo", label: "待辦" },
                { value: "doing", label: "進行中" },
                { value: "done", label: "已完成" },
              ]}
            />
          </div>

          <div className="field">
            <span className="field__label">優先級</span>
            <Segmented
              size="sm"
              value={String(priority)}
              onChange={(value) => setPriority(Number(value))}
              options={PRIORITY_LABELS.map((label, index) => ({
                value: String(index),
                label,
              }))}
            />
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field__label">截止日（選填）</span>
              <input
                className="input"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">分類</span>
              <input
                className="input"
                list="task-lists"
                value={list}
                onChange={(event) => setList(event.target.value)}
                maxLength={12}
              />
              <datalist id="task-lists">
                {LISTS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
          </div>

          <div className="quick-dates">
            <button
              type="button"
              className="mini-btn"
              onClick={() => setDueDate(todayISO())}
            >
              今天
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={() => setDueDate(addDaysISO(todayISO(), 1))}
            >
              明天
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={() => setDueDate(addDaysISO(todayISO(), 7))}
            >
              下週
            </button>
            {dueDate ? (
              <button type="button" className="mini-btn" onClick={() => setDueDate("")}>
                <CalendarDays size={12} /> 清除
              </button>
            ) : null}
          </div>

          <label className="field">
            <span className="field__label">標籤（以逗號分隔）</span>
            <input
              className="input"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="生活, 數位"
            />
            {tags.length > 0 ? (
              <div className="tag-row">
                {tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </label>

          <label className="field">
            <span className="field__label">備註（選填）</span>
            <textarea
              className="textarea"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="補充細節或下一步"
            />
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="刪除這項安排？"
        message="刪除後無法復原，但你可以從先前的備份還原。"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (task) await actions.deleteTask(task.id);
          setConfirmDelete(false);
          onClose();
        }}
      />
    </>
  );
};
