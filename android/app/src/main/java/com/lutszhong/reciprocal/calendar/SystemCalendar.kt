package com.lutszhong.reciprocal.calendar

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import com.lutszhong.reciprocal.bridge.ActivityHost
import com.lutszhong.reciprocal.data.CalendarInfo
import java.util.Locale
import java.util.TimeZone

/** One occurrence read from the system calendar provider. */
data class CalendarEventRecord(
    val externalId: String,
    val calendarId: String,
    val calendarTitle: String,
    val calendarColor: String,
    val title: String,
    val notes: String,
    val location: String,
    val startMs: Long,
    val endMs: Long,
    val allDay: Boolean,
    val lastModifiedMs: Long,
)

/** What should be written to the system calendar for one app event. */
data class CalendarEventPayload(
    val externalId: String?,
    val title: String,
    val notes: String,
    val location: String,
    val startMs: Long,
    val endMs: Long,
    val allDay: Boolean,
)

/** Error whose message is shown verbatim by the "Apple 日曆" settings card. */
class CalendarException(message: String) : Exception(message)

/** One row of `CalendarContract.Calendars` as the sync layer needs it. */
private data class SystemCalendarRow(
    val id: String,
    val title: String,
    val accountName: String,
    val accountType: String,
    val color: String,
    val allowsModifications: Boolean,
    val primary: Boolean,
    val visible: Boolean,
)

/**
 * Android counterpart of `src-tauri/src/apple.rs`: reads and writes events through
 * `CalendarContract` with the user's READ_CALENDAR / WRITE_CALENDAR permissions.
 *
 * Mapping notes:
 * - EventKit `eventIdentifier` → `android-<Events._ID>-<occurrence begin ms>`. An occurrence
 *   suffix is required because [Instances] expands recurrences into several rows that share one
 *   `Events._ID` and because `events` rows are keyed by external id.
 * - EventKit's dedicated "Reciprocal" calendar → a local calendar
 *   (`ACCOUNT_TYPE_LOCAL` + `CALLER_IS_SYNCADAPTER=true`), the approach the Android calendar
 *   provider documents for apps that are not sync adapters.
 * - There is no Android column for "last modified" on an event, so [CalendarEventRecord.lastModifiedMs]
 *   stays 0 (nothing in the import path uses it, mirroring `apple.rs`).
 */
class SystemCalendar(private val context: Context, private val host: ActivityHost) {

    private val resolver get() = context.contentResolver

    private val prefs by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // ------------------------------------------------------------------ permissions

    /** True when the device actually exposes a calendar provider. */
    fun isSupported(): Boolean =
        context.packageManager.resolveContentProvider(CalendarContract.AUTHORITY, 0) != null

    /**
     * EventKit-compatible authorization string:
     * `fullAccess | restricted | denied | notDetermined | unsupported | writeOnly`.
     *
     * Android has no "not asked yet" API (`shouldShowRequestPermissionRationale` is also false
     * before the first request), so "was the dialog ever shown" is remembered in
     * [markPermissionRequested]:
     * - read + write granted → `fullAccess`;
     * - exactly one granted (only possible via app-ops) → `restricted`;
     * - neither granted, dialog already shown and no longer askable → `denied`;
     * - neither granted, still askable (or never asked) → `notDetermined`.
     *
     * `writeOnly` is never returned: Android grants calendar read and write as one permission
     * group, so EventKit's write-without-read state has no equivalent.
     */
    fun authorizationStatus(): String {
        if (!isSupported()) return "unsupported"
        val read = host.hasPermission(Manifest.permission.READ_CALENDAR)
        val write = host.hasPermission(Manifest.permission.WRITE_CALENDAR)
        if (read && write) return "fullAccess"
        if (read != write) return "restricted"
        val permanentlyDenied =
            host.isPermissionPermanentlyDenied(Manifest.permission.READ_CALENDAR) &&
                host.isPermissionPermanentlyDenied(Manifest.permission.WRITE_CALENDAR)
        return if (permissionAsked && permanentlyDenied) "denied" else "notDetermined"
    }

    fun hasFullAccess(): Boolean = authorizationStatus() == "fullAccess"

    /** Remembers that the runtime permission dialog has been requested at least once. */
    fun markPermissionRequested() {
        prefs.edit().putBoolean(KEY_PERMISSION_ASKED, true).apply()
    }

    private val permissionAsked: Boolean
        get() = prefs.getBoolean(KEY_PERMISSION_ASKED, false)

