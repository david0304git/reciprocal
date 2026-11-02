use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{Duration as ChronoDuration, Local, NaiveDate, NaiveTime, TimeZone};
use rusqlite::Connection;
use tauri::State;

#[cfg(target_os = "macos")]
use crate::apple;
use crate::models::*;
use crate::store;

pub struct DbState {
    pub conn: Mutex<Connection>,
    pub path: PathBuf,
}

pub type CmdResult<T> = Result<T, String>;

fn with_conn<T>(
    db: &State<'_, DbState>,
    run: impl FnOnce(&Connection) -> CmdResult<T>,
) -> CmdResult<T> {
    let guard = db
        .conn
        .lock()
        .map_err(|_| "資料庫忙碌中，請再試一次".to_string())?;
    run(&guard)
}

#[tauri::command]
pub fn load_app(db: State<'_, DbState>) -> CmdResult<AppData> {
    let data = with_conn(&db, store::load_app)?;
    if cfg!(debug_assertions) || std::env::var_os("RECIPROCAL_LOG").is_some() {
        eprintln!(
            "[reciprocal] ui ready: {} habits, {} logs, {} tasks",
            data.habits.len(),
            data.logs.len(),
            data.tasks.len()
        );
    }
    Ok(data)
}

#[tauri::command]
pub fn save_habit(db: State<'_, DbState>, habit: HabitInput) -> CmdResult<Habit> {
    with_conn(&db, |conn| store::save_habit(conn, &habit))
}

#[tauri::command]
pub fn delete_habit(db: State<'_, DbState>, id: i64) -> CmdResult<()> {
    with_conn(&db, |conn| store::delete_habit(conn, id))
}

#[tauri::command]
pub fn set_habit_archived(db: State<'_, DbState>, id: i64, archived: bool) -> CmdResult<Habit> {
    with_conn(&db, |conn| store::set_habit_archived(conn, id, archived))
}

#[tauri::command]
pub fn set_habit_log(
    db: State<'_, DbState>,
    habit_id: i64,
    date: String,
    present: bool,
    note: Option<String>,
) -> CmdResult<Option<HabitLog>> {
    with_conn(&db, |conn| {
        store::set_habit_log(conn, habit_id, &date, present, note.as_deref())
    })
}

#[tauri::command]
pub fn save_event(db: State<'_, DbState>, event: EventInput) -> CmdResult<EventItem> {
    with_conn(&db, |conn| store::save_event(conn, &event))
}

#[tauri::command]
pub fn delete_event(db: State<'_, DbState>, id: i64) -> CmdResult<()> {
    with_conn(&db, |conn| store::delete_event(conn, id))
}

#[tauri::command]
pub fn save_task(db: State<'_, DbState>, task: TaskInput) -> CmdResult<Task> {
    with_conn(&db, |conn| store::save_task(conn, &task))
}

#[tauri::command]
pub fn set_task_status(db: State<'_, DbState>, id: i64, status: String) -> CmdResult<Task> {
    with_conn(&db, |conn| store::set_task_status(conn, id, &status))
}

#[tauri::command]
pub fn delete_task(db: State<'_, DbState>, id: i64) -> CmdResult<()> {
    with_conn(&db, |conn| store::delete_task(conn, id))
}

#[tauri::command]
pub fn save_timetable(
    db: State<'_, DbState>,
    block: TimetableInput,
) -> CmdResult<TimetableBlock> {
    with_conn(&db, |conn| store::save_timetable(conn, &block))
}

#[tauri::command]
pub fn delete_timetable(db: State<'_, DbState>, id: i64) -> CmdResult<()> {
    with_conn(&db, |conn| store::delete_timetable(conn, id))
}

#[tauri::command]
pub fn set_setting(db: State<'_, DbState>, key: String, value: String) -> CmdResult<()> {
    with_conn(&db, |conn| store::set_setting(conn, &key, &value))
}

#[tauri::command]
pub fn export_backup(db: State<'_, DbState>, path: String) -> CmdResult<String> {
    with_conn(&db, |conn| store::export_backup(conn, &path))
}

#[tauri::command]
pub fn import_backup(db: State<'_, DbState>, path: String) -> CmdResult<AppData> {
    with_conn(&db, |conn| store::import_backup(conn, &path))
}

#[tauri::command]
pub fn clear_all_data(db: State<'_, DbState>) -> CmdResult<AppData> {
    with_conn(&db, store::clear_all)
}

