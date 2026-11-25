package com.lutszhong.reciprocal.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File

/**
 * A rejected operation. The message is the exact Traditional-Chinese string the Rust backend
 * returned from `store.rs` / `commands.rs`, so the React error toasts read the same on both
 * platforms.
 */
class StoreException(message: String) : Exception(message)

private fun fail(message: String): Nothing = throw StoreException(message)

/**
 * Backup envelope serializer matching `serde_json::to_string_pretty` (desktop export): two-space
 * indent, every field emitted, `null` for absent options.
 */
@OptIn(ExperimentalSerializationApi::class)
private val BACKUP_JSON: Json = Json {
    prettyPrint = true
    prettyPrintIndent = "  "
    encodeDefaults = true
    explicitNulls = true
    ignoreUnknownKeys = true
    coerceInputValues = true
}

/**
 * Data access layer port of `src-tauri/src/store.rs`.
 *
 * Reads return exactly the wire models in [Models]; every mutation returns the single row that
 * changed so the frontend can patch its state locally, just like the Tauri commands did.
 *
 * The Rust side guards its single `rusqlite::Connection` with a `Mutex`; the public methods here
 * are `@Synchronized` for the same reason (read-modify-write sequences such as the habit-log
 * upsert must stay atomic across the bridge thread and the calendar-sync callbacks).
 *
 * NOTE (ownership): this file is implemented by the data-layer task. Keep the signatures stable —
 * `StoreCommands` and the calendar sync layer already compile against them.
 */
class Store(private val context: Context, private val db: ReciprocalDb) {

    // ------------------------------------------------------------------ reads

    @Synchronized
    fun loadApp(): AppData = guarded { database -> loadAppFrom(database) }

    // ------------------------------------------------------------------ habits

    @Synchronized
    fun saveHabit(input: HabitInput): Habit = guarded { database ->
        val name = input.name.trim()
        if (name.isEmpty()) fail("習慣名稱不能留空")
        val emoji = input.emoji.trim().ifEmpty { "🌱" }
        val color = if (isHexColor(input.color.trim())) input.color.trim() else "#3F7C6A"
        val schedule = when (input.schedule) {
            "weekdays", "times_per_week" -> input.schedule
            else -> "daily"
        }
        val weekdays = if (input.weekdays.isEmpty()) listOf(1, 2, 3, 4, 5, 6, 7) else input.weekdays
        val weeklyTarget = if (input.weeklyTarget <= 0L) 7L else input.weeklyTarget.coerceAtMost(7L)
        val timeOfDay = when (input.timeOfDay) {
            "morning", "afternoon", "evening" -> input.timeOfDay
            else -> "anytime"
        }
        val notes = input.notes.trim()
        val weekdayString = weekdaysToString(weekdays)
        val archived = if (input.archived) 1 else 0

        val id = input.id
        if (id == null) {
            val nextOrder = queryLong(database, "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM habits")
            val rowId = database.insertOrThrow(
                "habits",
                null,
                content(
                    "name" to name,
                    "emoji" to emoji,
                    "color" to color,
                    "notes" to notes,
                    "schedule" to schedule,
                    "weekdays" to weekdayString,
                    "weekly_target" to weeklyTarget,
                    "time_of_day" to timeOfDay,
                    "sort_order" to nextOrder,
                    "archived" to archived,
                ),
            )
            getHabit(database, rowId)
        } else {
            val changed = database.update(
                "habits",
                content(
                    "name" to name,
                    "emoji" to emoji,
                    "color" to color,
                    "notes" to notes,
                    "schedule" to schedule,
                    "weekdays" to weekdayString,
                    "weekly_target" to weeklyTarget,
                    "time_of_day" to timeOfDay,
                    "archived" to archived,
                ),
                "id = ?",
                arrayOf(id.toString()),
            )
            if (changed == 0) fail("找不到要更新的習慣")
            getHabit(database, id)
        }
    }