    // ------------------------------------------------------------------ calendars

    /** Finds (or creates) the app-owned "Reciprocal" calendar and returns its id. */
    fun ensureCalendar(): String {
        requireFullAccess()
        findCalendarByName(CALENDAR_TITLE)?.let { return it }

        val values = ContentValues().apply {
            put(Calendars.ACCOUNT_NAME, ACCOUNT_NAME)
            put(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            put(Calendars.NAME, ACCOUNT_NAME)
            put(Calendars.CALENDAR_DISPLAY_NAME, CALENDAR_TITLE)
            put(Calendars.CALENDAR_COLOR, BRAND_COLOR)
            put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER)
            put(Calendars.OWNER_ACCOUNT, ACCOUNT_NAME)
            put(Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().id)
            put(Calendars.VISIBLE, 1)
            put(Calendars.SYNC_EVENTS, 1)
        }
        // The documented way for a non-sync-adapter app to create a local calendar: the provider
        // only accepts Calendars inserts that look like they come from a sync adapter.
        val uri = Calendars.CONTENT_URI.buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(Calendars.ACCOUNT_NAME, ACCOUNT_NAME)
            .appendQueryParameter(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            .build()
        val inserted = try {
            resolver.insert(uri, values)
        } catch (error: Exception) {
            throw CalendarException(
                "建立「Reciprocal」日曆失敗：${error.message ?: error.javaClass.simpleName}",
            )
        } ?: throw CalendarException("建立「Reciprocal」日曆失敗：系統拒絕寫入本機日曆。")

        val id = ContentUris.parseId(inserted)
        if (id <= 0L) {
            throw CalendarException("建立「Reciprocal」日曆失敗：系統沒有回傳日曆 ID。")
        }
        return id.toString()
    }

    fun listCalendars(): List<CalendarInfo> {
        requireFullAccess()
        return calendarRows().map { row ->
            CalendarInfo(
                id = row.id,
                title = row.title.ifEmpty { row.accountName },
                source = row.accountName,
                // EventKit's "subscribed" means a read-only feed; Android's closest signal is
                // an access level below CONTRIBUTOR (holiday feeds, shared read-only calendars).
                subscribed = !row.allowsModifications,
                kind = when {
                    // A calendar we cannot write to is a feed/subscription whatever its account
                    // type; EventKit's EKCalendarType::Subscription has the same meaning.
                    !row.allowsModifications -> "subscription"
                    row.accountType == CalendarContract.ACCOUNT_TYPE_LOCAL -> "local"
                    row.accountType.isNotEmpty() -> row.accountType
                    else -> "caldav"
                },
                color = row.color,
                allowsModifications = row.allowsModifications,
            )
        }
    }

    /**
     * Occurrences overlapping `[startMs, endMs)` from the given calendars, with recurrences
     * expanded by [Instances]. An empty [calendarIds] means "every calendar"; `excludeCalendarId`
     * is skipped in both cases (the sync layer always excludes the dedicated Reciprocal calendar).
     */
    fun fetchEvents(
        startMs: Long,
        endMs: Long,
        calendarIds: List<String>,
        excludeCalendarId: String?,
    ): List<CalendarEventRecord> {
        requireFullAccess()
        if (endMs <= startMs) return emptyList()

        val rows = calendarRows().associateBy { it.id }
        val allowed = calendarIds.mapNotNull { it.toLongOrNull() }.toSet()
        val excluded = excludeCalendarId?.toLongOrNull()
        val selected = rows.values.filter { row ->
            val id = row.id.toLongOrNull() ?: return@filter false
            (excluded == null || id != excluded) && (allowed.isEmpty() || allowed.contains(id))
        }
        if (selected.isEmpty()) return emptyList()

        val builder = Instances.CONTENT_URI.buildUpon()
        ContentUris.appendId(builder, startMs)
        ContentUris.appendId(builder, endMs)
        val placeholders = selected.joinToString(",") { "?" }
        val selection = "${Instances.CALENDAR_ID} IN ($placeholders)"
        val selectionArgs = selected.map { it.id }.toTypedArray()
        val projection = arrayOf(
            Instances.EVENT_ID,      // 0
            Instances.CALENDAR_ID,   // 1
            Instances.BEGIN,         // 2
            Instances.END,           // 3
            Instances.ALL_DAY,       // 4
            Instances.TITLE,         // 5
            Instances.EVENT_LOCATION,// 6
            Instances.DESCRIPTION,   // 7
        )

        val records = mutableListOf<CalendarEventRecord>()
        val cursor = try {
            resolver.query(builder.build(), projection, selection, selectionArgs, "${Instances.BEGIN} ASC")
        } catch (error: Exception) {
            throw CalendarException("讀取系統日曆失敗：${error.message ?: error.javaClass.simpleName}")
        } ?: throw CalendarException("讀取系統日曆失敗：系統日曆服務沒有回應。")

        cursor.use { c ->
            while (c.moveToNext()) {
                val eventId = c.getLong(0)
                val begin = c.getLong(2)
                if (begin < startMs || begin >= endMs) continue
                val calendarId = c.getLong(1).toString()
                val row = rows[calendarId] ?: continue
                records += CalendarEventRecord(
                    externalId = externalId(eventId, begin),
                    calendarId = calendarId,
                    calendarTitle = row.title,
                    calendarColor = row.color,
                    title = c.getString(5) ?: "",
                    notes = c.getString(7) ?: "",
                    location = c.getString(6) ?: "",
                    startMs = begin,
                    endMs = c.getLong(3),
                    allDay = c.getInt(4) != 0,
                    lastModifiedMs = 0L,
                )
            }
        }
        return records
    }

    // ------------------------------------------------------------------ events

    /**
     * Inserts or updates one event and returns its occurrence-specific external id.
     *
     * All-day events must be passed as UTC midnight boundaries (`EVENT_TIMEZONE="UTC"`), which is
     * how the calendar provider stores them; timed events use the device time zone.
     */
    fun upsertEvent(calendarId: String, payload: CalendarEventPayload): String {
        requireFullAccess()
        val targetId = calendarId.toLongOrNull()
            ?: throw CalendarException("找不到 Reciprocal 日曆，請重新連結系統日曆。")
        val target = calendarRows().firstOrNull { it.id == calendarId }
            ?: throw CalendarException("找不到 Reciprocal 日曆，請重新連結系統日曆。")
        if (!target.allowsModifications) {
            throw CalendarException("日曆「${target.title}」是唯讀的，無法寫入行程。")
        }

        val values = ContentValues().apply {
            put(Events.CALENDAR_ID, targetId)
            put(Events.TITLE, payload.title)
            put(Events.DESCRIPTION, payload.notes.ifBlank { null })
            put(Events.EVENT_LOCATION, payload.location.ifBlank { null })
            put(Events.DTSTART, payload.startMs)
            put(Events.DTEND, payload.endMs)
            put(Events.ALL_DAY, if (payload.allDay) 1 else 0)
            put(
                Events.EVENT_TIMEZONE,
                if (payload.allDay) "UTC" else TimeZone.getDefault().id,
            )
            put(Events.STATUS, Events.STATUS_CONFIRMED)
        }

        val existingId = payload.externalId?.let { parseExternalId(it)?.first }
        val eventId = if (existingId != null) {
            try {
                val updated = resolver.update(
                    ContentUris.withAppendedId(Events.CONTENT_URI, existingId),
                    values,
                    null,
                    null,
                )
                if (updated > 0) existingId else insertEvent(values)
            } catch (error: Exception) {
                throw CalendarException(
                    "更新系統日曆行程失敗：${error.message ?: error.javaClass.simpleName}",
                )
            }
        } else {
            insertEvent(values)
        }
        return externalId(eventId, payload.startMs)
    }

    /**
     * Deletes the mirrored occurrence. App-created events are never recurring, so removing the
     * `Events` row is the exact "this event only" span EventKit is given upstream.
     */
    fun deleteEvent(externalId: String) {
        requireFullAccess()
        val eventId = parseExternalId(externalId)?.first
            ?: throw CalendarException("無法識別要刪除的系統行程：$externalId")
        try {
            resolver.delete(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), null, null)
        } catch (error: Exception) {
            throw CalendarException(
                "刪除系統日曆行程失敗：${error.message ?: error.javaClass.simpleName}",
            )
        }
    }

