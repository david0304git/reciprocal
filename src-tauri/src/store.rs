use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::*;

pub type Res<T> = Result<T, String>;

fn sql_err<E: std::fmt::Display>(err: E) -> String {
    format!("資料庫錯誤：{err}")
}

fn is_valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let digits_ok = bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit());
    if !digits_ok {
        return false;
    }
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

fn is_valid_time(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return false;
    }
    let hours: u32 = value[0..2].parse().unwrap_or(99);
    let minutes: u32 = value[3..5].parse().unwrap_or(99);
    hours < 24 && minutes < 60
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

// ---------------------------------------------------------------- reads

pub fn load_app(conn: &Connection) -> Res<AppData> {
    let mut habit_stmt = conn
        .prepare(
            "SELECT * FROM habits ORDER BY archived ASC, sort_order ASC, id ASC",
        )
        .map_err(sql_err)?;
    let habits: Vec<Habit> = habit_stmt
        .query_map([], row_to_habit)
        .map_err(sql_err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql_err)?;

    let mut log_stmt = conn
        .prepare("SELECT * FROM habit_logs ORDER BY date ASC, id ASC")
        .map_err(sql_err)?;
    let logs: Vec<HabitLog> = log_stmt
        .query_map([], row_to_log)
        .map_err(sql_err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql_err)?;

    let mut event_stmt = conn
        .prepare("SELECT * FROM events ORDER BY date ASC, all_day DESC, start_time ASC, id ASC")
        .map_err(sql_err)?;
    let events: Vec<EventItem> = event_stmt
        .query_map([], row_to_event)
        .map_err(sql_err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql_err)?;

    let mut task_stmt = conn
        .prepare("SELECT * FROM tasks ORDER BY sort_order ASC, id DESC")
        .map_err(sql_err)?;
    let tasks: Vec<Task> = task_stmt
        .query_map([], row_to_task)
        .map_err(sql_err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql_err)?;

    let mut timetable_stmt = conn
        .prepare("SELECT * FROM timetable ORDER BY day ASC, start_time ASC, id ASC")
        .map_err(sql_err)?;
    let timetable: Vec<TimetableBlock> = timetable_stmt
        .query_map([], row_to_timetable)
        .map_err(sql_err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql_err)?;

    let mut setting_stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(sql_err)?;
    let settings: HashMap<String, String> = setting_stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(sql_err)?
        .collect::<rusqlite::Result<HashMap<_, _>>>()
        .map_err(sql_err)?;

    Ok(AppData {
        habits,
        logs,
        events,
        tasks,
        timetable,
        settings,
    })
}

fn get_habit(conn: &Connection, id: i64) -> Res<Habit> {
    conn.query_row("SELECT * FROM habits WHERE id = ?1", params![id], row_to_habit)
        .optional()
        .map_err(sql_err)?
        .ok_or_else(|| "找不到這個習慣".to_string())
}

fn get_event(conn: &Connection, id: i64) -> Res<EventItem> {
    conn.query_row("SELECT * FROM events WHERE id = ?1", params![id], row_to_event)
        .optional()
        .map_err(sql_err)?
        .ok_or_else(|| "找不到這個行程".to_string())
}

fn get_task(conn: &Connection, id: i64) -> Res<Task> {
    conn.query_row("SELECT * FROM tasks WHERE id = ?1", params![id], row_to_task)
        .optional()
        .map_err(sql_err)?
        .ok_or_else(|| "找不到這項事務".to_string())
}

// ---------------------------------------------------------------- habits

pub fn save_habit(conn: &Connection, input: &HabitInput) -> Res<Habit> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("習慣名稱不能留空".into());
    }
    let emoji = if input.emoji.trim().is_empty() {
        "🌱".to_string()
    } else {
        input.emoji.trim().to_string()
    };
    let color = if is_hex_color(input.color.trim()) {
        input.color.trim().to_string()
    } else {
        "#3F7C6A".to_string()
    };
    let schedule = match input.schedule.as_str() {
        "weekdays" | "times_per_week" => input.schedule.clone(),
        _ => "daily".to_string(),
    };
    let weekdays = if input.weekdays.is_empty() {
        vec![1, 2, 3, 4, 5, 6, 7]
    } else {
        input.weekdays.clone()
    };
    let weekly_target = if input.weekly_target <= 0 {
        7
    } else {
        input.weekly_target.min(7)
    };
    let time_of_day = match input.time_of_day.as_str() {
        "morning" | "afternoon" | "evening" => input.time_of_day.clone(),
        _ => "anytime".to_string(),
    };
    let notes = input.notes.trim();
    let weekday_string = weekdays_to_string(&weekdays);
    let archived: i64 = if input.archived { 1 } else { 0 };

    match input.id {
        Some(id) => {
            let changed = conn
                .execute(
                    "UPDATE habits SET name = ?1, emoji = ?2, color = ?3, notes = ?4, schedule = ?5,
                        weekdays = ?6, weekly_target = ?7, time_of_day = ?8, archived = ?9
                     WHERE id = ?10",
                    params![
                        name,
                        emoji,
                        color,
                        notes,
                        schedule,
                        weekday_string,
                        weekly_target,
                        time_of_day,
                        archived,
                        id
                    ],
                )
                .map_err(sql_err)?;
            if changed == 0 {
                return Err("找不到要更新的習慣".into());
            }
            get_habit(conn, id)
        }
        None => {
            let next_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM habits",
                    [],
                    |row| row.get(0),
                )
                .map_err(sql_err)?;
            conn.execute(
                "INSERT INTO habits (name, emoji, color, notes, schedule, weekdays, weekly_target,
                    time_of_day, sort_order, archived)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    name,
                    emoji,
                    color,
                    notes,
                    schedule,
                    weekday_string,
                    weekly_target,
                    time_of_day,
                    next_order,
                    archived
                ],
            )
            .map_err(sql_err)?;
            get_habit(conn, conn.last_insert_rowid())
        }
    }
}