// ---------------------------------------------------------------- Apple Calendar

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleStatus {
    pub supported: bool,
    pub enabled: bool,
    pub authorization: String,
    pub calendar_id: Option<String>,
    pub last_sync: Option<String>,
    pub imported_count: i64,
    pub mirrored_count: i64,
}

fn apple_status_inner(conn: &Connection) -> CmdResult<AppleStatus> {
    let enabled = store::get_setting(conn, "appleSyncEnabled")?.as_deref() == Some("1");
    let calendar_id = store::get_setting(conn, "appleCalendarId")?;
    let last_sync = store::get_setting(conn, "appleSyncLastAt")?;
    let imported_count = store::count_events_by_source(conn, "apple")?;
    let mirrored_count = store::count_mirrored_events(conn)?;

    #[cfg(target_os = "macos")]
    let authorization = apple::authorization_status();
    #[cfg(not(target_os = "macos"))]
    let authorization = "unsupported".to_string();

    Ok(AppleStatus {
        supported: cfg!(target_os = "macos"),
        enabled,
        authorization,
        calendar_id,
        last_sync,
        imported_count,
        mirrored_count,
    })
}

#[tauri::command]
pub fn apple_status(db: State<'_, DbState>) -> CmdResult<AppleStatus> {
    with_conn(&db, apple_status_inner)
}

