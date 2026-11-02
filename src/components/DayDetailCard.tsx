import React, { useMemo, useState } from "react";
import { Clock, MapPin, Plus } from "lucide-react";
import { useApp } from "../lib/store";
import { formatFullWeekday, formatShort } from "../lib/date";
import { EventForm } from "./EventForm";
import type { EventItem } from "../lib/types";

interface Props {
  date: string;
}

export const DayDetailCard: React.FC<Props> = ({ date }) => {
  const { data } = useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);

  const events = useMemo(
    () =>
      (data?.events ?? [])
        .filter((event) => event.date === date)
        .sort((a, b) => {
          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
          return (a.startTime ?? "").localeCompare(b.startTime ?? "");
        }),
    [data?.events, date],
  );

  const openNewEvent = (event: EventItem | null = null) => {
    setEditingEvent(event);
    setFormOpen(true);
  };

  return (
    <section className="card day-detail day-detail--events">
      <div className="day-detail__head">
        <div>
          <p className="page__eyebrow">{formatFullWeekday(date)}</p>
          <h2 className="day-detail__title">{formatShort(date)}</h2>
          <p className="day-detail__meta">{events.length} 個行程</p>
        </div>
        <button type="button" className="btn btn--soft btn--sm" onClick={() => openNewEvent()}>
          <Plus size={14} /> 新增行程
        </button>
      </div>

      <div className="day-detail__grid day-detail__grid--single">
        <div className="panel-section">
          <div className="panel-section__head">
            <h3>行程</h3>
            <span className="badge">{events.length}</span>
          </div>
          {events.length === 0 ? (
            <p className="muted-inline">今天還沒有行程。</p>
          ) : (
            <ul className="event-list">
              {events.map((event) => (
                <li key={event.id}>
                  <button type="button" className="event-row" onClick={() => openNewEvent(event)}>
                    <span className="event-row__bar" style={{ background: event.color }} />
                    <span className="event-row__body">
                      <span className="event-row__title" title={event.title}>
                        {event.title}
                      </span>
                      <span className="event-row__meta">
                        <Clock size={11} />
                        {event.allDay
                          ? "全天"
                          : `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ""}`}
                        {event.location ? (
                          <>
                            <MapPin size={11} /> {event.location}
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="chip chip--tiny">{event.category}</span>
                    {event.source === "apple" ? (
                      <span className="chip chip--tiny chip--apple">Apple</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <EventForm
        open={formOpen}
        event={editingEvent}
        defaultDate={date}
        onClose={() => {
          setFormOpen(false);
          setEditingEvent(null);
        }}
      />
    </section>
  );
};