pub fn delete_habit(conn: &Connection, id: i64) -> Res<()> {
    conn.execute("DELETE FROM habits WHERE id = ?1", params![id])
        .map_err(sql_err)?;
    Ok(())
}

pub fn set_habit_archived(conn: &Connection, id: i64, archived: bool) -> Res<Habit> {
    conn.execute(
        "UPDATE habits SET archived = ?1 WHERE id = ?2",
        params![if archived { 1 } else { 0 }, id],
    )
    .map_err(sql_err)?;
    get_habit(conn, id)
}

pub fn set_habit_log(
    conn: &Connection,
    habit_id: i64,
    date: &str,
    present: bool,
    note: Option<&str>,
) -> Res<Option<HabitLog>> {
    if !is_valid_date(date) {
        return Err("日期格式必須是 YYYY-MM-DD".into());
    }
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM habits WHERE id = ?1",
            params![habit_id],
            |row| row.get(0),
        )
        .map_err(sql_err)?;
    if exists == 0 {
        return Err("找不到這個習慣".into());
    }

    if present {
        let note = note.unwrap_or("").trim();
        conn.execute(
            "INSERT INTO habit_logs (habit_id, date, note) VALUES (?1, ?2, ?3)
             ON CONFLICT(habit_id, date) DO UPDATE SET note = excluded.note",
            params![habit_id, date, note],
        )
        .map_err(sql_err)?;
        let log = conn
            .query_row(
                "SELECT * FROM habit_logs WHERE habit_id = ?1 AND date = ?2",
                params![habit_id, date],
                row_to_log,
            )
            .map_err(sql_err)?;
        Ok(Some(log))
    } else {
        conn.execute(
            "DELETE FROM habit_logs WHERE habit_id = ?1 AND date = ?2",
            params![habit_id, date],
        )
        .map_err(sql_err)?;
        Ok(None)
    }
}

// ---------------------------------------------------------------- events

pub fn save_event(conn: &Connection, input: &EventInput) -> Res<EventItem> {
    if let Some(id) = input.id {
        let source: Option<Option<String>> = conn
            .query_row("SELECT source FROM events WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(sql_err)?;
        if let Some(Some(source)) = source {
            if source == "apple" {
                return Err("此行程來自 Apple 日曆，請在 Apple 日曆中修改。".into());
            }
        }
    }
    let existing_calendar: Option<String> = match input.id {
        Some(id) => conn
            .query_row(
                "SELECT external_calendar_id FROM events WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(sql_err)?
            .flatten(),
        None => None,
    };
    let target_calendar = input.apple_calendar_id.clone().or(existing_calendar);

    let title = input.title.trim();
    if title.is_empty() {
        return Err("行程標題不能留空".into());
    }
    if !is_valid_date(input.date.trim()) {
        return Err("日期格式必須是 YYYY-MM-DD".into());
    }
    let start = normalise_time(input.start_time.as_deref())?;
    let end = normalise_time(input.end_time.as_deref())?;
    if let (Some(from), Some(to)) = (&start, &end) {
        if from > to {
            return Err("結束時間不能早於開始時間".into());
        }
    }
    let all_day = if input.all_day || start.is_none() { 1 } else { 0 };
    let color = if is_hex_color(input.color.trim()) {
        input.color.trim().to_string()
    } else {
        "#5B7DB1".to_string()
    };
    let category = if input.category.trim().is_empty() {
        "個人".to_string()
    } else {
        input.category.trim().to_string()
    };

    match input.id {
        Some(id) => {
            let changed = conn
                .execute(
                    "UPDATE events SET title = ?1, notes = ?2, date = ?3, start_time = ?4,
                        end_time = ?5, all_day = ?6, color = ?7, location = ?8, category = ?9,
                        external_calendar_id = ?10,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE id = ?11",
                    params![
                        title,
                        input.notes.trim(),
                        input.date.trim(),
                        start,
                        end,
                        all_day,
                        color,
                        input.location.trim(),
                        category,
                        target_calendar,
                        id
                    ],
                )
                .map_err(sql_err)?;
            if changed == 0 {
                return Err("找不到要更新的行程".into());
            }
            get_event(conn, id)
        }
        None => {
            conn.execute(
                "INSERT INTO events (title, notes, date, start_time, end_time, all_day, color,
                    location, category, external_calendar_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    title,
                    input.notes.trim(),
                    input.date.trim(),
                    start,
                    end,
                    all_day,
                    color,
                    input.location.trim(),
                    category,
                    target_calendar
                ],
            )
            .map_err(sql_err)?;
            get_event(conn, conn.last_insert_rowid())
        }
    }
}

fn normalise_time(value: Option<&str>) -> Res<Option<String>> {
    match value {
        Some(raw) if !raw.trim().is_empty() => {
            let trimmed = raw.trim();
            if !is_valid_time(trimmed) {
                return Err("時間格式必須是 HH:MM".into());
            }
            Ok(Some(trimmed.to_string()))
        }
        _ => Ok(None),
    }
}

pub fn delete_event(conn: &Connection, id: i64) -> Res<()> {
    let existing: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT source, external_id FROM events WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(sql_err)?;

    if let Some((source, external_id)) = existing {
        if source == "apple" {
            return Err("此行程來自 Apple 日曆，請在 Apple 日曆中刪除。".into());
        }
        if let Some(external_id) = external_id {
            conn.execute(
                "INSERT OR REPLACE INTO deleted_external_events (external_id, calendar_id)
                 VALUES (?1, NULL)",
                params![external_id],
            )
            .map_err(sql_err)?;
        }
    }

    conn.execute("DELETE FROM events WHERE id = ?1", params![id])
        .map_err(sql_err)?;
    Ok(())
}

// ---------------------------------------------------------------- apple sync

#[derive(Debug, Clone)]
pub struct ImportedEvent {
    pub external_id: String,
    pub calendar_id: String,
    pub calendar_title: String,
    pub color: String,
    pub title: String,
    pub notes: String,
    pub location: String,
    pub date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub all_day: bool,
}

/// Reconciles events imported from Apple Calendar (read-only in Reciprocal).
/// Local events are never touched by this function.
pub fn apply_imported_events(conn: &Connection, items: &[ImportedEvent]) -> Res<(usize, usize, usize)> {
    use std::collections::{HashMap, HashSet};

    let mut statement = conn
        .prepare("SELECT id, external_id FROM events WHERE source = 'apple' AND external_id IS NOT NULL")
        .map_err(sql_err)?;
    let existing: Vec<(i64, String)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(sql_err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql_err)?;
    let existing_map: HashMap<String, i64> = existing
        .iter()
        .map(|(id, external_id)| (external_id.clone(), *id))
        .collect();
    let incoming: HashSet<&str> = items.iter().map(|item| item.external_id.as_str()).collect();

    let mut inserted = 0usize;
    let mut updated = 0usize;
    for item in items {
        if item.date.is_empty() {
            continue;
        }
        if existing_map.contains_key(&item.external_id) {
            conn.execute(
                "UPDATE events SET title = ?1, notes = ?2, date = ?3, start_time = ?4,
                    end_time = ?5, all_day = ?6, location = ?7, category = ?8, color = ?9,
                    external_calendar = ?10, external_calendar_id = ?11,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE source = 'apple' AND external_id = ?12",
                params![
                    item.title,
                    item.notes,
                    item.date,
                    item.start_time,
                    item.end_time,
                    if item.all_day { 1 } else { 0 },
                    item.location,
                    item.calendar_title,
                    item.color,
                    item.calendar_title,
                    item.calendar_id,
                    item.external_id
                ],
            )
            .map_err(sql_err)?;
            updated += 1;
        } else {
            conn.execute(
                "INSERT INTO events (title, notes, date, start_time, end_time, all_day, color,
                    location, category, source, external_id, external_calendar, external_calendar_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'apple', ?10, ?11, ?12)",
                params![
                    item.title,
                    item.notes,
                    item.date,
                    item.start_time,
                    item.end_time,
                    if item.all_day { 1 } else { 0 },
                    item.color,
                    item.location,
                    item.calendar_title,
                    item.external_id,
                    item.calendar_title,
                    item.calendar_id
                ],
            )
            .map_err(sql_err)?;
            inserted += 1;
        }
    }

    let mut removed = 0usize;
    for (id, external_id) in existing {
        if !incoming.contains(external_id.as_str()) {
            conn.execute("DELETE FROM events WHERE id = ?1", params![id])
                .map_err(sql_err)?;
            removed += 1;
        }
    }

    Ok((inserted, updated, removed))
}

