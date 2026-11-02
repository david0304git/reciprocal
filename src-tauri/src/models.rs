use std::collections::HashMap;

use rusqlite::Row;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------- habits

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: i64,
    pub name: String,
    pub emoji: String,
    pub color: String,
    pub notes: String,
    /// daily | weekdays | times_per_week
    pub schedule: String,
    /// 1 = Monday … 7 = Sunday
    pub weekdays: Vec<u32>,
    pub weekly_target: i64,
    /// anytime | morning | afternoon | evening
    pub time_of_day: String,
    pub sort_order: i64,
    pub archived: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub emoji: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub schedule: String,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    #[serde(default)]
    pub weekly_target: i64,
    #[serde(default)]
    pub time_of_day: String,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitLog {
    pub id: i64,
    pub habit_id: i64,
    pub date: String,
    pub note: String,
    pub created_at: String,
}

// ---------------------------------------------------------------- timetable

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimetableBlock {
    pub id: i64,
    /// 1 = Monday … 5 = Friday
    pub day: i64,
    /// HH:MM
    pub start_time: String,
    /// HH:MM
    pub end_time: String,
    pub title: String,
    pub notes: String,
    pub color: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimetableInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub day: i64,
    pub start_time: String,
    pub end_time: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub color: String,
}

// ---------------------------------------------------------------- events

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventItem {
    pub id: i64,
    pub title: String,
    pub notes: String,
    /// YYYY-MM-DD
    pub date: String,
    /// HH:MM (None = all day)
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub all_day: bool,
    pub color: String,
    pub location: String,
    pub category: String,
    /// 'local' (created in Reciprocal) or 'apple' (imported from Apple Calendar)
    #[serde(default = "default_event_source")]
    pub source: String,
    #[serde(default)]
    pub external_id: Option<String>,
    #[serde(default)]
    pub external_calendar: Option<String>,
    #[serde(default)]
    pub external_calendar_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn default_event_source() -> String {
    "local".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub date: String,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub apple_calendar_id: Option<String>,
}

// ---------------------------------------------------------------- tasks

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub notes: String,
    /// todo | doing | done
    pub status: String,
    /// 0 none · 1 low · 2 medium · 3 high
    pub priority: i64,
    pub due_date: Option<String>,
    pub tags: Vec<String>,
    pub list: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub list: String,
}

// ---------------------------------------------------------------- payloads

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub habits: Vec<Habit>,
    pub logs: Vec<HabitLog>,
    pub events: Vec<EventItem>,
    pub tasks: Vec<Task>,
    pub timetable: Vec<TimetableBlock>,
    pub settings: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupData {
    pub version: i64,
    pub exported_at: String,
    pub habits: Vec<Habit>,
    pub logs: Vec<HabitLog>,
    pub events: Vec<EventItem>,
    #[serde(default)]
    pub timetable: Vec<TimetableBlock>,
    pub tasks: Vec<Task>,
    pub settings: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub db_path: String,
    pub data_dir: String,
    pub size_bytes: i64,
}

// ---------------------------------------------------------------- helpers

pub fn parse_weekdays(raw: &str) -> Vec<u32> {
    raw.split(',')
        .filter_map(|piece| piece.trim().parse::<u32>().ok())
        .filter(|day| (1..=7).contains(day))
        .collect()
}

pub fn weekdays_to_string(days: &[u32]) -> String {
    let mut sorted: Vec<u32> = days
        .iter()
        .copied()
        .filter(|day| (1..=7).contains(day))
        .collect();
    sorted.sort_unstable();
    sorted.dedup();
    sorted
        .iter()
        .map(|day| day.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

pub fn parse_tags(raw: &str) -> Vec<String> {
    let mut tags: Vec<String> = raw
        .split(',')
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();
    tags.dedup();
    tags
}

pub fn tags_to_string(tags: &[String]) -> String {
    let mut cleaned: Vec<String> = tags
        .iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();
    cleaned.dedup();
    cleaned.join(",")
}

pub fn row_to_habit(row: &Row<'_>) -> rusqlite::Result<Habit> {
    Ok(Habit {
        id: row.get("id")?,
        name: row.get("name")?,
        emoji: row.get("emoji")?,
        color: row.get("color")?,
        notes: row.get("notes")?,
        schedule: row.get("schedule")?,
        weekdays: parse_weekdays(&row.get::<_, String>("weekdays")?),
        weekly_target: row.get("weekly_target")?,
        time_of_day: row.get("time_of_day")?,
        sort_order: row.get("sort_order")?,
        archived: row.get::<_, i64>("archived")? != 0,
        created_at: row.get("created_at")?,
    })
}

pub fn row_to_log(row: &Row<'_>) -> rusqlite::Result<HabitLog> {
    Ok(HabitLog {
        id: row.get("id")?,
        habit_id: row.get("habit_id")?,
        date: row.get("date")?,
        note: row.get("note")?,
        created_at: row.get("created_at")?,
    })
}

pub fn row_to_event(row: &Row<'_>) -> rusqlite::Result<EventItem> {
    Ok(EventItem {
        id: row.get("id")?,
        title: row.get("title")?,
        notes: row.get("notes")?,
        date: row.get("date")?,
        start_time: row.get("start_time")?,
        end_time: row.get("end_time")?,
        all_day: row.get::<_, i64>("all_day")? != 0,
        color: row.get("color")?,
        location: row.get("location")?,
        category: row.get("category")?,
        source: row
            .get::<_, Option<String>>("source")?
            .unwrap_or_else(default_event_source),
        external_id: row.get("external_id")?,
        external_calendar: row.get("external_calendar")?,
        external_calendar_id: row.get("external_calendar_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn row_to_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        title: row.get("title")?,
        notes: row.get("notes")?,
        status: row.get("status")?,
        priority: row.get("priority")?,
        due_date: row.get("due_date")?,
        tags: parse_tags(&row.get::<_, String>("tags")?),
        list: row.get("list")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
        sort_order: row.get("sort_order")?,
    })
}

pub fn row_to_timetable(row: &Row<'_>) -> rusqlite::Result<TimetableBlock> {
    Ok(TimetableBlock {
        id: row.get("id")?,
        day: row.get("day")?,
        start_time: row.get("start_time")?,
        end_time: row.get("end_time")?,
        title: row.get("title")?,
        notes: row.get("notes")?,
        color: row.get("color")?,
        created_at: row.get("created_at")?,
    })
}