#[tauri::command]
pub fn apple_connect(db: State<'_, DbState>) -> CmdResult<AppData> {
    #[cfg(target_os = "macos")]
    {
        let authorization = apple::request_access()?;
        if authorization != "fullAccess" {
            return Err("需要完整的日曆存取權限才能雙向同步。".into());
        }
        let calendar_id = apple::ensure_calendar()?;
        with_conn(&db, |conn| {
            store::set_setting(conn, "appleSyncEnabled", "1")?;
            store::set_setting(conn, "appleCalendarId", &calendar_id)?;
            sync_apple_inner(conn)
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = &db;
        Err("Apple 日曆整合僅支援 macOS".into())
    }
}

#[tauri::command]
pub fn apple_disconnect(db: State<'_, DbState>) -> CmdResult<AppData> {
    with_conn(&db, |conn| {
        store::set_setting(conn, "appleSyncEnabled", "0")?;
        store::load_app(conn)
    })
}

#[tauri::command]
pub fn apple_sync(db: State<'_, DbState>) -> CmdResult<AppData> {
    with_conn(&db, sync_apple_inner)
}

fn sync_apple_inner(conn: &Connection) -> CmdResult<AppData> {
    #[cfg(target_os = "macos")]
    {
        let enabled = store::get_setting(conn, "appleSyncEnabled")?.as_deref() == Some("1");
        if !enabled {
            return Err("尚未連結 Apple 日曆".into());
        }
        let mut authorization = apple::authorization_status();
        if authorization == "notDetermined" {
            authorization = apple::request_access()?;
        }
        if authorization != "fullAccess" {
            return Err(
                "日曆權限已被關閉，請到「系統設定 → 隱私權與安全性 → 日曆」重新開啟 Reciprocal。"
                    .into(),
            );
        }
        let calendar_id = match store::get_setting(conn, "appleCalendarId")? {
            Some(id) if !id.is_empty() => id,
            _ => {
                let id = apple::ensure_calendar()?;
                store::set_setting(conn, "appleCalendarId", &id)?;
                id
            }
        };

        let pending_deletions = store::pending_tombstones(conn)?;
        for external_id in &pending_deletions {
            match apple::delete_event(external_id) {
                Ok(_) => store::clear_tombstone(conn, external_id)?,
                Err(error) => eprintln!("[reciprocal] apple delete failed: {error}"),
            }
        }

        let calendars = apple::list_calendars()?;
        let calendar_info: std::collections::HashMap<String, (String, bool)> = calendars
            .iter()
            .map(|calendar| {
                (
                    calendar.id.clone(),
                    (calendar.title.clone(), calendar.allows_modifications),
                )
            })
            .collect();

        let now = Local::now();
        let (past_days, future_days) = store::apple_import_range_days(conn)?;
        let start_ms = (now - ChronoDuration::days(past_days)).timestamp_millis();
        let end_ms = (now + ChronoDuration::days(future_days)).timestamp_millis();
        let filter = parse_calendar_filter(conn)?;
        let records = match &filter {
            Some(ids) if ids.is_empty() => Vec::new(),
            Some(ids) => {
                apple::fetch_events(start_ms, end_ms, ids, Some(&calendar_id))?
            }
            None => apple::fetch_events(start_ms, end_ms, &[], Some(&calendar_id))?,
        };
        let mut excluded_external_ids = store::local_external_ids(conn)?;
        excluded_external_ids.extend(pending_deletions);
        let imported: Vec<store::ImportedEvent> = records
            .iter()
            .filter(|record| !excluded_external_ids.contains(&record.external_id))
            .filter_map(imported_from_record)
            .collect();
        store::apply_imported_events(conn, &imported)?;

        for event in store::push_candidates(conn)? {
            let payload = apple_payload(&event)?;
            let target_calendar = event
                .external_calendar_id
                .clone()
                .filter(|id| {
                    calendar_info
                        .get(id)
                        .map(|(_, writable)| *writable)
                        .unwrap_or(false)
                })
                .unwrap_or_else(|| calendar_id.clone());
            let target_title = calendar_info
                .get(&target_calendar)
                .map(|(title, _)| title.clone())
                .unwrap_or_default();
            match apple::upsert_event(&target_calendar, &payload) {
                Ok(external_id) if !external_id.is_empty() => {
                    store::mark_event_synced(
                        conn,
                        event.id,
                        &external_id,
                        &target_calendar,
                        &target_title,
                    )?;
                }
                Ok(_) => {
                    eprintln!(
                        "[reciprocal] apple push returned an empty identifier for event {}",
                        event.id
                    );
                }
                Err(error) => {
                    eprintln!("[reciprocal] apple push failed for event {}: {error}", event.id);
                }
            }
        }

        let last_sync: String = conn
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        store::set_setting(conn, "appleSyncLastAt", &last_sync)?;

        store::load_app(conn)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = conn;
        Err("Apple 日曆整合僅支援 macOS".into())
    }
}

#[cfg(target_os = "macos")]
fn imported_from_record(record: &apple::AppleEventRecord) -> Option<store::ImportedEvent> {
    let start = Local.timestamp_millis_opt(record.start_ms).single()?;
    let end = Local.timestamp_millis_opt(record.end_ms).single()?;
    let (start_time, end_time) = if record.all_day {
        (None, None)
    } else {
        (
            Some(start.format("%H:%M").to_string()),
            Some(end.format("%H:%M").to_string()),
        )
    };
    Some(store::ImportedEvent {
        external_id: record.external_id.clone(),
        calendar_id: record.calendar_id.clone(),
        calendar_title: record.calendar_title.clone(),
        color: record.calendar_color.clone(),
        title: if record.title.trim().is_empty() {
            "(未命名行程)".to_string()
        } else {
            record.title.clone()
        },
        notes: record.notes.clone(),
        location: record.location.clone(),
        date: start.format("%Y-%m-%d").to_string(),
        start_time,
        end_time,
        all_day: record.all_day,
    })
}

#[cfg(target_os = "macos")]
fn apple_payload(event: &EventItem) -> CmdResult<apple::AppleEventPayload> {
    let date = NaiveDate::parse_from_str(&event.date, "%Y-%m-%d")
        .map_err(|_| "行程日期格式不正確".to_string())?;

    let (start_ms, end_ms) = if event.all_day || event.start_time.is_none() {
        let start = Local
            .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
            .single()
            .ok_or_else(|| "無法轉換行程時間".to_string())?;
        let end = start + ChronoDuration::days(1);
        (start.timestamp_millis(), end.timestamp_millis())
    } else {
        let start_time = NaiveTime::parse_from_str(
            event.start_time.as_deref().unwrap_or("09:00"),
            "%H:%M",
        )
        .map_err(|_| "開始時間格式不正確".to_string())?;
        let start = Local
            .from_local_datetime(&date.and_time(start_time))
            .single()
            .ok_or_else(|| "無法轉換行程時間".to_string())?;
        let end = match event
            .end_time
            .as_deref()
            .and_then(|time| NaiveTime::parse_from_str(time, "%H:%M").ok())
        {
            Some(end_time) if end_time > start_time => Local
                .from_local_datetime(&date.and_time(end_time))
                .single()
                .unwrap_or(start + ChronoDuration::hours(1)),
            _ => start + ChronoDuration::hours(1),
        };
        (start.timestamp_millis(), end.timestamp_millis())
    };

    Ok(apple::AppleEventPayload {
        external_id: event.external_id.clone(),
        title: event.title.clone(),
        notes: event.notes.clone(),
        location: event.location.clone(),
        start_ms,
        end_ms,
        all_day: event.all_day || event.start_time.is_none(),
    })
}

const APPLE_FILTER_KEY: &str = "appleImportCalendarIds";

fn parse_calendar_filter(conn: &Connection) -> CmdResult<Option<Vec<String>>> {
    match store::get_setting(conn, APPLE_FILTER_KEY)? {
        Some(raw) => Ok(Some(
            serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default(),
        )),
        None => Ok(None),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleCalendarsResponse {
    pub calendars: Vec<AppleCalendarInfo>,
    pub selected: Vec<String>,
    pub card_selected: Vec<String>,
    pub event_calendars: Vec<AppleCalendarInfo>,
}

#[cfg(target_os = "macos")]
type AppleCalendarInfo = apple::AppleCalendarInfo;
#[cfg(not(target_os = "macos"))]
type AppleCalendarInfo = ();

#[tauri::command]
pub fn apple_calendars(db: State<'_, DbState>) -> CmdResult<AppleCalendarsResponse> {
    #[cfg(target_os = "macos")]
    {
        if apple::authorization_status() != "fullAccess" {
            return Err("需要日曆權限才能選擇要匯入的日曆。".into());
        }
        let mut calendars = apple::list_calendars()?;
        let event_calendars: Vec<AppleCalendarInfo> = calendars
            .iter()
            .filter(|calendar| calendar.allows_modifications)
            .cloned()
            .collect();
        let dedicated = with_conn(&db, |conn| Ok(store::get_setting(conn, "appleCalendarId")?))?;
        if let Some(dedicated) = dedicated {
            calendars.retain(|calendar| calendar.id != dedicated);
        }
        let selected = with_conn(&db, parse_calendar_filter)?
            .unwrap_or_else(|| calendars.iter().map(|calendar| calendar.id.clone()).collect());
        let card_selected = with_conn(&db, |conn| Ok(store::get_setting(conn, "appleCardCalendarIds")?))?
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_else(|| selected.clone());
        Ok(AppleCalendarsResponse {
            calendars,
            selected,
            card_selected,
            event_calendars,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = &db;
        Err("Apple 日曆整合僅支援 macOS".into())
    }
}

#[tauri::command]
pub fn apple_set_calendars(db: State<'_, DbState>, ids: Vec<String>) -> CmdResult<AppData> {
    with_conn(&db, |conn| {
        let raw = serde_json::to_string(&ids).map_err(|error| error.to_string())?;
        store::set_setting(conn, APPLE_FILTER_KEY, &raw)?;
        sync_apple_inner(conn)
    })
}

#[tauri::command]
pub fn storage_info(db: State<'_, DbState>) -> CmdResult<StorageInfo> {
    let path = db.path.clone();
    let size_bytes = std::fs::metadata(&path).map(|meta| meta.len() as i64).unwrap_or(0);
    let data_dir = path
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(StorageInfo {
        db_path: path.to_string_lossy().to_string(),
        data_dir,
        size_bytes,
    })
}

#[tauri::command]
pub fn check_for_updates(app: tauri::AppHandle) -> CmdResult<crate::update::UpdateCheck> {
    let current = app.package_info().version.to_string();
    crate::update::check(&current)
}

#[tauri::command]
pub fn open_external(url: String) -> CmdResult<()> {
    if !url.starts_with("https://github.com/") {
        return Err("只允許開啟 GitHub 連結".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .status()
            .map_err(|error| format!("無法開啟連結：{error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("目前僅支援在 macOS 開啟連結".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn calendar_filter_parsing() {
        let conn = db::open_in_memory().unwrap();
        assert!(parse_calendar_filter(&conn).unwrap().is_none());

        store::set_setting(&conn, APPLE_FILTER_KEY, r#"["CAL-1","CAL-2"]"#).unwrap();
        assert_eq!(
            parse_calendar_filter(&conn).unwrap(),
            Some(vec!["CAL-1".to_string(), "CAL-2".to_string()])
        );

        store::set_setting(&conn, APPLE_FILTER_KEY, "broken-json").unwrap();
        assert_eq!(parse_calendar_filter(&conn).unwrap(), Some(Vec::new()));
    }
}
