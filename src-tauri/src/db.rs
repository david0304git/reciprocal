use std::path::Path;

use rusqlite::{Connection, Result};

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS habits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    emoji         TEXT    NOT NULL DEFAULT '🌱',
    color         TEXT    NOT NULL DEFAULT '#3F7C6A',
    notes         TEXT    NOT NULL DEFAULT '',
    schedule      TEXT    NOT NULL DEFAULT 'daily',
    weekdays      TEXT    NOT NULL DEFAULT '1,2,3,4,5,6,7',
    weekly_target INTEGER NOT NULL DEFAULT 7,
    time_of_day   TEXT    NOT NULL DEFAULT 'anytime',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    archived      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS habit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id   INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date       TEXT    NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (habit_id, date)
);

CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs (date);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit ON habit_logs (habit_id, date);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    notes      TEXT    NOT NULL DEFAULT '',
    date       TEXT    NOT NULL,
    start_time TEXT,
    end_time   TEXT,
    all_day    INTEGER NOT NULL DEFAULT 0,
    color      TEXT    NOT NULL DEFAULT '#5B7DB1',
    location   TEXT    NOT NULL DEFAULT '',
    category   TEXT    NOT NULL DEFAULT '個人',
    source     TEXT    NOT NULL DEFAULT 'local',
    external_id TEXT,
    external_calendar TEXT,
    external_calendar_id TEXT,
    synced_at  TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events (date);

CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    notes        TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'todo',
    priority     INTEGER NOT NULL DEFAULT 0,
    due_date     TEXT,
    tags         TEXT    NOT NULL DEFAULT '',
    list         TEXT    NOT NULL DEFAULT '個人',
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    completed_at TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status, sort_order);

