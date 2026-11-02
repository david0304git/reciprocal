import React, { useMemo, useState } from "react";
import {
  CalendarDays,
  Flag,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Trash,
} from "lucide-react";
import { useApp } from "../lib/store";
import type { Task, TaskStatus } from "../lib/types";
import { dueLabel, todayISO } from "../lib/date";
import { PRIORITY_LABELS, taskDueBucket } from "../lib/stats";
import { ConfirmDialog, EmptyState, Segmented } from "../components/ui";
import { TaskForm } from "../components/TaskForm";

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待辦",
  doing: "進行中",
  done: "已完成",
};

const BOARD_COLUMNS: TaskStatus[] = ["todo", "doing", "done"];

interface RowProps {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
}

const TaskRow: React.FC<RowProps> = ({ task, onEdit, onDelete }) => {
  const { actions } = useApp();
  const today = todayISO();
  const overdue = task.status !== "done" && task.dueDate && task.dueDate < today;
  return (
    <div className={`task ${task.status === "done" ? "task--done" : ""}`}>
      <button
        type="button"
        className={`task__check ${task.status === "done" ? "task__check--done" : ""}`}
        onClick={() => void actions.setTaskStatus(task.id, task.status === "done" ? "todo" : "done")}
        aria-label={task.status === "done" ? "標記未完成" : "標記完成"}
      >
        {task.status === "done" ? "✓" : ""}
      </button>
      <button type="button" className="task__main" onClick={onEdit}>
        <span className="task__title-row">
          {task.priority > 0 ? (
            <span className={`priority priority--${task.priority}`} title={`優先級：${PRIORITY_LABELS[task.priority]}`}>
              <Flag size={10} />
            </span>
          ) : null}
          <span className="task__title">{task.title}</span>
          {task.status === "doing" ? <span className="chip chip--doing">進行中</span> : null}
        </span>
        <span className="task__meta">
          {task.dueDate ? (
            <span className={`task__due ${overdue ? "task__due--late" : ""}`}>
              <CalendarDays size={11} /> {dueLabel(task.dueDate)}
            </span>
          ) : null}
          {task.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
          <span className="task__list">{task.list}</span>
        </span>
      </button>
      <span className="task__actions">
        <button type="button" className="icon-btn" onClick={onEdit} aria-label="編輯">
          <Pencil size={13} />
        </button>
        <button type="button" className="icon-btn icon-btn--danger" onClick={onDelete} aria-label="刪除">
          <Trash size={13} />
        </button>
      </span>
    </div>
  );
};

export const TasksPanel: React.FC = () => {
  const { data, actions, notify } = useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [initialStatus, setInitialStatus] = useState<TaskStatus>("todo");
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [listFilter, setListFilter] = useState("all");
  const [mode, setMode] = useState<"list" | "board">("list");
  const [quickTitle, setQuickTitle] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);

  const today = todayISO();
  const allTasks = data?.tasks ?? [];
  const lists = useMemo(
    () => Array.from(new Set(allTasks.map((task) => task.list).filter(Boolean))),
    [allTasks],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allTasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (priorityFilter !== "all" && String(task.priority) !== priorityFilter) return false;
      if (listFilter !== "all" && task.list !== listFilter) return false;
      if (!needle) return true;
      return (
        task.title.toLowerCase().includes(needle) ||
        task.notes.toLowerCase().includes(needle) ||
        task.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [allTasks, query, statusFilter, priorityFilter, listFilter]);

  const activeTasks = filtered.filter((task) => task.status !== "done");
  const doneTasks = filtered
    .filter((task) => task.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  const groups = [
    { key: "overdue", label: "逾期", tasks: activeTasks.filter((task) => taskDueBucket(task) === "overdue") },
    { key: "today", label: "今天", tasks: activeTasks.filter((task) => taskDueBucket(task) === "today") },
    {
      key: "upcoming",
      label: "接下來",
      tasks: activeTasks.filter((task) => ["soon", "later"].includes(taskDueBucket(task))),
    },
    { key: "someday", label: "沒有期限", tasks: activeTasks.filter((task) => taskDueBucket(task) === "none") },
    ...(statusFilter === "all" || statusFilter === "done"
      ? [{ key: "done", label: "已完成", tasks: doneTasks }]
      : []),
  ];

  const openNew = (status: TaskStatus = "todo") => {
    setEditing(null);
    setInitialStatus(status);
    setFormOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setFormOpen(true);
  };

  const submitQuick = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quickTitle.trim()) return;
    const created = await actions.saveTask({ title: quickTitle, status: "todo" });
    if (created) {
      setQuickTitle("");
      notify("已新增安排", "ok");
    }
  };

  const dropInto = async (status: TaskStatus) => {
    if (dragging) await actions.setTaskStatus(dragging, status);
    setDragging(null);
    setOverColumn(null);
  };

  return (
    <div className="task-panel">
      <div className="toolbar">
        <div className="search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋標題、備註或標籤…"
            aria-label="搜尋安排"
          />
        </div>
        <Segmented
          size="sm"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "全部" },
            { value: "todo", label: "待辦" },
            { value: "doing", label: "進行中" },
            { value: "done", label: "已完成" },
          ]}
        />
        <select
          className="select select--sm"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value)}
          aria-label="優先級篩選"
        >
          <option value="all">所有優先級</option>
          <option value="3">高優先級</option>
          <option value="2">中優先級</option>
          <option value="1">低優先級</option>
          <option value="0">未設定</option>
        </select>
        <select
          className="select select--sm"
          value={listFilter}
          onChange={(event) => setListFilter(event.target.value)}
          aria-label="分類篩選"
        >
          <option value="all">全部分類</option>
          {lists.map((list) => (
            <option key={list} value={list}>
              {list}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "list", label: "清單", icon: <List size={13} /> },
            { value: "board", label: "看板", icon: <LayoutGrid size={13} /> },
          ]}
        />
        <button type="button" className="btn btn--primary btn--sm" onClick={() => openNew()}>
          <Plus size={14} /> 新增安排
        </button>
      </div>

      <form className="quick-add quick-add--wide" onSubmit={submitQuick}>
        <Plus size={15} />
        <input
          value={quickTitle}
          onChange={(event) => setQuickTitle(event.target.value)}
          placeholder="快速新增安排，按 Enter 儲存…"
          aria-label="快速新增安排"
        />
        {quickTitle.trim() ? (
          <button type="submit" className="mini-btn mini-btn--accent">
            新增
          </button>
        ) : null}
      </form>

      {allTasks.length === 0 ? (
        <EmptyState
          icon={<List size={22} />}
          title="還沒有任何安排"
          text="把腦中的待辦倒出來，再決定今天只需要完成哪一件。"
          action={
            <button type="button" className="btn btn--primary" onClick={() => openNew()}>
              <Plus size={15} /> 新增第一項安排
            </button>
          }
        />
      ) : mode === "list" ? (
        <div className="task-groups">
          {groups.every((group) => group.tasks.length === 0) ? (
            <p className="muted-inline">沒有符合條件的安排。</p>
          ) : (
            groups.map((group) =>
              group.tasks.length === 0 ? null : (
                <section className="task-group" key={group.key}>
                  <div className="task-group__head">
                    <h3>{group.label}</h3>
                    <span className="badge">{group.tasks.length}</span>
                  </div>
                  <div className="task-list">
                    {group.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onEdit={() => openEdit(task)}
                        onDelete={() => setConfirmDelete(task)}
                      />
                    ))}
                  </div>
                </section>
              ),
            )
          )}
        </div>
      ) : (
        <div className="board">
          {BOARD_COLUMNS.map((column) => {
            const columnTasks = filtered.filter((task) => task.status === column);
            return (
              <div
                key={column}
                className={`board__column ${overColumn === column ? "board__column--over" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOverColumn(column);
                }}
                onDragLeave={() => setOverColumn((current) => (current === column ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  void dropInto(column);
                }}
              >
                <div className="board__head">
                  <h3>{STATUS_LABEL[column]}</h3>
                  <span className="badge">{columnTasks.length}</span>
                </div>
                <div className="board__cards">
                  {columnTasks.map((task) => {
                    const overdue = column !== "done" && task.dueDate && task.dueDate < today;
                    return (
                      <div
                        key={task.id}
                        className={`task-card ${column === "done" ? "task-card--done" : ""} ${dragging === task.id ? "task-card--dragging" : ""}`}
                        draggable
                        onDragStart={(event) => {
                          setDragging(task.id);
                          event.dataTransfer.setData("text/plain", String(task.id));
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => openEdit(task)}
                      >
                        {task.priority > 0 ? (
                          <span className={`task-card__priority task-card__priority--${task.priority}`} />
                        ) : null}
                        <p className="task-card__title">{task.title}</p>
                        <div className="task-card__meta">
                          {task.dueDate ? (
                            <span className={`task__due ${overdue ? "task__due--late" : ""}`}>
                              <CalendarDays size={11} /> {dueLabel(task.dueDate)}
                            </span>
                          ) : null}
                          {task.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <button type="button" className="board__add" onClick={() => openNew(column)}>
                    <Plus size={13} /> 新增到{STATUS_LABEL[column]}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskForm
        open={formOpen}
        task={editing}
        initialStatus={initialStatus}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="刪除這項安排？"
        message={`「${confirmDelete?.title ?? ""}」將被永久刪除。`}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await actions.deleteTask(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
};