    @Synchronized
    fun deleteHabit(id: Long): Unit = guarded { database ->
        database.delete("habits", "id = ?", arrayOf(id.toString()))
        Unit
    }

    @Synchronized
    fun setHabitArchived(id: Long, archived: Boolean): Habit = guarded { database ->
        database.update(
            "habits",
            content("archived" to if (archived) 1 else 0),
            "id = ?",
            arrayOf(id.toString()),
        )
        getHabit(database, id)
    }

    @Synchronized
    fun setHabitLog(habitId: Long, date: String, present: Boolean, note: String?): HabitLog? =
        guarded { database ->
            if (!isValidDate(date)) fail("日期格式必須是 YYYY-MM-DD")
            val exists = queryLong(
                database,
                "SELECT COUNT(*) FROM habits WHERE id = ?",
                arrayOf(habitId.toString()),
            )
            if (exists == 0L) fail("找不到這個習慣")

            if (!present) {
                database.delete(
                    "habit_logs",
                    "habit_id = ? AND date = ?",
                    arrayOf(habitId.toString(), date),
                )
                return@guarded null
            }

            // `INSERT ... ON CONFLICT(habit_id, date) DO UPDATE` needs SQLite 3.24, which is newer
            // than the engine on the oldest supported Android releases (minSdk 26 ships 3.18), so
            // the upsert is spelled as UPDATE-then-INSERT. Both paths keep the original row id and
            // created_at, exactly like the Rust upsert did.
            val trimmed = (note ?: "").trim()
            val updated = database.update(
                "habit_logs",
                content("note" to trimmed),
                "habit_id = ? AND date = ?",
                arrayOf(habitId.toString(), date),
            )
            if (updated == 0) {
                database.insertOrThrow(
                    "habit_logs",
                    null,
                    content("habit_id" to habitId, "date" to date, "note" to trimmed),
                )
            }
            queryOne(
                database,
                "SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?",
                arrayOf(habitId.toString(), date),
                ::rowToHabitLog,
            ) ?: fail("資料庫錯誤：找不到習慣紀錄")
        }

    // ------------------------------------------------------------------ events

    @Synchronized
    fun saveEvent(input: EventInput): EventItem = guarded { database ->
        val id = input.id
        if (id != null) {
            val source = queryOne(
                database,
                "SELECT source FROM events WHERE id = ?",
                arrayOf(id.toString()),
            ) { cursor -> cursor.textOrNull("source") }
            if (source == "apple") fail("此行程來自 Apple 日曆，請在 Apple 日曆中修改。")
        }
        val existingCalendar = if (id == null) {
            null
        } else {
            queryOne(
                database,
                "SELECT external_calendar_id FROM events WHERE id = ?",
                arrayOf(id.toString()),
            ) { cursor -> cursor.textOrNull("external_calendar_id") }
        }
        val targetCalendar = input.appleCalendarId ?: existingCalendar

        val title = input.title.trim()
        if (title.isEmpty()) fail("行程標題不能留空")
        if (!isValidDate(input.date.trim())) fail("日期格式必須是 YYYY-MM-DD")
        val start = normaliseTime(input.startTime)
        val end = normaliseTime(input.endTime)
        if (start != null && end != null && start > end) fail("結束時間不能早於開始時間")
        val allDay = if (input.allDay || start == null) 1 else 0
        val color = if (isHexColor(input.color.trim())) input.color.trim() else "#5B7DB1"
        val category = if (input.category.trim().isEmpty()) "個人" else input.category.trim()

        val values = content(
            "title" to title,
            "notes" to input.notes.trim(),
            "date" to input.date.trim(),
            "start_time" to start,
            "end_time" to end,
            "all_day" to allDay,
            "color" to color,
            "location" to input.location.trim(),
            "category" to category,
            "external_calendar_id" to targetCalendar,
        )

        if (id == null) {
            val rowId = database.insertOrThrow("events", null, values)
            getEvent(database, rowId)
        } else {
            values.put("updated_at", nowIso())
            val changed = database.update("events", values, "id = ?", arrayOf(id.toString()))
            if (changed == 0) fail("找不到要更新的行程")
            getEvent(database, id)
        }
    }