/// Local events that must be written to the Apple calendar.
pub fn push_candidates(conn: &Connection) -> Res<Vec<EventItem>> {
    let mut statement = conn
        .prepare(
            "SELECT * FROM events
             WHERE source = 'local'
               AND (external_id IS NULL OR synced_at IS NULL OR updated_at > synced_at)
             ORDER BY id ASC",
        )
        .map_err(sql_err)?;
    let items = statement
        .query_map([], row_to_event)
        .map_err(sql_err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql_err)?;
    Ok(items)
}

pub fn mark_event_synced(
    conn: &Connection,
    id: i64,
    external_id: &str,
    calendar_id: &str,
    calendar_title: &str,
) -> Res<()> {
    conn.execute(
        "UPDATE events SET external_id = ?1, external_calendar = ?2,
            external_calendar_id = ?3,
            synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?4",
        params![external_id, calendar_title, calendar_id, id],
    )
    .map_err(sql_err)?;
    Ok(())
}

pub fn local_external_ids(conn: &Connection) -> Res<std::collections::HashSet<String>> {
    let mut statement = conn
        .prepare("SELECT external_id FROM events WHERE source = 'local' AND external_id IS NOT NULL")
        .map_err(sql_err)?;
    let ids = statement
        .query_map([], |row| row.get(0))
        .map_err(sql_err)?
        .collect::<rusqlite::Result<std::collections::HashSet<String>>>()
        .map_err(sql_err)?;
    Ok(ids)
}

pub fn pending_tombstones(conn: &Connection) -> Res<Vec<String>> {
    let mut statement = conn
        .prepare("SELECT external_id FROM deleted_external_events ORDER BY created_at ASC")
        .map_err(sql_err)?;
    let items = statement
        .query_map([], |row| row.get(0))
        .map_err(sql_err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql_err)?;
    Ok(items)
}

pub fn clear_tombstone(conn: &Connection, external_id: &str) -> Res<()> {
    conn.execute(
        "DELETE FROM deleted_external_events WHERE external_id = ?1",
        params![external_id],
    )
    .map_err(sql_err)?;
    Ok(())
}

pub fn count_events_by_source(conn: &Connection, source: &str) -> Res<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE source = ?1",
        params![source],
        |row| row.get(0),
    )
    .map_err(sql_err)
}

pub fn count_mirrored_events(conn: &Connection) -> Res<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE source = 'local' AND external_id IS NOT NULL",
        [],
        |row| row.get(0),
    )
    .map_err(sql_err)
}