CREATE TABLE IF NOT EXISTS deleted_external_events (
    external_id TEXT PRIMARY KEY,
    calendar_id TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS timetable (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    day        INTEGER NOT NULL,
    start_time TEXT    NOT NULL,
    end_time   TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    notes      TEXT    NOT NULL DEFAULT '',
    color      TEXT    NOT NULL DEFAULT '#5B7DB1',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable (day, start_time);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

const SEED: &str = r#"
INSERT INTO habits (name, emoji, color, notes, schedule, weekdays, weekly_target, time_of_day, sort_order) VALUES
    ('早晨伸展',   '🌅', '#D98A5F', '起床後花 10 分鐘活動筋骨，讓身體醒過來。', 'daily', '1,2,3,4,5,6,7', 7, 'morning', 0),
    ('閱讀 20 分鐘', '📖', '#3F7C6A', '', 'daily', '1,2,3,4,5,6,7', 7, 'evening', 1),
    ('運動 3 次',   '🏃', '#5B7DB1', '每週至少三次，每次 30 分鐘以上。', 'times_per_week', '1,2,3,4,5,6,7', 3, 'afternoon', 2);

INSERT INTO habit_logs (habit_id, date) VALUES
    (1, date('now','localtime','-1 day')),
    (1, date('now','localtime','-2 day')),
    (1, date('now','localtime','-4 day')),
    (2, date('now','localtime','-1 day')),
    (2, date('now','localtime','-2 day')),
    (2, date('now','localtime','-3 day')),
    (3, date('now','localtime','-2 day')),
    (3, date('now','localtime','-5 day'));

INSERT INTO events (title, notes, date, start_time, end_time, all_day, color, category) VALUES
    ('與朋友午餐', '', date('now','localtime','+1 day'), '12:30', '14:00', 0, '#D98A5F', '社交'),
    ('月度回顧',   '檢視這個月的習慣與目標。', date('now','localtime','+3 day'), NULL, NULL, 1, '#5B7DB1', '個人');

INSERT INTO tasks (title, notes, status, priority, due_date, tags, list) VALUES
    ('買新的筆記本', '文具店或線上書店都可以', 'todo', 1, date('now','localtime'), '生活', '個人'),
    ('整理這週的照片', '備份到外接硬碟', 'doing', 2, date('now','localtime','+2 day'), '數位', '個人'),
    ('讀完《原子習慣》第 3 章', '', 'done', 0, date('now','localtime','-1 day'), '閱讀', '學習');

INSERT INTO timetable (day, start_time, end_time, title, notes, color) VALUES
    (1, '09:00', '10:00', '週計畫與信箱', '看一遍這週的行事曆與待辦。', '#5B7DB1'),
    (1, '19:00', '20:00', '運動', '重訓或有氧都可以。', '#3F7C6A'),
    (2, '10:00', '12:00', '深度工作', '關掉通知，只做最重要的一件事。', '#B06AA0'),
    (3, '14:00', '15:30', '英文課', '', '#C2A33C'),
    (4, '09:30', '10:30', '團隊同步', '', '#5B7DB1'),
    (5, '18:00', '18:30', '週回顧', '寫下這週完成的三件事。', '#D98A5F');

INSERT INTO settings (key, value) VALUES ('onboarded', '1');
"#;

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        conn.pragma_update(None, "user_version", 1)?;
    }
    if version < 2 {
        // v2 adds the weekly timetable table (already created above if missing).
        conn.pragma_update(None, "user_version", 2)?;
    }
    if version < 3 {
        // v3 adds Apple Calendar sync columns and the pending-deletion queue.
        for (column, ddl) in [
            ("source", "ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'local'"),
            ("external_id", "ALTER TABLE events ADD COLUMN external_id TEXT"),
            ("external_calendar", "ALTER TABLE events ADD COLUMN external_calendar TEXT"),
            ("synced_at", "ALTER TABLE events ADD COLUMN synced_at TEXT"),
        ] {
            if !column_exists(conn, "events", column)? {
                conn.execute_batch(ddl)?;
            }
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS deleted_external_events (
                external_id TEXT PRIMARY KEY,
                calendar_id TEXT,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );",
        )?;
        conn.pragma_update(None, "user_version", 3)?;
    }
    if version < 4 {
        // v4 stores the Apple calendar identifier so countdown cards can be filtered per calendar.
        if !column_exists(conn, "events", "external_calendar_id")? {
            conn.execute_batch("ALTER TABLE events ADD COLUMN external_calendar_id TEXT")?;
        }
        conn.pragma_update(None, "user_version", 4)?;
    }
    if version < 5 {
        // v5 removes duplicated imported occurrences (same Apple identifier,
        // date, start time and all-day flag) and prevents them from coming back.
        conn.execute_batch(
            "DELETE FROM events
             WHERE source = 'apple' AND external_id IS NOT NULL
               AND id NOT IN (
                 SELECT MIN(id) FROM events
                 WHERE source = 'apple' AND external_id IS NOT NULL
                 GROUP BY external_id, date, IFNULL(start_time, ''), all_day
               );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_events_imported_key
               ON events (external_id, date, IFNULL(start_time, ''), all_day)
               WHERE source = 'apple' AND external_id IS NOT NULL;
             PRAGMA user_version = 5;",
        )?;
    }
    seed(conn)?;
    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Only seeds a brand-new database (no habits, and onboarding never ran).
fn seed(conn: &Connection) -> Result<()> {
    let habit_count: i64 = conn.query_row("SELECT COUNT(*) FROM habits", [], |row| row.get(0))?;
    let seeded: i64 = conn.query_row(
        "SELECT COUNT(*) FROM settings WHERE key = 'onboarded'",
        [],
        |row| row.get(0),
    )?;
    if habit_count == 0 && seeded == 0 {
        conn.execute_batch(SEED)?;
    }
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    init(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    init(&conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::parse_weekdays;

    #[test]
    fn schema_applies_and_seeds_once() {
        let conn = open_in_memory().unwrap();
        let habits: i64 = conn
            .query_row("SELECT COUNT(*) FROM habits", [], |row| row.get(0))
            .unwrap();
        assert_eq!(habits, 3, "first run seeds three demo habits");

        // A second init must not duplicate seed rows.
        init(&conn).unwrap();
        let habits_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM habits", [], |row| row.get(0))
            .unwrap();
        assert_eq!(habits_after, 3);

        let weekdays = parse_weekdays("1,3,5");
        assert_eq!(weekdays, vec![1, 3, 5]);
    }

    #[test]
    fn adds_timetable_table_when_upgrading_v1() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("DROP TABLE timetable;").unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();

        init(&conn).unwrap();

        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'timetable'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 1, "timetable table is created on upgrade");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 5);
    }

    #[test]
    fn upgrades_v2_database_with_apple_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO settings (key, value) VALUES ('onboarded', '1');
            CREATE TABLE events (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL,
                notes      TEXT NOT NULL DEFAULT '',
                date       TEXT NOT NULL,
                start_time TEXT,
                end_time   TEXT,
                all_day    INTEGER NOT NULL DEFAULT 0,
                color      TEXT NOT NULL DEFAULT '#5B7DB1',
                location   TEXT NOT NULL DEFAULT '',
                category   TEXT NOT NULL DEFAULT '個人',
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            PRAGMA user_version = 2;
            "#,
        )
        .unwrap();

        init(&conn).unwrap();

        assert!(column_exists(&conn, "events", "source").unwrap());
        assert!(column_exists(&conn, "events", "external_id").unwrap());
        assert!(column_exists(&conn, "events", "external_calendar").unwrap());
        assert!(column_exists(&conn, "events", "external_calendar_id").unwrap());
        assert!(column_exists(&conn, "events", "synced_at").unwrap());
        let tombstones: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='deleted_external_events'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tombstones, 1);
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 5);
    }

    #[test]
    fn migration_v5_deduplicates_imported_events() {
        let conn = open_in_memory().unwrap();
        conn.execute_batch(
            "DROP INDEX idx_events_imported_key; PRAGMA user_version = 4;",
        )
        .unwrap();
        for _ in 0..2 {
            conn.execute(
                "INSERT INTO events
                    (title, date, all_day, source, external_id, external_calendar, external_calendar_id)
                 VALUES ('平安夜', '2026-12-24', 1, 'apple', 'DUP-1', '香港節日', 'CAL-HK')",
                [],
            )
            .unwrap();
        }

        init(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE source = 'apple' AND external_id = 'DUP-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "migration keeps one imported occurrence");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 5);
        let index: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_events_imported_key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(index, 1, "unique import index is created");
    }

    #[test]
    fn foreign_keys_cascade_logs() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO habit_logs (habit_id, date) VALUES (1, date('now','localtime'))",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM habits WHERE id = 1", []).unwrap();
        let logs: i64 = conn
            .query_row("SELECT COUNT(*) FROM habit_logs WHERE habit_id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(logs, 0, "logs cascade-delete with the habit");
    }
}
