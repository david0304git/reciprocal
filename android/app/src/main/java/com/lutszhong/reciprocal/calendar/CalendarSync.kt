package com.lutszhong.reciprocal.calendar

import android.database.Cursor
import android.util.Log
import com.lutszhong.reciprocal.data.AppData
import com.lutszhong.reciprocal.data.CalendarStatus
import com.lutszhong.reciprocal.data.CalendarsResponse
import com.lutszhong.reciprocal.data.EventItem
import com.lutszhong.reciprocal.data.ReciprocalDb
import com.lutszhong.reciprocal.data.Store
import com.lutszhong.reciprocal.data.nowIso
import org.json.JSONArray
import org.json.JSONException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Two-way sync between the app database and the system calendar — the Android port of
 * `sync_apple_inner` in `src-tauri/src/commands.rs` plus the sync helpers in `store.rs`
 * (`apply_imported_events`, `push_candidates`, `mark_event_synced`, tombstones).
 *
 * Settings keys stay identical to the desktop app so backups stay interchangeable:
 * `appleSyncEnabled`, `appleCalendarId`, `appleSyncLastAt`, `appleImportCalendarIds`,
 * `appleCardCalendarIds`, `appleImportPastDays`, `appleImportFutureDays`.
 *
 * The store-only helpers (`apply_imported_events`, `push_candidates`, `mark_event_synced`,
 * tombstone queue) are not exposed by [Store], so this class runs the same SQL through
 * [Store.use] instead of extending the data layer.
 */