/// Apple import window in days (past, future). Defaults to 1 year each side.
pub fn apple_import_range_days(conn: &Connection) -> Res<(i64, i64)> {
    fn read(conn: &Connection, key: &str, default: i64) -> Res<i64> {
        let value = get_setting(conn, key)?
            .and_then(|raw| raw.parse::<i64>().ok())
            .unwrap_or(default);
        Ok(value.clamp(1, 3650))
    }
    Ok((
        read(conn, "appleImportPastDays", 365)?,
        read(conn, "appleImportFutureDays", 365)?,
    ))
}

pub fn get_setting(conn: &Connection, key: &str) -> Res<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(sql_err)
}

// ---------------------------------------------------------------- tasks

pub fn save_task(conn: &Connection, input: &TaskInput) -> Res<Task> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("事務標題不能留空".into());
    }
    let status = match input.status.as_str() {
        "doing" | "done" => input.status.clone(),
        _ => "todo".to_string(),
    };
    let priority = input.priority.clamp(0, 3);
    let due_date = match input.due_date.as_deref() {
        Some(raw) if !raw.trim().is_empty() => {
            let trimmed = raw.trim();
            if !is_valid_date(trimmed) {
                return Err("截止日期格式必須是 YYYY-MM-DD".into());
            }
            Some(trimmed.to_string())
        }
        _ => None,
    };
    let tags = tags_to_string(&input.tags);
    let list = if input.list.trim().is_empty() {
        "個人".to_string()
    } else {
        input.list.trim().to_string()
    };
    match input.id {
        Some(id) => {
            let changed = conn
                .execute(
                    "UPDATE tasks SET title = ?1, notes = ?2, status = ?3, priority = ?4,
                        due_date = ?5, tags = ?6, list = ?7,
                        completed_at = CASE WHEN ?3 = 'done' THEN COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END
                     WHERE id = ?8",
                    params![
                        title,
                        input.notes.trim(),
                        status,
                        priority,
                        due_date,
                        tags,
                        list,
                        id
                    ],
                )
                .map_err(sql_err)?;
            if changed == 0 {
                return Err("找不到要更新的事務".into());
            }
            get_task(conn, id)
        }
        None => {
            let next_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks",
                    [],
                    |row| row.get(0),
                )
                .map_err(sql_err)?;
            conn.execute(
                "INSERT INTO tasks (title, notes, status, priority, due_date, tags, list,
                    completed_at, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    CASE WHEN ?3 = 'done' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
                    ?8)",
                params![
                    title,
                    input.notes.trim(),
                    status,
                    priority,
                    due_date,
                    tags,
                    list,
                    next_order
                ],
            )
            .map_err(sql_err)?;
            get_task(conn, conn.last_insert_rowid())
        }
    }
}

pub fn set_task_status(conn: &Connection, id: i64, status: &str) -> Res<Task> {
    let status = match status {
        "todo" | "doing" | "done" => status,
        _ => return Err("未知的事務狀態".into()),
    };
    conn.execute(
        "UPDATE tasks SET status = ?1,
            completed_at = CASE WHEN ?1 = 'done' THEN COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END
         WHERE id = ?2",
        params![status, id],
    )
    .map_err(sql_err)?;
    get_task(conn, id)
}

pub fn delete_task(conn: &Connection, id: i64) -> Res<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(sql_err)?;
    Ok(())
}

// ---------------------------------------------------------------- timetable

fn get_timetable(conn: &Connection, id: i64) -> Res<TimetableBlock> {
    conn.query_row(
        "SELECT * FROM timetable WHERE id = ?1",
        params![id],
        row_to_timetable,
    )
    .optional()
    .map_err(sql_err)?
    .ok_or_else(|| "找不到這項安排".to_string())
}

pub fn save_timetable(conn: &Connection, input: &TimetableInput) -> Res<TimetableBlock> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("安排標題不能留空".into());
    }
    if !(1..=5).contains(&input.day) {
        return Err("固定安排只支援星期一至星期五".into());
    }
    let start = normalise_time(Some(&input.start_time))?
        .ok_or_else(|| "請填寫開始時間".to_string())?;
    let end = normalise_time(Some(&input.end_time))?.ok_or_else(|| "請填寫結束時間".to_string())?;
    if end <= start {
        return Err("結束時間必須晚於開始時間".into());
    }
    let color = if is_hex_color(input.color.trim()) {
        input.color.trim().to_string()
    } else {
        "#5B7DB1".to_string()
    };

    match input.id {
        Some(id) => {
            let changed = conn
                .execute(
                    "UPDATE timetable SET day = ?1, start_time = ?2, end_time = ?3, title = ?4,
                        notes = ?5, color = ?6
                     WHERE id = ?7",
                    params![
                        input.day,
                        start,
                        end,
                        title,
                        input.notes.trim(),
                        color,
                        id
                    ],
                )
                .map_err(sql_err)?;
            if changed == 0 {
                return Err("找不到要更新的安排".into());
            }
            get_timetable(conn, id)
        }
        None => {
            conn.execute(
                "INSERT INTO timetable (day, start_time, end_time, title, notes, color)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![input.day, start, end, title, input.notes.trim(), color],
            )
            .map_err(sql_err)?;
            get_timetable(conn, conn.last_insert_rowid())
        }
    }
}

pub fn delete_timetable(conn: &Connection, id: i64) -> Res<()> {
    conn.execute("DELETE FROM timetable WHERE id = ?1", params![id])
        .map_err(sql_err)?;
    Ok(())
}

// ---------------------------------------------------------------- settings

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Res<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(sql_err)?;
    Ok(())
}

// ---------------------------------------------------------------- backup

