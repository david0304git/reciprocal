package com.lutszhong.reciprocal.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * SQLite schema port of `src-tauri/src/db.rs`.
 *
 * The desktop app stores its data in `reciprocal.db` with `PRAGMA user_version = 5`; the Android
 * build uses exactly the same tables, columns and seed rows so a JSON backup is interchangeable in
 * both directions.
 */
class ReciprocalDb(context: Context) : SQLiteOpenHelper(context, NAME, null, VERSION) {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        applySchema(db)
        seed(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // `CREATE TABLE IF NOT EXISTS` makes every step idempotent, so a fresh schema pass also
        // covers v1→v2 (timetable table).
        applySchema(db)
        if (oldVersion < 3) {
            addColumnIfMissing(db, "events", "source", "TEXT NOT NULL DEFAULT 'local'")
            addColumnIfMissing(db, "events", "external_id", "TEXT")
            addColumnIfMissing(db, "events", "external_calendar", "TEXT")
            addColumnIfMissing(db, "events", "synced_at", "TEXT")
        }
        if (oldVersion < 4) {
            addColumnIfMissing(db, "events", "external_calendar_id", "TEXT")
        }
        if (oldVersion < 6) {
            // v6: the app no longer ships demo data — drop the rows the seeded build created.
            for (statement in DEMO_CLEANUP_STATEMENTS) {
                db.execSQL(statement)
            }
        }
        if (oldVersion < 5) {
            // v5 removes duplicated imported occurrences and prevents them from coming back.
            db.execSQL(
                """
                DELETE FROM events
                 WHERE source = 'apple' AND external_id IS NOT NULL
                   AND id NOT IN (
                     SELECT MIN(id) FROM events
                     WHERE source = 'apple' AND external_id IS NOT NULL
                     GROUP BY external_id, date, IFNULL(start_time, ''), all_day
                   )
                """.trimIndent(),
            )
            db.execSQL(CREATE_IMPORTED_INDEX)
        }
        seed(db)
    }

    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Never destroy user data on a downgrade; the schema is forward compatible enough.
    }

    // ------------------------------------------------------------------ internals

    private fun applySchema(db: SQLiteDatabase) {
        for (statement in SCHEMA_STATEMENTS) {
            db.execSQL(statement)
        }
        db.execSQL(CREATE_IMPORTED_INDEX)
    }

    private fun addColumnIfMissing(db: SQLiteDatabase, table: String, column: String, ddl: String) {
        if (columnExists(db, table, column)) return
        db.execSQL("ALTER TABLE $table ADD COLUMN $column $ddl")
    }

    private fun columnExists(db: SQLiteDatabase, table: String, column: String): Boolean {
        db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
            val nameIndex = cursor.getColumnIndex("name")
            while (cursor.moveToNext()) {
                if (cursor.getString(nameIndex) == column) return true
            }
        }
        return false
    }

    /**
     * Only seeds a brand-new database (no habits, and onboarding never ran) — matching db.rs.
     */
    fun seed(db: SQLiteDatabase = writableDatabase) {
        val habitCount = db.rawQuery("SELECT COUNT(*) FROM habits", null).use { cursor ->
            if (cursor.moveToFirst()) cursor.getLong(0) else 0L
        }
        val seeded = db.rawQuery("SELECT COUNT(*) FROM settings WHERE key = 'onboarded'", null)
            .use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
        if (habitCount == 0L && seeded == 0L) {
            for (statement in SEED_STATEMENTS) {
                db.execSQL(statement)
            }
        }
    }

    /** Reads a single string setting; mirrored from `store::get_setting`. */
    fun getSetting(db: SQLiteDatabase, key: String): String? =
        db.rawQuery("SELECT value FROM settings WHERE key = ?", arrayOf(key)).use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }

    fun putSetting(db: SQLiteDatabase, key: String, value: String) {
        val values = ContentValues().apply {
            put("key", key)
            put("value", value)
        }
        db.insertWithOnConflict("settings", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    companion object {
        const val NAME = "reciprocal.db"
        const val VERSION = 6

        private const val CREATE_IMPORTED_INDEX =
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_events_imported_key " +
                "ON events (external_id, date, IFNULL(start_time, ''), all_day) " +
                "WHERE source = 'apple' AND external_id IS NOT NULL"

        private val SCHEMA_STATEMENTS = listOf(
            """
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
            )
            """.trimIndent(),
            """
            CREATE TABLE IF NOT EXISTS habit_logs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                habit_id   INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
                date       TEXT    NOT NULL,
                note       TEXT    NOT NULL DEFAULT '',
                created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                UNIQUE (habit_id, date)
            )
            """.trimIndent(),
            "CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs (date)",
            "CREATE INDEX IF NOT EXISTS idx_habit_logs_habit ON habit_logs (habit_id, date)",
            """
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
            )
            """.trimIndent(),
            "CREATE INDEX IF NOT EXISTS idx_events_date ON events (date)",
            """
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
            )
            """.trimIndent(),
            "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status, sort_order)",
            """
            CREATE TABLE IF NOT EXISTS deleted_external_events (
                external_id TEXT PRIMARY KEY,
                calendar_id TEXT,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )
            """.trimIndent(),
            """
            CREATE TABLE IF NOT EXISTS timetable (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                day        INTEGER NOT NULL,
                start_time TEXT    NOT NULL,
                end_time   TEXT    NOT NULL,
                title      TEXT    NOT NULL,
                notes      TEXT    NOT NULL DEFAULT '',
                color      TEXT    NOT NULL DEFAULT '#5B7DB1',
                created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )
            """.trimIndent(),
            "CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable (day, start_time)",
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )

        /**
         * The Android build ships **no demo data**: a fresh install opens on the empty states.
         * Only the onboarding marker is written so the seed check never runs twice
         * (the desktop app still seeds demo rows — this is a deliberate divergence, documented in
         * README-ANDROID.md and asserted by scripts/verify-parity.py).
         */
        private val SEED_STATEMENTS = listOf(
            "INSERT INTO settings (key, value) VALUES ('onboarded', '1')",
        )

        /**
         * One-time cleanup for databases created by the earlier, seeded build (v5).
         *
         * Every statement matches the demo rows *exactly* (title, notes, colours, times, …), so rows
         * the user created or edited are left alone. Demo rows that were already mirrored into the
         * system calendar get a tombstone first, so the next sync removes the mirrored copy too.
         * Habits go last because deleting them cascades to their check-in logs.
         */
        private val DEMO_CLEANUP_STATEMENTS = listOf(
            """
            INSERT OR IGNORE INTO deleted_external_events (external_id, calendar_id)
            SELECT external_id, external_calendar_id FROM events
             WHERE source = 'local' AND external_id IS NOT NULL AND (
                (title = '與朋友午餐' AND notes = '' AND start_time = '12:30' AND end_time = '14:00'
                    AND all_day = 0 AND color = '#D98A5F' AND category = '社交')
                OR (title = '月度回顧' AND notes = '檢視這個月的習慣與目標。' AND start_time IS NULL
                    AND end_time IS NULL AND all_day = 1 AND color = '#5B7DB1' AND category = '個人')
            )
            """.trimIndent(),
            """
            DELETE FROM events WHERE source = 'local' AND (
                (title = '與朋友午餐' AND notes = '' AND start_time = '12:30' AND end_time = '14:00'
                    AND all_day = 0 AND color = '#D98A5F' AND category = '社交')
                OR (title = '月度回顧' AND notes = '檢視這個月的習慣與目標。' AND start_time IS NULL
                    AND end_time IS NULL AND all_day = 1 AND color = '#5B7DB1' AND category = '個人')
            )
            """.trimIndent(),
            """
            DELETE FROM tasks WHERE (
                (title = '買新的筆記本' AND notes = '文具店或線上書店都可以' AND status = 'todo'
                    AND priority = 1 AND tags = '生活' AND list = '個人')
                OR (title = '整理這週的照片' AND notes = '備份到外接硬碟' AND status = 'doing'
                    AND priority = 2 AND tags = '數位' AND list = '個人')
                OR (title = '讀完《原子習慣》第 3 章' AND notes = '' AND status = 'done'
                    AND priority = 0 AND tags = '閱讀' AND list = '學習')
            )
            """.trimIndent(),
            """
            DELETE FROM timetable WHERE
                (day = 1 AND start_time = '09:00' AND end_time = '10:00' AND title = '週計畫與信箱'
                    AND notes = '看一遍這週的行事曆與待辦。' AND color = '#5B7DB1')
                OR (day = 1 AND start_time = '19:00' AND end_time = '20:00' AND title = '運動'
                    AND notes = '重訓或有氧都可以。' AND color = '#3F7C6A')
                OR (day = 2 AND start_time = '10:00' AND end_time = '12:00' AND title = '深度工作'
                    AND notes = '關掉通知，只做最重要的一件事。' AND color = '#B06AA0')
                OR (day = 3 AND start_time = '14:00' AND end_time = '15:30' AND title = '英文課'
                    AND notes = '' AND color = '#C2A33C')
                OR (day = 4 AND start_time = '09:30' AND end_time = '10:30' AND title = '團隊同步'
                    AND notes = '' AND color = '#5B7DB1')
                OR (day = 5 AND start_time = '18:00' AND end_time = '18:30' AND title = '週回顧'
                    AND notes = '寫下這週完成的三件事。' AND color = '#D98A5F')
            """.trimIndent(),
            """
            DELETE FROM habits WHERE
                (name = '早晨伸展' AND emoji = '🌅' AND color = '#D98A5F'
                    AND notes = '起床後花 10 分鐘活動筋骨，讓身體醒過來。' AND schedule = 'daily'
                    AND weekly_target = 7 AND time_of_day = 'morning' AND sort_order = 0)
                OR (name = '閱讀 20 分鐘' AND emoji = '📖' AND color = '#3F7C6A' AND notes = ''
                    AND schedule = 'daily' AND weekly_target = 7 AND time_of_day = 'evening'
                    AND sort_order = 1)
                OR (name = '運動 3 次' AND emoji = '🏃' AND color = '#5B7DB1'
                    AND notes = '每週至少三次，每次 30 分鐘以上。' AND schedule = 'times_per_week'
                    AND weekly_target = 3 AND time_of_day = 'afternoon' AND sort_order = 2)
            """.trimIndent(),
            // Check-in rows whose habit is gone. ON DELETE CASCADE normally covers this, but a
            // database written with foreign keys disabled can carry orphans; they are dead data.
            "DELETE FROM habit_logs WHERE habit_id NOT IN (SELECT id FROM habits)",
        )
    }
}