class CalendarSync(
    private val db: ReciprocalDb,
    private val store: Store,
    private val calendar: SystemCalendar,
) {

    /**
     * The desktop app serializes every command behind one `Mutex<Connection>`; on Android the
     * bridge already runs commands on a single thread, but a permission callback continues on the
     * worker thread in [CalendarCommands]. This lock keeps two "push" passes from writing the same
     * app event into the system calendar twice.
     */
    private val syncLock = Any()

    // ------------------------------------------------------------------ presentation

    fun status(): CalendarStatus = CalendarStatus(
        supported = calendar.isSupported(),
        enabled = enabled(),
        authorization = calendar.authorizationStatus(),
        calendarId = setting(KEY_CALENDAR_ID),
        lastSync = setting(KEY_LAST_SYNC),
        importedCount = store.countEventsBySource(SOURCE_IMPORTED),
        mirroredCount = store.countMirroredEvents(),
    )

    fun enabled(): Boolean = setting(KEY_ENABLED) == "1"

    fun authorizationStatus(): String = calendar.authorizationStatus()

    fun isSupported(): Boolean = calendar.isSupported()

    fun markPermissionRequested() = calendar.markPermissionRequested()

    // ------------------------------------------------------------------ commands

    /** Assumes calendar permission is already granted. */
    fun connect(): AppData = synchronized(syncLock) {
        val authorization = calendar.authorizationStatus()
        if (authorization != "fullAccess") {
            throw CalendarException("需要完整的日曆存取權限才能雙向同步。")
        }
        val calendarId = calendar.ensureCalendar()
        putSetting(KEY_ENABLED, "1")
        putSetting(KEY_CALENDAR_ID, calendarId)
        syncInner()
    }

    fun disconnect(): AppData {
        putSetting(KEY_ENABLED, "0")
        return store.loadApp()
    }

    /** Assumes calendar permission is already granted. */
    fun sync(): AppData = synchronized(syncLock) { syncInner() }

    fun calendars(): CalendarsResponse = synchronized(syncLock) {
        if (calendar.authorizationStatus() != "fullAccess") {
            throw CalendarException("需要日曆權限才能選擇要匯入的日曆。")
        }
        val all = calendar.listCalendars()
        val writable = all.filter { it.allowsModifications }
        val dedicated = setting(KEY_CALENDAR_ID)
        val visible = if (dedicated.isNullOrEmpty()) {
            all
        } else {
            all.filter { it.id != dedicated }
        }
        val selected = importFilter() ?: visible.map { it.id }
        val cardSelected = cardSelection() ?: selected
        CalendarsResponse(
            calendars = visible,
            selected = selected,
            cardSelected = cardSelected,
            eventCalendars = writable,
        )
    }

    fun setCalendars(ids: List<String>): AppData = synchronized(syncLock) {
        putSetting(KEY_IMPORT_CALENDARS, JSONArray(ids).toString())
        syncInner()
    }

    // ------------------------------------------------------------------ sync core

    /** Mirrors `sync_apple_inner`; the caller has already granted the calendar permission. */
    private fun syncInner(): AppData {
        if (!enabled()) throw CalendarException("尚未連結 Apple 日曆")
        if (calendar.authorizationStatus() != "fullAccess") {
            throw CalendarException(
                "日曆權限已被關閉，請到「設定 → 應用程式 → Reciprocal → 權限」開啟「日曆」權限。",
            )
        }

        // Resolve the dedicated calendar; a backup restored from another device can carry an id
        // that does not exist here, in which case the calendar is re-created.
        var calendars = calendar.listCalendars()
        val storedCalendarId = setting(KEY_CALENDAR_ID)?.takeIf { it.isNotEmpty() }
        val calendarId: String
        if (storedCalendarId == null || calendars.none { it.id == storedCalendarId }) {
            calendarId = calendar.ensureCalendar()
            putSetting(KEY_CALENDAR_ID, calendarId)
            calendars = calendar.listCalendars()
        } else {
            calendarId = storedCalendarId
        }

        val pendingDeletions = pendingTombstones()
        for (externalId in pendingDeletions) {
            try {
                calendar.deleteEvent(externalId)
                clearTombstone(externalId)
            } catch (error: Exception) {
                // Mirrors `eprintln!` upstream: the tombstone stays queued for the next sync.
                Log.w(TAG, "系統行程刪除失敗：$externalId", error)
            }
        }

        val calendarInfo = calendars.associate { it.id to (it.title to it.allowsModifications) }

        val (pastDays, futureDays) = store.appleImportRangeDays()
        val now = System.currentTimeMillis()
        val startMs = now - pastDays.coerceIn(1L, MAX_IMPORT_DAYS) * DAY_MS
        val endMs = now + futureDays.coerceIn(1L, MAX_IMPORT_DAYS) * DAY_MS

        val filter = importFilter()
        val records = when {
            // An explicit empty selection means "import nothing" (unchecked every calendar).
            filter != null && filter.isEmpty() -> emptyList()
            filter != null -> calendar.fetchEvents(startMs, endMs, filter, calendarId)
            else -> calendar.fetchEvents(startMs, endMs, emptyList(), calendarId)
        }

        val excluded = store.localExternalIds().toMutableSet()
        excluded.addAll(pendingDeletions)
        val imported = records
            .filter { it.externalId !in excluded }
            .map(::importedFromRecord)
        applyImportedEvents(imported)

        for (event in pushCandidates()) {
            val payload = try {
                eventPayload(event)
            } catch (error: Exception) {
                Log.w(TAG, "行程無法轉成系統日曆時間：${event.id}", error)
                continue
            }
            val target = event.externalCalendarId
                ?.takeIf { calendarInfo[it]?.second == true }
                ?: calendarId
            val targetTitle = calendarInfo[target]?.first ?: ""
            try {
                val externalId = calendar.upsertEvent(target, payload)
                if (externalId.isNotEmpty()) {
                    markEventSynced(event.id, externalId, target, targetTitle)
                } else {
                    Log.w(TAG, "系統日曆回傳空 external_id：${event.id}")
                }
            } catch (error: Exception) {
                Log.w(TAG, "行程寫入系統日曆失敗：${event.id}", error)
            }
        }

        putSetting(KEY_LAST_SYNC, nowIso())
        return store.loadApp()
    }

    // ------------------------------------------------------------------ imported events

    private data class ImportedEvent(
        val externalId: String,
        val calendarId: String,
        val calendarTitle: String,
        val color: String,
        val title: String,
        val notes: String,
        val location: String,
        val date: String,
        val startTime: String?,
        val endTime: String?,
        val allDay: Boolean,
    )

    private data class ExistingImport(val id: Long, val key: String)

    /**
     * Port of `imported_from_record` in `commands.rs`.
     *
     * All-day occurrences must be turned into a date in UTC: the calendar provider stores all-day
     * `DTSTART` as a UTC midnight, so formatting in the device zone would shift the date for
     * time zones west of UTC. Timed occurrences use the device zone, like the desktop app.
     */
    private fun importedFromRecord(record: CalendarEventRecord): ImportedEvent {
        if (record.allDay) {
            val start = Instant.ofEpochMilli(record.startMs).atZone(ZoneOffset.UTC)
            return ImportedEvent(
                externalId = record.externalId,
                calendarId = record.calendarId,
                calendarTitle = record.calendarTitle,
                color = record.calendarColor,
                title = record.title.ifBlank { "(未命名行程)" },
                notes = record.notes,
                location = record.location,
                date = start.toLocalDate().toString(),
                startTime = null,
                endTime = null,
                allDay = true,
            )
        }
        val zone = ZoneId.systemDefault()
        val start = Instant.ofEpochMilli(record.startMs).atZone(zone)
        val end = Instant.ofEpochMilli(record.endMs).atZone(zone)
        return ImportedEvent(
            externalId = record.externalId,
            calendarId = record.calendarId,
            calendarTitle = record.calendarTitle,
            color = record.calendarColor,
            title = record.title.ifBlank { "(未命名行程)" },
            notes = record.notes,
            location = record.location,
            date = start.toLocalDate().toString(),
            startTime = start.format(TIME_FORMAT),
            endTime = end.format(TIME_FORMAT),
            allDay = false,
        )
    }

    /**
     * Port of `store::apply_imported_events`: upserts by
     * `external_id|date|start_time|all_day` and deletes imported rows whose occurrence disappeared.
     * Local events are never touched.
     */
    private fun applyImportedEvents(items: List<ImportedEvent>) {
        store.use { database ->
            val existing = mutableListOf<ExistingImport>()
            database.rawQuery(EXISTING_IMPORTS_SQL, null).use { cursor ->
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(0)
                    val externalId = cursor.getString(1) ?: continue
                    val date = cursor.getString(2) ?: ""
                    val startTime = cursor.getStringOrNull(3)
                    val allDay = cursor.getInt(4) != 0
                    existing += ExistingImport(id, importKey(externalId, date, startTime, allDay))
                }
            }
            val existingByKey = existing.associateBy { it.key }
            val incoming = items
                .filter { it.date.isNotEmpty() }
                .mapTo(mutableSetOf()) { importKey(it.externalId, it.date, it.startTime, it.allDay) }
            val seen = mutableSetOf<String>()

            for (item in items) {
                if (item.date.isEmpty()) continue
                val key = importKey(item.externalId, item.date, item.startTime, item.allDay)
                // EventKit/Instances can hand back the same occurrence twice; the key is the
                // identity, so later copies must not insert a second row.
                if (!seen.add(key)) continue

                val existingRow = existingByKey[key]
                if (existingRow != null) {
                    database.execSQL(
                        UPDATE_IMPORTED_SQL,
                        arrayOf<Any?>(
                            item.title,
                            item.notes,
                            item.date,
                            item.startTime,
                            item.endTime,
                            if (item.allDay) 1 else 0,
                            item.location,
                            item.calendarTitle,
                            item.color,
                            item.calendarTitle,
                            item.calendarId,
                            existingRow.id,
                        ),
                    )
                } else {
                    database.execSQL(
                        INSERT_IMPORTED_SQL,
                        arrayOf<Any?>(
                            item.title,
                            item.notes,
                            item.date,
                            item.startTime,
                            item.endTime,
                            if (item.allDay) 1 else 0,
                            item.color,
                            item.location,
                            item.calendarTitle,
                            item.externalId,
                            item.calendarTitle,
                            item.calendarId,
                        ),
                    )
                }
            }

            for (row in existing) {
                if (row.key !in incoming) {
                    database.execSQL("DELETE FROM events WHERE id = ?", arrayOf<Any?>(row.id))
                }
            }
        }
    }

    // ------------------------------------------------------------------ pushed events

    /**
     * Port of `store::push_candidates`: local events that were never written or changed since the
     * last successful write.
     */
    private fun pushCandidates(): List<EventItem> {
        val items = mutableListOf<EventItem>()
        store.use { database ->
            database.rawQuery(PUSH_CANDIDATES_SQL, null).use { cursor ->
                while (cursor.moveToNext()) {
                    items += cursor.toEventItem()
                }
            }
        }
        return items
    }

    /**
     * Port of `apple_payload` in `commands.rs`. All-day events use UTC midnight boundaries and
     * `EVENT_TIMEZONE="UTC"` because that is how Android's calendar provider stores them;
     * the desktop version uses local midnight because EventKit takes local dates.
     */
    private fun eventPayload(event: EventItem): CalendarEventPayload {
        val date = try {
            LocalDate.parse(event.date)
        } catch (error: Exception) {
            throw CalendarException("行程日期格式不正確")
        }
        val allDay = event.allDay || event.startTime == null
        if (allDay) {
            val start = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            return CalendarEventPayload(
                externalId = event.externalId,
                title = event.title,
                notes = event.notes,
                location = event.location,
                startMs = start,
                endMs = start + DAY_MS,
                allDay = true,
            )
        }
        val startTime = parseTime(event.startTime) ?: LocalTime.of(9, 0)
        val zone = ZoneId.systemDefault()
        val start = date.atTime(startTime).atZone(zone).toInstant().toEpochMilli()
        val endTime = parseTime(event.endTime)?.takeIf { it > startTime }
        val end = if (endTime != null) {
            date.atTime(endTime).atZone(zone).toInstant().toEpochMilli()
        } else {
            start + HOUR_MS
        }
        return CalendarEventPayload(
            externalId = event.externalId,
            title = event.title,
            notes = event.notes,
            location = event.location,
            startMs = start,
            endMs = end,
            allDay = false,
        )
    }

    private fun markEventSynced(
        id: Long,
        externalId: String,
        calendarId: String,
        calendarTitle: String,
    ) {
        store.use { database ->
            database.execSQL(
                MARK_SYNCED_SQL,
                arrayOf<Any?>(externalId, calendarTitle, calendarId, id),
            )
        }
    }

    // ------------------------------------------------------------------ tombstones

    /** Port of `store::pending_tombstones`. */
    private fun pendingTombstones(): List<String> {
        val ids = mutableListOf<String>()
        store.use { database ->
            database.rawQuery(
                "SELECT external_id FROM deleted_external_events ORDER BY created_at ASC",
                null,
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    cursor.getString(0)?.let { ids += it }
                }
            }
        }
        return ids
    }

    /** Port of `store::clear_tombstone`. */
    private fun clearTombstone(externalId: String) {
        store.use { database ->
            database.execSQL(
                "DELETE FROM deleted_external_events WHERE external_id = ?",
                arrayOf<Any?>(externalId),
            )
        }
    }

    // ------------------------------------------------------------------ settings / filters

    private fun setting(key: String): String? = store.getSetting(key)

    private fun putSetting(key: String, value: String) = store.setSetting(key, value)

    /**
     * `appleImportCalendarIds`: null means "no filter yet" (import every calendar), an empty list
     * means "import nothing". Broken JSON collapses to an empty list exactly like
     * `serde_json::from_str(...).unwrap_or_default()` in `parse_calendar_filter`.
     */
    private fun importFilter(): List<String>? {
        val raw = setting(KEY_IMPORT_CALENDARS) ?: return null
        return parseStringArray(raw) ?: emptyList()
    }

    /** `appleCardCalendarIds`; broken JSON falls back to the import selection upstream. */
    private fun cardSelection(): List<String>? =
        setting(KEY_CARD_CALENDARS)?.let(::parseStringArray)

    private fun parseStringArray(raw: String): List<String>? = try {
        val array = JSONArray(raw)
        buildList {
            for (index in 0 until array.length()) add(array.getString(index))
        }
    } catch (error: JSONException) {
        null
    }

    // ------------------------------------------------------------------ helpers

    private fun importKey(
        externalId: String,
        date: String,
        startTime: String?,
        allDay: Boolean,
    ): String = "$externalId|$date|${startTime ?: ""}|${if (allDay) 1 else 0}"

    private fun parseTime(raw: String?): LocalTime? {
        if (raw.isNullOrBlank()) return null
        val match = TIME_PATTERN.matchEntire(raw.trim()) ?: return null
        val hour = match.groupValues[1].toIntOrNull() ?: return null
        val minute = match.groupValues[2].toIntOrNull() ?: return null
        if (hour !in 0..23 || minute !in 0..59) return null
        return LocalTime.of(hour, minute)
    }

    private fun Cursor.getStringOrNull(index: Int): String? =
        if (isNull(index)) null else getString(index)

    private fun Cursor.toEventItem(): EventItem = EventItem(
        id = getLong(0),
        title = getString(1) ?: "",
        notes = getString(2) ?: "",
        date = getString(3) ?: "",
        startTime = getStringOrNull(4),
        endTime = getStringOrNull(5),
        allDay = getInt(6) != 0,
        color = getString(7) ?: "",
        location = getString(8) ?: "",
        category = getString(9) ?: "",
        source = getString(10) ?: "local",
        externalId = getStringOrNull(11),
        externalCalendar = getStringOrNull(12),
        externalCalendarId = getStringOrNull(13),
        createdAt = getString(14) ?: "",
        updatedAt = getString(15) ?: "",
    )

    private companion object {
        const val TAG = "ReciprocalCalendar"

        const val KEY_ENABLED = "appleSyncEnabled"
        const val KEY_CALENDAR_ID = "appleCalendarId"
        const val KEY_LAST_SYNC = "appleSyncLastAt"
        const val KEY_IMPORT_CALENDARS = "appleImportCalendarIds"
        const val KEY_CARD_CALENDARS = "appleCardCalendarIds"

        const val SOURCE_IMPORTED = "apple"

        const val DAY_MS = 24L * 60L * 60L * 1000L
        const val HOUR_MS = 60L * 60L * 1000L
        const val MAX_IMPORT_DAYS = 3650L

        val TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        val TIME_PATTERN = Regex("^(\\d{1,2}):(\\d{2})$")

        const val EXISTING_IMPORTS_SQL =
            "SELECT id, external_id, date, start_time, all_day FROM events " +
                "WHERE source = 'apple' AND external_id IS NOT NULL"

        const val UPDATE_IMPORTED_SQL =
            "UPDATE events SET title = ?, notes = ?, date = ?, start_time = ?, end_time = ?, " +
                "all_day = ?, location = ?, category = ?, color = ?, external_calendar = ?, " +
                "external_calendar_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
                "WHERE source = 'apple' AND id = ?"

        const val INSERT_IMPORTED_SQL =
            "INSERT INTO events (title, notes, date, start_time, end_time, all_day, color, " +
                "location, category, source, external_id, external_calendar, external_calendar_id) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'apple', ?, ?, ?)"

        const val PUSH_CANDIDATES_SQL =
            "SELECT id, title, notes, date, start_time, end_time, all_day, color, location, " +
                "category, source, external_id, external_calendar, external_calendar_id, " +
                "created_at, updated_at FROM events WHERE source = 'local' " +
                "AND (external_id IS NULL OR synced_at IS NULL OR updated_at > synced_at) " +
                "ORDER BY id ASC"

        const val MARK_SYNCED_SQL =
            "UPDATE events SET external_id = ?, external_calendar = ?, external_calendar_id = ?, " +
                "synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    }
}