pub fn export_backup(conn: &Connection, path: &str) -> Res<String> {
    let data = load_app(conn)?;
    let exported_at: String = conn
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })
        .map_err(sql_err)?;
    let backup = BackupData {
        version: 1,
        exported_at,
        habits: data.habits,
        logs: data.logs,
        events: data.events,
        tasks: data.tasks,
        timetable: data.timetable,
        settings: data.settings,
    };
    let json = serde_json::to_string_pretty(&backup)
        .map_err(|err| format!("序列化備份失敗：{err}"))?;
    std::fs::write(path, json).map_err(|err| format!("寫入備份檔失敗：{err}"))?;
    Ok(path.to_string())
}

pub fn import_backup(conn: &Connection, path: &str) -> Res<AppData> {
    let raw = std::fs::read_to_string(path).map_err(|err| format!("讀取備份檔失敗：{err}"))?;
    let backup: BackupData =
        serde_json::from_str(&raw).map_err(|err| format!("備份檔格式不正確：{err}"))?;

    let tx = conn.unchecked_transaction().map_err(sql_err)?;
    tx.execute_batch(
        "DELETE FROM habit_logs; DELETE FROM habits; DELETE FROM events; DELETE FROM tasks;
         DELETE FROM timetable; DELETE FROM settings;",
    )
    .map_err(sql_err)?;

    for habit in &backup.habits {
        tx.execute(
            "INSERT INTO habits (id, name, emoji, color, notes, schedule, weekdays, weekly_target,
                time_of_day, sort_order, archived, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                habit.id,
                habit.name,
                habit.emoji,
                habit.color,
                habit.notes,
                habit.schedule,
                weekdays_to_string(&habit.weekdays),
                habit.weekly_target,
                habit.time_of_day,
                habit.sort_order,
                if habit.archived { 1 } else { 0 },
                habit.created_at
            ],
        )
        .map_err(sql_err)?;
    }
    for log in &backup.logs {
        tx.execute(
            "INSERT INTO habit_logs (id, habit_id, date, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![log.id, log.habit_id, log.date, log.note, log.created_at],
        )
        .map_err(sql_err)?;
    }
    for event in &backup.events {
        tx.execute(
            "INSERT INTO events (id, title, notes, date, start_time, end_time, all_day, color,
                location, category, source, external_id, external_calendar, external_calendar_id,
                created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                event.id,
                event.title,
                event.notes,
                event.date,
                event.start_time,
                event.end_time,
                if event.all_day { 1 } else { 0 },
                event.color,
                event.location,
                event.category,
                event.source,
                event.external_id,
                event.external_calendar,
                event.external_calendar_id,
                event.created_at,
                event.updated_at
            ],
        )
        .map_err(sql_err)?;
    }
    for task in &backup.tasks {
        tx.execute(
            "INSERT INTO tasks (id, title, notes, status, priority, due_date, tags, list,
                created_at, completed_at, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                task.id,
                task.title,
                task.notes,
                task.status,
                task.priority,
                task.due_date,
                tags_to_string(&task.tags),
                task.list,
                task.created_at,
                task.completed_at,
                task.sort_order
            ],
        )
        .map_err(sql_err)?;
    }
    for block in &backup.timetable {
        tx.execute(
            "INSERT INTO timetable (id, day, start_time, end_time, title, notes, color, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                block.id,
                block.day,
                block.start_time,
                block.end_time,
                block.title,
                block.notes,
                block.color,
                block.created_at
            ],
        )
        .map_err(sql_err)?;
    }
    for (key, value) in &backup.settings {
        tx.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(sql_err)?;
    }
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('onboarded', '1')
         ON CONFLICT(key) DO UPDATE SET value = '1'",
        [],
    )
    .map_err(sql_err)?;
    tx.commit().map_err(sql_err)?;

    load_app(conn)
}

// ---------------------------------------------------------------- maintenance