    @Synchronized
    fun deleteEvent(id: Long): Unit = guarded { database ->
        val existing = queryOne(
            database,
            "SELECT source, external_id FROM events WHERE id = ?",
            arrayOf(id.toString()),
        ) { cursor -> cursor.textOrNull("source") to cursor.textOrNull("external_id") }

        if (existing != null) {
            val (source, externalId) = existing
            if (source == "apple") fail("此行程來自 Apple 日曆，請在 Apple 日曆中刪除。")
            if (externalId != null) {
                database.insertWithOnConflict(
                    "deleted_external_events",
                    null,
                    content("external_id" to externalId, "calendar_id" to null),
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
            }
        }

        database.delete("events", "id = ?", arrayOf(id.toString()))
        Unit
    }

    // ------------------------------------------------------------------ tasks

    @Synchronized
    fun saveTask(input: TaskInput): Task = guarded { database ->
        val title = input.title.trim()
        if (title.isEmpty()) fail("事務標題不能留空")
        val status = when (input.status) {
            "doing", "done" -> input.status
            else -> "todo"
        }
        val priority = input.priority.coerceIn(0L, 3L)
        val dueDate = input.dueDate?.let { raw ->
            val trimmed = raw.trim()
            when {
                trimmed.isEmpty() -> null
                !isValidDate(trimmed) -> fail("截止日期格式必須是 YYYY-MM-DD")
                else -> trimmed
            }
        }
        val tags = tagsToString(input.tags)
        val list = if (input.list.trim().isEmpty()) "個人" else input.list.trim()

        val id = input.id
        if (id == null) {
            val nextOrder = queryLong(database, "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks")
            val completedAt = if (status == "done") nowIso() else null
            val rowId = database.insertOrThrow(
                "tasks",
                null,
                content(
                    "title" to title,
                    "notes" to input.notes.trim(),
                    "status" to status,
                    "priority" to priority,
                    "due_date" to dueDate,
                    "tags" to tags,
                    "list" to list,
                    "completed_at" to completedAt,
                    "sort_order" to nextOrder,
                ),
            )
            getTask(database, rowId)
        } else {
            // `completed_at = CASE WHEN ?3 = 'done' THEN COALESCE(completed_at, now) ELSE NULL END`
            val existingCompleted = queryOne(
                database,
                "SELECT completed_at FROM tasks WHERE id = ?",
                arrayOf(id.toString()),
            ) { cursor -> cursor.textOrNull("completed_at") }
            val completedAt = if (status == "done") existingCompleted ?: nowIso() else null
            val changed = database.update(
                "tasks",
                content(
                    "title" to title,
                    "notes" to input.notes.trim(),
                    "status" to status,
                    "priority" to priority,
                    "due_date" to dueDate,
                    "tags" to tags,
                    "list" to list,
                    "completed_at" to completedAt,
                ),
                "id = ?",
                arrayOf(id.toString()),
            )
            if (changed == 0) fail("找不到要更新的事務")
            getTask(database, id)
        }
    }

    @Synchronized
    fun setTaskStatus(id: Long, status: String): Task = guarded { database ->
        val normalised = when (status) {
            "todo", "doing", "done" -> status
            else -> fail("未知的事務狀態")
        }
        val existingCompleted = queryOne(
            database,
            "SELECT completed_at FROM tasks WHERE id = ?",
            arrayOf(id.toString()),
        ) { cursor -> cursor.textOrNull("completed_at") }
        val completedAt = if (normalised == "done") existingCompleted ?: nowIso() else null
        database.update(
            "tasks",
            content("status" to normalised, "completed_at" to completedAt),
            "id = ?",
            arrayOf(id.toString()),
        )
        getTask(database, id)
    }

    @Synchronized
    fun deleteTask(id: Long): Unit = guarded { database ->
        database.delete("tasks", "id = ?", arrayOf(id.toString()))
        Unit
    }

    // ------------------------------------------------------------------ timetable

    @Synchronized
    fun saveTimetable(input: TimetableInput): TimetableBlock = guarded { database ->
        val title = input.title.trim()
        if (title.isEmpty()) fail("時段標題不能留空")
        if (input.day !in 1L..5L) fail("時段只支援星期一至星期五")
        val start = normaliseTime(input.startTime) ?: fail("請填寫開始時間")
        val end = normaliseTime(input.endTime) ?: fail("請填寫結束時間")
        if (end <= start) fail("結束時間必須晚於開始時間")
        val color = if (isHexColor(input.color.trim())) input.color.trim() else "#5B7DB1"

        val id = input.id
        if (id == null) {
            val rowId = database.insertOrThrow(
                "timetable",
                null,
                content(
                    "day" to input.day,
                    "start_time" to start,
                    "end_time" to end,
                    "title" to title,
                    "notes" to input.notes.trim(),
                    "color" to color,
                ),
            )
            getTimetable(database, rowId)
        } else {
            val changed = database.update(
                "timetable",
                content(
                    "day" to input.day,
                    "start_time" to start,
                    "end_time" to end,
                    "title" to title,
                    "notes" to input.notes.trim(),
                    "color" to color,
                ),
                "id = ?",
                arrayOf(id.toString()),
            )
            if (changed == 0) fail("找不到要更新的時段")
            getTimetable(database, id)
        }
    }

    @Synchronized
    fun deleteTimetable(id: Long): Unit = guarded { database ->
        database.delete("timetable", "id = ?", arrayOf(id.toString()))
        Unit
    }

    // ------------------------------------------------------------------ settings

    @Synchronized
    fun setSetting(key: String, value: String): Unit = guarded { database ->
        db.putSetting(database, key, value)
        Unit
    }

    @Synchronized
    fun getSetting(key: String): String? = guarded { database -> db.getSetting(database, key) }

    // ------------------------------------------------------------------ backup

    /**
     * Serializes the whole dataset to the desktop-compatible [BackupData] JSON envelope.
     *
     * Mirror of `store::export_backup`, minus the file write: the platform layer streams the
     * returned string into the document the user picked through the SAF picker.
     */
    @Synchronized
    fun backupJson(): String = guarded { database ->
        val data = loadAppFrom(database)
        val backup = BackupData(
            version = 1L,
            exportedAt = nowIso(),
            habits = data.habits,
            logs = data.logs,
            events = data.events,
            timetable = data.timetable,
            tasks = data.tasks,
            settings = data.settings,
        )
        try {
            BACKUP_JSON.encodeToString(BackupData.serializer(), backup)
        } catch (error: SerializationException) {
            fail("序列化備份失敗：${error.message}")
        }
    }

    /**
     * Replaces every table with the contents of a desktop backup JSON.
     *
     * Mirror of `store::import_backup`. Older backups without the `timetable` array (and events
     * without `source` / `externalCalendarId`) decode through the defaults declared in [Models].
     */
    @Synchronized
    fun restoreFromJson(json: String): AppData = guarded { database ->
        val backup = try {
            AppJson.json.decodeFromString(BackupData.serializer(), json)
        } catch (error: SerializationException) {
            fail("備份檔格式不正確：${error.message}")
        }

        database.beginTransaction()
        try {
            for (table in WIPE_TABLES) {
                database.execSQL("DELETE FROM $table")
            }
            for (habit in backup.habits) insertHabitRow(database, habit)
            for (log in backup.logs) insertLogRow(database, log)
            for (event in backup.events) insertEventRow(database, event)
            for (task in backup.tasks) insertTaskRow(database, task)
            for (block in backup.timetable) insertTimetableRow(database, block)
            for ((key, value) in backup.settings) db.putSetting(database, key, value)
            // A restored database counts as onboarded, exactly like the desktop importer.
            db.putSetting(database, "onboarded", "1")
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
        loadAppFrom(database)
    }

    @Synchronized
    fun clearAll(): AppData = guarded { database ->
        database.beginTransaction()
        try {
            for (table in WIPE_TABLES + "deleted_external_events") {
                database.execSQL("DELETE FROM $table")
            }
            db.putSetting(database, "onboarded", "1")
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
        // Keep the AUTOINCREMENT counters tidy for a fresh start.
        try {
            database.execSQL("DELETE FROM sqlite_sequence")
        } catch (_: SQLiteException) {
            // `sqlite_sequence` only exists once an AUTOINCREMENT table has been written.
        }
        loadAppFrom(database)
    }

    @Synchronized
    fun storageInfo(): StorageInfo {
        val databaseFile = context.getDatabasePath(ReciprocalDb.NAME)
        // WAL mode keeps most pages in `-wal` until a checkpoint, so the honest on-disk footprint
        // is the main file plus its write-ahead log (the desktop build runs without WAL).
        val sizeBytes = databaseFile.length() + File(databaseFile.absolutePath + "-wal").length()
        return StorageInfo(
            dbPath = databaseFile.absolutePath,
            dataDir = databaseFile.parentFile?.absolutePath ?: context.filesDir?.absolutePath.orEmpty(),
            sizeBytes = sizeBytes,
        )
    }

    // ------------------------------------------------------------------ calendar sync support

    @Synchronized
    fun countEventsBySource(source: String): Long = guarded { database ->
        queryLong(database, "SELECT COUNT(*) FROM events WHERE source = ?", arrayOf(source))
    }

    @Synchronized
    fun countMirroredEvents(): Long = guarded { database ->
        queryLong(database, "SELECT COUNT(*) FROM events WHERE source = 'local' AND external_id IS NOT NULL")
    }

    @Synchronized
    fun localExternalIds(): Set<String> = guarded { database ->
        database.rawQuery(
            "SELECT external_id FROM events WHERE source = 'local' AND external_id IS NOT NULL",
            null,
        ).use { cursor ->
            val ids = LinkedHashSet<String>()
            while (cursor.moveToNext()) ids.add(cursor.getString(0).orEmpty())
            ids
        }
    }

    /** (pastDays, futureDays) import window; defaults live in `appleImportRangeDays` in store.rs. */
    @Synchronized
    fun appleImportRangeDays(): Pair<Long, Long> = guarded { database ->
        readImportDays(database, "appleImportPastDays", 365L) to
            readImportDays(database, "appleImportFutureDays", 365L)
    }

    /** Runs a block against the shared writable database (used by the calendar sync layer). */
    @Synchronized
    fun <T> use(block: (SQLiteDatabase) -> T): T = block(db.writableDatabase)

    // ------------------------------------------------------------------ internals

    /** Runs [block] against the writable database, mapping SQLite failures to `資料庫錯誤：…`. */
    private fun <T> guarded(block: (SQLiteDatabase) -> T): T =
        try {
            use(block)
        } catch (error: StoreException) {
            throw error
        } catch (error: SQLiteException) {
            throw StoreException(sqlError(error))
        } catch (error: RuntimeException) {
            throw StoreException(sqlError(error))
        }

    private fun sqlError(error: Throwable): String =
        "資料庫錯誤：${error.message ?: error.javaClass.simpleName}"

    private fun loadAppFrom(database: SQLiteDatabase): AppData = AppData(
        habits = queryList(
            database,
            "SELECT * FROM habits ORDER BY archived ASC, sort_order ASC, id ASC",
            ::rowToHabit,
        ),
        logs = queryList(database, "SELECT * FROM habit_logs ORDER BY date ASC, id ASC", ::rowToHabitLog),
        events = queryList(
            database,
            "SELECT * FROM events ORDER BY date ASC, all_day DESC, start_time ASC, id ASC",
            ::rowToEvent,
        ),
        tasks = queryList(database, "SELECT * FROM tasks ORDER BY sort_order ASC, id DESC", ::rowToTask),
        timetable = queryList(
            database,
            "SELECT * FROM timetable ORDER BY day ASC, start_time ASC, id ASC",
            ::rowToTimetable,
        ),
        settings = settingsMap(database),
    )

    private fun getHabit(database: SQLiteDatabase, id: Long): Habit =
        queryOne(database, "SELECT * FROM habits WHERE id = ?", arrayOf(id.toString()), ::rowToHabit)
            ?: fail("找不到這個習慣")

    private fun getEvent(database: SQLiteDatabase, id: Long): EventItem =
        queryOne(database, "SELECT * FROM events WHERE id = ?", arrayOf(id.toString()), ::rowToEvent)
            ?: fail("找不到這個行程")

    private fun getTask(database: SQLiteDatabase, id: Long): Task =
        queryOne(database, "SELECT * FROM tasks WHERE id = ?", arrayOf(id.toString()), ::rowToTask)
            ?: fail("找不到這項事務")

    private fun getTimetable(database: SQLiteDatabase, id: Long): TimetableBlock =
        queryOne(database, "SELECT * FROM timetable WHERE id = ?", arrayOf(id.toString()), ::rowToTimetable)
            ?: fail("找不到這個時段")

    private fun readImportDays(database: SQLiteDatabase, key: String, default: Long): Long {
        val raw: String? = queryOne(
            database,
            "SELECT value FROM settings WHERE key = ?",
            arrayOf(key),
        ) { cursor -> if (cursor.isNull(0)) null else cursor.getString(0) }
        val parsed = raw?.toLongOrNull() ?: return default
        return parsed.coerceIn(1L, 3650L)
    }

    private fun settingsMap(database: SQLiteDatabase): Map<String, String> =
        database.rawQuery("SELECT key, value FROM settings", null).use { cursor ->
            val settings = LinkedHashMap<String, String>()
            while (cursor.moveToNext()) {
                settings[cursor.getString(0)] =
                    if (cursor.isNull(1)) "" else cursor.getString(1).orEmpty()
            }
            settings
        }

    private fun <T> queryList(
        database: SQLiteDatabase,
        sql: String,
        mapper: (Cursor) -> T,
    ): List<T> = database.rawQuery(sql, null).use { cursor ->
        val rows = ArrayList<T>(cursor.count.coerceAtLeast(0))
        while (cursor.moveToNext()) rows.add(mapper(cursor))
        rows
    }

    private fun <T> queryOne(
        database: SQLiteDatabase,
        sql: String,
        args: Array<String>,
        mapper: (Cursor) -> T,
    ): T? = database.rawQuery(sql, args).use { cursor ->
        if (cursor.moveToFirst()) mapper(cursor) else null
    }

    private fun queryLong(
        database: SQLiteDatabase,
        sql: String,
        args: Array<String> = emptyArray(),
    ): Long = database.rawQuery(sql, args).use { cursor ->
        if (cursor.moveToFirst()) cursor.getLong(0) else 0L
    }

    private companion object {
        val WIPE_TABLES = listOf("habit_logs", "habits", "events", "tasks", "timetable", "settings")
    }
}

// ---------------------------------------------------------------- validation (store.rs parity)

/** `is_valid_date`: exactly `YYYY-MM-DD`, month 1–12, day 1–31. */
private fun isValidDate(value: String): Boolean {
    val bytes = value.toByteArray(Charsets.UTF_8)
    if (bytes.size != 10) return false
    if (bytes[4] != '-'.code.toByte() || bytes[7] != '-'.code.toByte()) return false
    for (index in bytes.indices) {
        if (index == 4 || index == 7) continue
        val byte = bytes[index].toInt() and 0xFF
        if (byte < '0'.code || byte > '9'.code) return false
    }
    val month = value.substring(5, 7).toIntOrNull() ?: 0
    val day = value.substring(8, 10).toIntOrNull() ?: 0
    return month in 1..12 && day in 1..31
}

/** `is_valid_time`: exactly `HH:MM`, hours < 24, minutes < 60. */
private fun isValidTime(value: String): Boolean {
    val bytes = value.toByteArray(Charsets.UTF_8)
    if (bytes.size != 5 || bytes[2] != ':'.code.toByte()) return false
    for (index in bytes.indices) {
        if (index == 2) continue
        val byte = bytes[index].toInt() and 0xFF
        if (byte < '0'.code || byte > '9'.code) return false
    }
    val hours = value.substring(0, 2).toIntOrNull() ?: return false
    val minutes = value.substring(3, 5).toIntOrNull() ?: return false
    return hours < 24 && minutes < 60
}

/** `is_hex_color`: `#RRGGBB`, ASCII hex digits only. */
private fun isHexColor(value: String): Boolean {
    val bytes = value.toByteArray(Charsets.UTF_8)
    if (bytes.size != 7 || bytes[0] != '#'.code.toByte()) return false
    for (index in 1..6) {
        val byte = bytes[index].toInt() and 0xFF
        val isDigit = byte >= '0'.code && byte <= '9'.code
        val isLower = byte >= 'a'.code && byte <= 'f'.code
        val isUpper = byte >= 'A'.code && byte <= 'F'.code
        if (!isDigit && !isLower && !isUpper) return false
    }
    return true
}

/** `normalise_time`: null/blank → none, otherwise the trimmed `HH:MM` or `時間格式必須是 HH:MM`. */
private fun normaliseTime(value: String?): String? {
    if (value == null) return null
    val trimmed = value.trim()
    if (trimmed.isEmpty()) return null
    if (!isValidTime(trimmed)) fail("時間格式必須是 HH:MM")
    return trimmed
}

// ---------------------------------------------------------------- cursor → wire model

private fun Cursor.columnIndex(name: String): Int = getColumnIndexOrThrow(name)

private fun Cursor.text(name: String): String {
    val index = columnIndex(name)
    return if (isNull(index)) "" else getString(index).orEmpty()
}

private fun Cursor.textOrNull(name: String): String? {
    val index = columnIndex(name)
    return if (isNull(index)) null else getString(index)
}

private fun Cursor.number(name: String): Long = getLong(columnIndex(name))

private fun Cursor.flag(name: String): Boolean = getLong(columnIndex(name)) != 0L

private fun rowToHabit(cursor: Cursor): Habit = Habit(
    id = cursor.number("id"),
    name = cursor.text("name"),
    emoji = cursor.text("emoji"),
    color = cursor.text("color"),
    notes = cursor.text("notes"),
    schedule = cursor.text("schedule"),
    weekdays = parseWeekdays(cursor.text("weekdays")),
    weeklyTarget = cursor.number("weekly_target"),
    timeOfDay = cursor.text("time_of_day"),
    sortOrder = cursor.number("sort_order"),
    archived = cursor.flag("archived"),
    createdAt = cursor.text("created_at"),
)

private fun rowToHabitLog(cursor: Cursor): HabitLog = HabitLog(
    id = cursor.number("id"),
    habitId = cursor.number("habit_id"),
    date = cursor.text("date"),
    note = cursor.text("note"),
    createdAt = cursor.text("created_at"),
)

private fun rowToEvent(cursor: Cursor): EventItem = EventItem(
    id = cursor.number("id"),
    title = cursor.text("title"),
    notes = cursor.text("notes"),
    date = cursor.text("date"),
    startTime = cursor.textOrNull("start_time"),
    endTime = cursor.textOrNull("end_time"),
    allDay = cursor.flag("all_day"),
    color = cursor.text("color"),
    location = cursor.text("location"),
    category = cursor.text("category"),
    source = cursor.textOrNull("source") ?: "local",
    externalId = cursor.textOrNull("external_id"),
    externalCalendar = cursor.textOrNull("external_calendar"),
    externalCalendarId = cursor.textOrNull("external_calendar_id"),
    createdAt = cursor.text("created_at"),
    updatedAt = cursor.text("updated_at"),
)

private fun rowToTask(cursor: Cursor): Task = Task(
    id = cursor.number("id"),
    title = cursor.text("title"),
    notes = cursor.text("notes"),
    status = cursor.text("status"),
    priority = cursor.number("priority"),
    dueDate = cursor.textOrNull("due_date"),
    tags = parseTags(cursor.text("tags")),
    list = cursor.text("list"),
    createdAt = cursor.text("created_at"),
    completedAt = cursor.textOrNull("completed_at"),
    sortOrder = cursor.number("sort_order"),
)

private fun rowToTimetable(cursor: Cursor): TimetableBlock = TimetableBlock(
    id = cursor.number("id"),
    day = cursor.number("day"),
    startTime = cursor.text("start_time"),
    endTime = cursor.text("end_time"),
    title = cursor.text("title"),
    notes = cursor.text("notes"),
    color = cursor.text("color"),
    createdAt = cursor.text("created_at"),
)

// ---------------------------------------------------------------- backup row inserts

private fun content(vararg pairs: Pair<String, Any?>): ContentValues {
    val values = ContentValues()
    for ((key, value) in pairs) {
        when (value) {
            null -> values.putNull(key)
            is String -> values.put(key, value)
            is Boolean -> values.put(key, if (value) 1 else 0)
            is Int -> values.put(key, value)
            is Long -> values.put(key, value)
            else -> values.put(key, value.toString())
        }
    }
    return values
}

private fun insertHabitRow(database: SQLiteDatabase, habit: Habit) {
    database.insertOrThrow(
        "habits",
        null,
        content(
            "id" to habit.id,
            "name" to habit.name,
            "emoji" to habit.emoji,
            "color" to habit.color,
            "notes" to habit.notes,
            "schedule" to habit.schedule,
            "weekdays" to weekdaysToString(habit.weekdays),
            "weekly_target" to habit.weeklyTarget,
            "time_of_day" to habit.timeOfDay,
            "sort_order" to habit.sortOrder,
            "archived" to if (habit.archived) 1 else 0,
            "created_at" to habit.createdAt,
        ),
    )
}

private fun insertLogRow(database: SQLiteDatabase, log: HabitLog) {
    database.insertOrThrow(
        "habit_logs",
        null,
        content(
            "id" to log.id,
            "habit_id" to log.habitId,
            "date" to log.date,
            "note" to log.note,
            "created_at" to log.createdAt,
        ),
    )
}

private fun insertEventRow(database: SQLiteDatabase, event: EventItem) {
    database.insertOrThrow(
        "events",
        null,
        content(
            "id" to event.id,
            "title" to event.title,
            "notes" to event.notes,
            "date" to event.date,
            "start_time" to event.startTime,
            "end_time" to event.endTime,
            "all_day" to if (event.allDay) 1 else 0,
            "color" to event.color,
            "location" to event.location,
            "category" to event.category,
            "source" to event.source,
            "external_id" to event.externalId,
            "external_calendar" to event.externalCalendar,
            "external_calendar_id" to event.externalCalendarId,
            "created_at" to event.createdAt,
            "updated_at" to event.updatedAt,
        ),
    )
}

private fun insertTaskRow(database: SQLiteDatabase, task: Task) {
    database.insertOrThrow(
        "tasks",
        null,
        content(
            "id" to task.id,
            "title" to task.title,
            "notes" to task.notes,
            "status" to task.status,
            "priority" to task.priority,
            "due_date" to task.dueDate,
            "tags" to tagsToString(task.tags),
            "list" to task.list,
            "created_at" to task.createdAt,
            "completed_at" to task.completedAt,
            "sort_order" to task.sortOrder,
        ),
    )
}

private fun insertTimetableRow(database: SQLiteDatabase, block: TimetableBlock) {
    database.insertOrThrow(
        "timetable",
        null,
        content(
            "id" to block.id,
            "day" to block.day,
            "start_time" to block.startTime,
            "end_time" to block.endTime,
            "title" to block.title,
            "notes" to block.notes,
            "color" to block.color,
            "created_at" to block.createdAt,
        ),
    )
}