    // ------------------------------------------------------------------ internals

    private fun requireFullAccess() {
        if (!host.hasPermission(Manifest.permission.READ_CALENDAR) ||
            !host.hasPermission(Manifest.permission.WRITE_CALENDAR)
        ) {
            throw CalendarException("需要日曆權限才能讀取或寫入系統日曆。")
        }
    }

    private fun findCalendarByName(name: String): String? {
        val selection = "${Calendars.CALENDAR_DISPLAY_NAME} = ?"
        resolver.query(
            Calendars.CONTENT_URI,
            arrayOf(Calendars._ID),
            selection,
            arrayOf(name),
            "${Calendars._ID} ASC",
        )?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getLong(0).toString()
        }
        return null
    }

    private fun calendarRows(): List<SystemCalendarRow> {
        val projection = arrayOf(
            Calendars._ID,                  // 0
            Calendars.CALENDAR_DISPLAY_NAME,// 1
            Calendars.ACCOUNT_NAME,         // 2
            Calendars.ACCOUNT_TYPE,         // 3
            Calendars.IS_PRIMARY,           // 4
            Calendars.CALENDAR_COLOR,       // 5
            Calendars.CALENDAR_ACCESS_LEVEL,// 6
            Calendars.VISIBLE,              // 7
            Calendars.DELETED,              // 8
        )
        val cursor = try {
            resolver.query(Calendars.CONTENT_URI, projection, null, null, "${Calendars._ID} ASC")
        } catch (error: Exception) {
            throw CalendarException(
                "讀取系統日曆清單失敗：${error.message ?: error.javaClass.simpleName}",
            )
        } ?: throw CalendarException("讀取系統日曆清單失敗：系統日曆服務沒有回應。")

        val rows = mutableListOf<SystemCalendarRow>()
        cursor.use { c ->
            while (c.moveToNext()) {
                if (!c.isNull(8) && c.getInt(8) != 0) continue
                val access = if (c.isNull(6)) Calendars.CAL_ACCESS_OWNER else c.getInt(6)
                val color = if (c.isNull(5) || c.getInt(5) == 0) {
                    FALLBACK_COLOR
                } else {
                    argbToHex(c.getInt(5))
                }
                val accountType = c.getString(3) ?: ""
                rows += SystemCalendarRow(
                    id = c.getLong(0).toString(),
                    title = c.getString(1) ?: "",
                    accountName = c.getString(2) ?: "",
                    accountType = accountType,
                    color = color,
                    // Below CONTRIBUTOR the calendar is read-only for third-party apps; this also
                    // covers subscribed/feed calendars.
                    allowsModifications = access >= Calendars.CAL_ACCESS_CONTRIBUTOR,
                    primary = !c.isNull(4) && c.getInt(4) != 0,
                    visible = c.isNull(7) || c.getInt(7) != 0,
                )
            }
        }
        return rows
    }

    private fun insertEvent(values: ContentValues): Long {
        val inserted = try {
            resolver.insert(Events.CONTENT_URI, values)
        } catch (error: Exception) {
            throw CalendarException(
                "寫入系統日曆失敗：${error.message ?: error.javaClass.simpleName}",
            )
        } ?: throw CalendarException("寫入系統日曆失敗：系統拒絕新增行程。")
        val id = ContentUris.parseId(inserted)
        if (id <= 0L) throw CalendarException("寫入系統日曆失敗：系統沒有回傳行程 ID。")
        return id
    }

    private fun externalId(eventId: Long, beginMs: Long): String = "$EXTERNAL_PREFIX$eventId-$beginMs"

    /** Parses `android-<eventId>-<beginMs>`; null for anything this app did not write. */
    private fun parseExternalId(value: String): Pair<Long, Long>? {
        if (!value.startsWith(EXTERNAL_PREFIX)) return null
        val rest = value.substring(EXTERNAL_PREFIX.length)
        val separator = rest.indexOf('-')
        if (separator <= 0) return null
        val eventId = rest.substring(0, separator).toLongOrNull() ?: return null
        val begin = rest.substring(separator + 1).toLongOrNull() ?: return null
        return eventId to begin
    }

    private fun argbToHex(value: Int): String =
        String.format(Locale.US, "#%06X", value and 0xFFFFFF)

    private companion object {
        const val PREFS_NAME = "reciprocal.calendar"
        const val KEY_PERMISSION_ASKED = "calendarPermissionRequested"

        const val EXTERNAL_PREFIX = "android-"

        /** Title/first match of the app-owned calendar, same as `apple::CALENDAR_TITLE`. */
        const val CALENDAR_TITLE = "Reciprocal"
        const val ACCOUNT_NAME = "Reciprocal"

        /** Brand green `#2F6B57`, the RGB of `CGColor::new_generic_rgb(0.184, 0.420, 0.341, 1.0)`. */
        val BRAND_COLOR = 0xFF2F6B57.toInt()

        /** Mirrors the EventKit fallback colour in `apple.rs`. */
        const val FALLBACK_COLOR = "#5B7DB1"
    }
}