pub fn clear_all(conn: &Connection) -> Res<AppData> {
    conn.execute_batch(
        "DELETE FROM habit_logs; DELETE FROM habits; DELETE FROM events; DELETE FROM tasks;
         DELETE FROM timetable; DELETE FROM settings; DELETE FROM deleted_external_events;
         INSERT INTO settings (key, value) VALUES ('onboarded', '1');",
    )
    .map_err(sql_err)?;
    // Keep the AUTOINCREMENT counters tidy for a fresh start.
    let _ = conn.execute_batch("DELETE FROM sqlite_sequence;");
    load_app(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn habit_input(name: &str) -> HabitInput {
        HabitInput {
            id: None,
            name: name.to_string(),
            emoji: "🌱".to_string(),
            color: "#3F7C6A".to_string(),
            notes: String::new(),
            schedule: "daily".to_string(),
            weekdays: vec![],
            weekly_target: 0,
            time_of_day: String::new(),
            archived: false,
        }
    }

    #[test]
    fn habit_create_defaults_and_log_toggle() {
        let conn = db::open_in_memory().unwrap();
        let habit = save_habit(&conn, &habit_input("喝水")).unwrap();
        assert_eq!(habit.name, "喝水");
        assert_eq!(habit.weekdays, vec![1, 2, 3, 4, 5, 6, 7]);
        assert_eq!(habit.weekly_target, 7);
        assert_eq!(habit.schedule, "daily");

        let first = set_habit_log(&conn, habit.id, "2026-11-02", true, None).unwrap();
        assert!(first.is_some());
        let again = set_habit_log(&conn, habit.id, "2026-11-02", true, Some("  有喝水  "))
            .unwrap()
            .unwrap();
        assert_eq!(again.note, "有喝水");
        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM habit_logs WHERE habit_id = ?1",
                params![habit.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1, "same day stays a single log");

        let removed = set_habit_log(&conn, habit.id, "2026-11-02", false, None).unwrap();
        assert!(removed.is_none());
        assert!(set_habit_log(&conn, habit.id, "2026/11/02", true, None).is_err());
        assert!(set_habit_log(&conn, 99_999, "2026-11-02", true, None).is_err());
        assert!(save_habit(&conn, &habit_input("   ")).is_err());
    }

    #[test]
    fn habit_update_and_archive_roundtrip() {
        let conn = db::open_in_memory().unwrap();
        let habit = save_habit(&conn, &habit_input("閱讀")).unwrap();
        let mut input = habit_input("閱讀 20 分鐘");
        input.id = Some(habit.id);
        input.schedule = "times_per_week".to_string();
        input.weekly_target = 3;
        input.weekdays = vec![1, 3, 5];
        input.time_of_day = "evening".to_string();
        let updated = save_habit(&conn, &input).unwrap();
        assert_eq!(updated.name, "閱讀 20 分鐘");
        assert_eq!(updated.schedule, "times_per_week");
        assert_eq!(updated.weekly_target, 3);
        assert_eq!(updated.weekdays, vec![1, 3, 5]);
        assert_eq!(updated.time_of_day, "evening");

        let archived = set_habit_archived(&conn, habit.id, true).unwrap();
        assert!(archived.archived);
        let app = load_app(&conn).unwrap();
        assert!(app.habits.iter().find(|h| h.id == habit.id).unwrap().archived);

        delete_habit(&conn, habit.id).unwrap();
        let app = load_app(&conn).unwrap();
        assert!(app.habits.iter().all(|h| h.id != habit.id));
    }

    #[test]
    fn tasks_and_events_flow() {
        let conn = db::open_in_memory().unwrap();
        let task = save_task(
            &conn,
            &TaskInput {
                id: None,
                title: "整理照片".into(),
                notes: "備份".into(),
                status: "todo".into(),
                priority: 2,
                due_date: Some("2026-11-04".into()),
                tags: vec!["數位".into(), "生活".into()],
                list: "個人".into(),
            },
        )
        .unwrap();
        assert_eq!(task.status, "todo");
        assert_eq!(task.tags, vec!["數位", "生活"]);

        let done = set_task_status(&conn, task.id, "done").unwrap();
        assert_eq!(done.status, "done");
        assert!(done.completed_at.is_some());

        let reopened = set_task_status(&conn, task.id, "todo").unwrap();
        assert!(reopened.completed_at.is_none());

        let mut bad = TaskInput {
            id: None,
            title: "壞日期".into(),
            notes: String::new(),
            status: "todo".into(),
            priority: 0,
            due_date: Some("11/20/2026".into()),
            tags: vec![],
            list: String::new(),
        };
        assert!(save_task(&conn, &bad).is_err());
        bad.due_date = None;
        assert!(save_task(&conn, &bad).is_ok());

        let event = save_event(
            &conn,
            &EventInput {
                id: None,
                title: "午餐".into(),
                notes: String::new(),
                date: "2026-11-03".into(),
                start_time: Some("12:30".into()),
                end_time: Some("14:00".into()),
                all_day: false,
                color: "#D98A5F".into(),
                location: "巷口".into(),
                category: "社交".into(),
                apple_calendar_id: None,
            },
        )
        .unwrap();
        assert_eq!(event.start_time.as_deref(), Some("12:30"));

        let backwards = EventInput {
            id: None,
            title: "倒過來".into(),
            notes: String::new(),
            date: "2026-11-03".into(),
            start_time: Some("15:00".into()),
            end_time: Some("14:00".into()),
            all_day: false,
            color: String::new(),
            location: String::new(),
            category: String::new(),
            apple_calendar_id: None,
        };
        assert!(save_event(&conn, &backwards).is_err());

        delete_task(&conn, task.id).unwrap();
        delete_event(&conn, event.id).unwrap();
        let app = load_app(&conn).unwrap();
        assert!(app.tasks.iter().all(|t| t.id != task.id));
        assert!(app.events.iter().all(|e| e.id != event.id));
    }

    #[test]
    fn backup_export_import_roundtrip() {
        let conn = db::open_in_memory().unwrap();
        let habit = save_habit(&conn, &habit_input("冥想")).unwrap();
        set_habit_log(&conn, habit.id, "2026-11-02", true, Some("十分鐘")).unwrap();
        let task = save_task(
            &conn,
            &TaskInput {
                id: None,
                title: "備份測試".into(),
                notes: String::new(),
                status: "doing".into(),
                priority: 1,
                due_date: None,
                tags: vec!["test".into()],
                list: "工作".into(),
            },
        )
        .unwrap();

        let block = save_timetable(
            &conn,
            &TimetableInput {
                id: None,
                day: 2,
                start_time: "10:00".to_string(),
                end_time: "11:30".to_string(),
                title: "備份用安排".to_string(),
                notes: String::new(),
                color: "#5B7DB1".to_string(),
            },
        )
        .unwrap();

        let before = load_app(&conn).unwrap();
        let path = std::env::temp_dir().join("reciprocal-backup-roundtrip.json");
        let path_string = path.to_string_lossy().to_string();
        export_backup(&conn, &path_string).unwrap();
        assert!(path.exists());

        let cleared = clear_all(&conn).unwrap();
        assert!(cleared.habits.is_empty());
        assert!(cleared.tasks.is_empty());
        assert!(cleared.logs.is_empty());

        let restored = import_backup(&conn, &path_string).unwrap();
        assert_eq!(restored.habits.len(), before.habits.len());
        assert_eq!(restored.tasks.len(), before.tasks.len());
        assert_eq!(restored.logs.len(), before.logs.len());
        assert_eq!(restored.timetable.len(), before.timetable.len());
        let restored_block = restored.timetable.iter().find(|b| b.id == block.id).unwrap();
        assert_eq!(restored_block.title, "備份用安排");
        assert_eq!(restored_block.day, 2);
        assert_eq!(restored_block.end_time, "11:30");

        let restored_task = restored.tasks.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(restored_task.tags, vec!["test"]);
        let restored_log = restored
            .logs
            .iter()
            .find(|l| l.habit_id == habit.id && l.date == "2026-11-02")
            .unwrap();
        assert_eq!(restored_log.note, "十分鐘");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn timetable_crud_and_validation() {
        let conn = db::open_in_memory().unwrap();
        let seeded = load_app(&conn).unwrap().timetable.len();
        assert_eq!(seeded, 6, "seeded weekly blocks");

        let block = save_timetable(
            &conn,
            &TimetableInput {
                id: None,
                day: 3,
                start_time: "08:00".to_string(),
                end_time: "09:30".to_string(),
                title: "  晨間閱讀  ".to_string(),
                notes: String::new(),
                color: String::new(),
            },
        )
        .unwrap();
        assert_eq!(block.title, "晨間閱讀");
        assert_eq!(block.start_time, "08:00");
        assert_eq!(block.end_time, "09:30");
        assert_eq!(block.color, "#5B7DB1", "invalid colour falls back");

        let mut input = TimetableInput {
            id: Some(block.id),
            day: 5,
            start_time: "18:00".to_string(),
            end_time: "19:00".to_string(),
            title: "週回顧".to_string(),
            notes: "寫筆記".to_string(),
            color: "#3F7C6A".to_string(),
        };
        let updated = save_timetable(&conn, &input).unwrap();
        assert_eq!(updated.day, 5);
        assert_eq!(updated.title, "週回顧");
        assert_eq!(updated.color, "#3F7C6A");

        input.id = None;

        input.title = "   ".to_string();
        assert!(save_timetable(&conn, &input).is_err(), "empty title");

        input.title = "測試".to_string();
        input.end_time = "17:00".to_string();
        assert!(save_timetable(&conn, &input).is_err(), "end before start");

        input.end_time = "19:00".to_string();
        input.day = 6;
        assert!(save_timetable(&conn, &input).is_err(), "weekend not allowed");

        input.day = 1;
        input.start_time = "8:00".to_string();
        assert!(save_timetable(&conn, &input).is_err(), "time must be HH:MM");

        delete_timetable(&conn, block.id).unwrap();
        assert_eq!(load_app(&conn).unwrap().timetable.len(), seeded);
    }

    #[test]
    fn imports_backup_without_timetable_field() {
        let conn = db::open_in_memory().unwrap();
        let path = std::env::temp_dir().join("reciprocal-v1-backup.json");
        let legacy = r#"{
            "version": 1,
            "exportedAt": "2026-10-01T00:00:00.000Z",
            "habits": [],
            "logs": [],
            "events": [],
            "tasks": [],
            "settings": {"theme": "dark"}
        }"#;
        std::fs::write(&path, legacy).unwrap();

        let restored = import_backup(&conn, path.to_string_lossy().as_ref()).unwrap();
        assert!(restored.habits.is_empty());
        assert!(restored.timetable.is_empty(), "old backups default to an empty timetable");
        assert_eq!(restored.settings.get("theme").map(String::as_str), Some("dark"));

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM timetable", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        let _ = std::fs::remove_file(&path);
    }

    fn event_input(title: &str, date: &str) -> EventInput {
        EventInput {
            id: None,
            title: title.to_string(),
            notes: String::new(),
            date: date.to_string(),
            start_time: Some("10:00".to_string()),
            end_time: Some("11:00".to_string()),
            all_day: false,
            color: "#5B7DB1".to_string(),
            location: String::new(),
            category: "個人".to_string(),
            apple_calendar_id: None,
        }
    }

    fn imported_item(external_id: &str, title: &str) -> ImportedEvent {
        ImportedEvent {
            external_id: external_id.to_string(),
            calendar_id: "CAL".to_string(),
            calendar_title: "工作".to_string(),
            color: "#3F7C6A".to_string(),
            title: title.to_string(),
            notes: String::new(),
            location: String::new(),
            date: "2026-11-10".to_string(),
            start_time: Some("09:00".to_string()),
            end_time: Some("10:00".to_string()),
            all_day: false,
        }
    }

    #[test]
    fn imported_events_are_reconciled_and_local_events_preserved() {
        let conn = db::open_in_memory().unwrap();
        let local = save_event(&conn, &event_input("本機行程", "2026-11-09")).unwrap();
        assert_eq!(local.source, "local");
        assert!(local.external_id.is_none());

        let (inserted, updated, removed) =
            apply_imported_events(&conn, &[imported_item("A1", "Apple 會議")]).unwrap();
        assert_eq!((inserted, updated, removed), (1, 0, 0));

        let imported = load_app(&conn)
            .unwrap()
            .events
            .into_iter()
            .find(|event| event.external_id.as_deref() == Some("A1"))
            .unwrap();
        assert_eq!(imported.source, "apple");
        assert_eq!(imported.title, "Apple 會議");
        assert_eq!(imported.category, "工作");
        assert_eq!(imported.color, "#3F7C6A");
        assert_eq!(imported.external_calendar_id.as_deref(), Some("CAL"));

        let (inserted, updated, removed) =
            apply_imported_events(&conn, &[imported_item("A1", "Apple 會議（改）")]).unwrap();
        assert_eq!((inserted, updated, removed), (0, 1, 0));

        let (inserted, updated, removed) = apply_imported_events(&conn, &[]).unwrap();
        assert_eq!((inserted, updated, removed), (0, 0, 1));

        let app = load_app(&conn).unwrap();
        assert!(app
            .events
            .iter()
            .all(|event| event.external_id.as_deref() != Some("A1")));
        assert!(app.events.iter().any(|event| event.id == local.id));

        // A second empty reconciliation must not keep removing rows.
        assert_eq!(apply_imported_events(&conn, &[]).unwrap(), (0, 0, 0));
    }

    #[test]
    fn apple_events_are_read_only_and_deletions_become_tombstones() {
        let conn = db::open_in_memory().unwrap();
        apply_imported_events(&conn, &[imported_item("A2", "唯讀行程")]).unwrap();
        let imported = load_app(&conn)
            .unwrap()
            .events
            .into_iter()
            .find(|event| event.external_id.as_deref() == Some("A2"))
            .unwrap();

        assert!(delete_event(&conn, imported.id).is_err());
        let mut edit = event_input("改標題", &imported.date);
        edit.id = Some(imported.id);
        assert!(save_event(&conn, &edit).is_err());
        assert!(load_app(&conn)
            .unwrap()
            .events
            .iter()
            .any(|event| event.external_id.as_deref() == Some("A2")));

        let local = save_event(&conn, &event_input("會被同步的本機行程", "2026-11-12")).unwrap();
        mark_event_synced(&conn, local.id, "EXT-1", "CAL", "工作").unwrap();
        delete_event(&conn, local.id).unwrap();
        assert_eq!(
            pending_tombstones(&conn).unwrap(),
            vec!["EXT-1".to_string()]
        );
        clear_tombstone(&conn, "EXT-1").unwrap();
        assert!(pending_tombstones(&conn).unwrap().is_empty());
    }

    #[test]
    fn push_candidates_only_include_new_or_changed_local_events() {
        let conn = db::open_in_memory().unwrap();
        let local = save_event(&conn, &event_input("同步測試", "2026-11-15")).unwrap();
        assert!(push_candidates(&conn)
            .unwrap()
            .iter()
            .any(|event| event.id == local.id));

        mark_event_synced(&conn, local.id, "EXT-2", "CAL", "工作").unwrap();
        assert!(!push_candidates(&conn)
            .unwrap()
            .iter()
            .any(|event| event.id == local.id));

        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut edit = event_input("同步測試（改）", "2026-11-15");
        edit.id = Some(local.id);
        save_event(&conn, &edit).unwrap();
        assert!(push_candidates(&conn)
            .unwrap()
            .iter()
            .any(|event| event.id == local.id));

        assert_eq!(count_events_by_source(&conn, "apple").unwrap(), 0);
        assert_eq!(count_mirrored_events(&conn).unwrap(), 1);
    }

    #[test]
    fn apple_import_range_defaults_and_overrides() {
        let conn = db::open_in_memory().unwrap();
        assert_eq!(apple_import_range_days(&conn).unwrap(), (365, 365));

        set_setting(&conn, "appleImportPastDays", "90").unwrap();
        set_setting(&conn, "appleImportFutureDays", "30").unwrap();
        assert_eq!(apple_import_range_days(&conn).unwrap(), (90, 30));

        set_setting(&conn, "appleImportPastDays", "99999").unwrap();
        set_setting(&conn, "appleImportFutureDays", "broken").unwrap();
        assert_eq!(apple_import_range_days(&conn).unwrap(), (3650, 365));
    }

    #[test]
    fn local_event_keeps_selected_apple_calendar() {
        let conn = db::open_in_memory().unwrap();
        let mut input = event_input("分類行程", "2026-11-20");
        input.apple_calendar_id = Some("CAL-WORK".to_string());
        let event = save_event(&conn, &input).unwrap();
        assert_eq!(event.external_calendar_id.as_deref(), Some("CAL-WORK"));
        assert!(event.external_id.is_none());

        let mut edit = event_input("分類行程（改）", "2026-11-20");
        edit.id = Some(event.id);
        edit.apple_calendar_id = Some("CAL-HOME".to_string());
        let updated = save_event(&conn, &edit).unwrap();
        assert_eq!(updated.external_calendar_id.as_deref(), Some("CAL-HOME"));

        // Editing without a calendar choice keeps the previous target.
        let mut keep = event_input("分類行程（再改）", "2026-11-21");
        keep.id = Some(event.id);
        let updated = save_event(&conn, &keep).unwrap();
        assert_eq!(updated.external_calendar_id.as_deref(), Some("CAL-HOME"));
    }

    #[test]
    fn local_external_ids_exclude_imported_events() {
        let conn = db::open_in_memory().unwrap();
        let local = save_event(&conn, &event_input("本機", "2026-11-22")).unwrap();
        mark_event_synced(&conn, local.id, "EXT-LOCAL", "CAL", "工作").unwrap();
        apply_imported_events(&conn, &[imported_item("EXT-IMPORTED", "匯入")]).unwrap();

        let ids = local_external_ids(&conn).unwrap();
        assert!(ids.contains("EXT-LOCAL"));
        assert!(!ids.contains("EXT-IMPORTED"));
    }

    #[test]
    fn settings_are_upserted() {
        let conn = db::open_in_memory().unwrap();
        set_setting(&conn, "theme", "dark").unwrap();
        set_setting(&conn, "theme", "light").unwrap();
        set_setting(&conn, "weekStart", "0").unwrap();
        let app = load_app(&conn).unwrap();
        assert_eq!(app.settings.get("theme").map(String::as_str), Some("light"));
        assert_eq!(app.settings.get("weekStart").map(String::as_str), Some("0"));
    }
}
