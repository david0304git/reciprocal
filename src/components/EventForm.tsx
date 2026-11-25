import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { ConfirmDialog, DateField, Modal, TimeField } from "./ui";
import type { AppleCalendarInfo, EventItem } from "../lib/types";
import { formatShort, todayISO } from "../lib/date";
import {
  DEFAULT_EVENT_CATEGORIES,
  EVENT_CATEGORIES_KEY,
  readCustomEventCategories,
  serializeEventCategories,
} from "../lib/categories";

const COLORS = ["#5B7DB1", "#3F7C6A", "#D98A5F", "#B06AA0", "#C2A33C", "#B4493A"];

interface Props {
  open: boolean;
  event: EventItem | null;
  defaultDate: string;
  onClose: () => void;
}

export const EventForm: React.FC<Props> = ({ open, event, defaultDate, onClose }) => {
  const { actions, data } = useApp();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [category, setCategory] = useState("個人");
  const [color, setColor] = useState(COLORS[0]);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [appleCalendars, setAppleCalendars] = useState<AppleCalendarInfo[]>([]);
  const [appleCalendarId, setAppleCalendarId] = useState<string | null>(null);
  const [appleCalendarsLoading, setAppleCalendarsLoading] = useState(false);
  const readOnly = event?.source === "apple";
  const appleEnabled = data?.settings.appleSyncEnabled === "1";
  const dedicatedCalendarId = data?.settings.appleCalendarId ?? null;
  const useAppleCategories = appleEnabled && appleCalendars.length > 0;
  const customCategories = useMemo(
    () => readCustomEventCategories(data?.settings),
    [data?.settings],
  );
  // Built-ins first, then the user's own, then whatever this event already uses (so imported or
  // previously deleted categories still show up as selected instead of silently resetting).
  const categoryOptions = useMemo(() => {
    const options = [...DEFAULT_EVENT_CATEGORIES, ...customCategories];
    const current = event?.category ?? category;
    if (current && !options.includes(current)) options.push(current);
    return options;
  }, [customCategories, event?.category, category]);

  useEffect(() => {
    if (!open) return;
    setTitle(event?.title ?? "");
    setDate(event?.date ?? defaultDate ?? todayISO());
    setAllDay(event?.allDay ?? false);
    setStartTime(event?.startTime ?? "09:00");
    setEndTime(event?.endTime ?? "10:00");
    setCategory(event?.category ?? "個人");
    setColor(event?.color ?? COLORS[0]);
    setLocation(event?.location ?? "");
    setNotes(event?.notes ?? "");
    setSaving(false);
    setConfirmDelete(false);
    setAddingCategory(false);
    setCategoryDraft("");
  }, [open, event, defaultDate]);

  useEffect(() => {
    if (!open || !appleEnabled || event?.source === "apple") {
      setAppleCalendars([]);
      setAppleCalendarId(null);
      setAppleCalendarsLoading(false);
      return;
    }
    let cancelled = false;
    setAppleCalendarsLoading(true);
    api
      .appleCalendars()
      .then((response) => {
        if (cancelled) return;
        setAppleCalendars(response.eventCalendars);
        const preferred =
          event?.externalCalendarId ??
          dedicatedCalendarId ??
          response.eventCalendars[0]?.id ??
          null;
        setAppleCalendarId(preferred);
        const calendar = response.eventCalendars.find((item) => item.id === preferred);
        if (calendar) {
          setColor(calendar.color);
          setCategory(calendar.title);
        }
      })
      .catch(() => {
        if (!cancelled) setAppleCalendars([]);
      })
      .finally(() => {
        if (!cancelled) setAppleCalendarsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, appleEnabled, event, dedicatedCalendarId]);

  const chooseAppleCalendar = (calendar: AppleCalendarInfo) => {
    setAppleCalendarId(calendar.id);
    setColor(calendar.color);
    setCategory(calendar.title);
  };

  const submit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    const saved = await actions.saveEvent({
      id: event?.id,
      title,
      date,
      allDay,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      category,
      color,
      location,
      notes,
      appleCalendarId: useAppleCategories ? appleCalendarId : undefined,
    });
    setSaving(false);
    if (saved) onClose();
  };

  const updateCustomCategories = async (next: string[]) => {
    await actions.setSetting(EVENT_CATEGORIES_KEY, serializeEventCategories(next));
  };

  const submitCategory = async () => {
    const name = categoryDraft.trim().slice(0, 12);
    if (!name) return;
    if (!categoryOptions.includes(name)) {
      await updateCustomCategories([...customCategories, name]);
    }
    setCategory(name);
    setCategoryDraft("");
    setAddingCategory(false);
  };

  const removeCustomCategory = async (name: string) => {
    await updateCustomCategories(customCategories.filter((item) => item !== name));
    if (category === name) setCategory(DEFAULT_EVENT_CATEGORIES[0]);
  };


  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={event ? "編輯行程" : "新增行程"}
        subtitle={event ? undefined : "把重要的事放進日曆，讓一週有清楚的輪廓。"}
        width={520}
        footer={
          readOnly ? (
            <>
              <span className="spacer" />
              <button type="button" className="btn btn--primary" onClick={onClose}>
                關閉
              </button>
            </>
          ) : (
            <>
              {event ? (
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
                form="event-form"
                className="btn btn--primary"
                disabled={!title.trim() || saving}
              >
                {saving ? "儲存中…" : event ? "儲存變更" : "新增行程"}
              </button>
            </>
          )
        }
      >
        {readOnly && event ? (
          <div className="readonly-event">
            <span className="readonly-event__badge">Apple 日曆</span>
            <p className="readonly-event__title">{event.title}</p>
            <div className="readonly-event__row">
              <span className="readonly-event__label">日期</span>
              <span>
                {formatShort(event.date)}
                {event.allDay
                  ? " · 全天"
                  : ` · ${event.startTime ?? ""}${event.endTime ? ` – ${event.endTime}` : ""}`}
              </span>
            </div>
            {event.location ? (
              <div className="readonly-event__row">
                <span className="readonly-event__label">地點</span>
                <span>{event.location}</span>
              </div>
            ) : null}
            <div className="readonly-event__row">
              <span className="readonly-event__label">分類</span>
              <span>{event.category}</span>
            </div>
            {event.notes ? (
              <div className="readonly-event__row">
                <span className="readonly-event__label">備註</span>
                <span>{event.notes}</span>
              </div>
            ) : null}
            <p className="muted-inline">
              這個行程來自 Apple 日曆，請在 Apple 日曆中修改或刪除；下次同步時會更新。
            </p>
          </div>
        ) : (
        <form id="event-form" className="form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">標題</span>
            <input
              className="input"
              value={title}
              onChange={(changeEvent) => setTitle(changeEvent.target.value)}
              autoFocus
              maxLength={80}
            />
          </label>

          <div className="field-row field-row--date">
            <div className="field">
              <span className="field__label">日期</span>
              <DateField value={date} onChange={setDate} label="日期" />
            </div>
            <div className="field field--checkbox">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(changeEvent) => setAllDay(changeEvent.target.checked)}
                />
                <span>全天行程</span>
              </label>
            </div>
          </div>

          {!allDay ? (
            <div className="field-row field-row--times">
              <div className="field">
                <span className="field__label">開始</span>
                <TimeField value={startTime} onChange={setStartTime} label="開始時間" />
              </div>
              <div className="field">
                <span className="field__label">結束</span>
                <TimeField value={endTime} onChange={setEndTime} label="結束時間" />
              </div>
            </div>
          ) : null}

          {useAppleCategories ? (
            <div className="field">
              <span className="field__label">Apple 分類</span>
              <div className="apple-category-list">
                {appleCalendars.map((calendar) => (
                  <button
                    key={calendar.id}
                    type="button"
                    className={`apple-category ${
                      appleCalendarId === calendar.id ? "is-active" : ""
                    }`}
                    style={{ "--category-color": calendar.color } as React.CSSProperties}
                    onClick={() => chooseAppleCalendar(calendar)}
                  >
                    <span
                      className="apple-category__dot"
                      style={{ background: calendar.color }}
                    />
                    <span className="apple-category__name">{calendar.title}</span>
                    {calendar.id === dedicatedCalendarId ? (
                      <span className="apple-category__tag">預設</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <p className="form-hint">
                行程會寫入所選的 Apple 日曆，顏色跟隨該分類。
                {appleCalendarsLoading ? "（讀取分類中…）" : ""}
              </p>
            </div>
          ) : (
            <>
              <div className="field">
                <span className="field__label">分類</span>
                <div className="category-row">
                  {categoryOptions.map((item) => {
                    const custom = customCategories.includes(item);
                    return (
                      <span
                        key={item}
                        className={`category-chip${category === item ? " is-active" : ""}`}
                      >
                        <button
                          type="button"
                          className="category-chip__main"
                          onClick={() => setCategory(item)}
                          aria-pressed={category === item}
                        >
                          {item}
                        </button>
                        {custom ? (
                          <button
                            type="button"
                            className="category-chip__remove"
                            onClick={() => void removeCustomCategory(item)}
                            aria-label={`刪除分類「${item}」`}
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                  <span className="category-chip category-chip--add">
                    <button
                      type="button"
                      className="category-chip__main"
                      onClick={() => setAddingCategory((current) => !current)}
                      aria-expanded={addingCategory}
                    >
                      ＋ 自訂
                    </button>
                  </span>
                </div>
                {addingCategory ? (
                  <div className="category-add">
                    <input
                      className="input"
                      value={categoryDraft}
                      onChange={(changeEvent) => setCategoryDraft(changeEvent.target.value)}
                      maxLength={12}
                      aria-label="新分類名稱"
                      onKeyDown={(keyEvent) => {
                        if (keyEvent.key === "Enter") {
                          keyEvent.preventDefault();
                          void submitCategory();
                        }
                        if (keyEvent.key === "Escape") {
                          keyEvent.stopPropagation();
                          setAddingCategory(false);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--soft btn--sm"
                      onClick={() => void submitCategory()}
                      disabled={!categoryDraft.trim()}
                    >
                      新增
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setCategoryDraft("");
                        setAddingCategory(false);
                      }}
                    >
                      取消
                    </button>
                  </div>
                ) : null}
                <p className="form-hint">
                  自訂分類會存在本機資料庫，匯出備份時一併帶走。
                </p>
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
            </>
          )}

          <label className="field">
            <span className="field__label">地點（選填）</span>
            <input
              className="input"
              value={location}
              onChange={(changeEvent) => setLocation(changeEvent.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">備註（選填）</span>
            <textarea
              className="textarea"
              rows={3}
              value={notes}
              onChange={(changeEvent) => setNotes(changeEvent.target.value)}
            />
          </label>
        </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="刪除這個行程？"
        message="刪除後無法復原，但你可以從先前的備份還原。"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (event) await actions.deleteEvent(event.id);
          setConfirmDelete(false);
          onClose();
        }}
      />
    </>
  );
};
