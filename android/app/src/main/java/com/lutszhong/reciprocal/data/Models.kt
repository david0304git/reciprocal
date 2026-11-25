package com.lutszhong.reciprocal.data

import kotlinx.serialization.Serializable

/**
 * Wire models mirroring `src-tauri/src/models.rs`.
 *
 * The React frontend receives exactly the same camelCase JSON the Tauri commands produced,
 * so every property name here must stay in sync with the TypeScript types in `web/src/lib/types.ts`.
 */

@Serializable
data class Habit(
    val id: Long,
    val name: String,
    val emoji: String,
    val color: String,
    val notes: String,
    /** daily | weekdays | times_per_week */
    val schedule: String,
    /** 1 = Monday … 7 = Sunday */
    val weekdays: List<Int>,
    val weeklyTarget: Long,
    /** anytime | morning | afternoon | evening */
    val timeOfDay: String,
    val sortOrder: Long,
    val archived: Boolean,
    val createdAt: String,
)

@Serializable
data class HabitInput(
    val id: Long? = null,
    val name: String,
    val emoji: String = "",
    val color: String = "",
    val notes: String = "",
    val schedule: String = "",
    val weekdays: List<Int> = emptyList(),
    val weeklyTarget: Long = 0,
    val timeOfDay: String = "",
    val archived: Boolean = false,
)

@Serializable
data class HabitLog(
    val id: Long,
    val habitId: Long,
    val date: String,
    val note: String,
    val createdAt: String,
)

@Serializable
data class EventItem(
    val id: Long,
    val title: String,
    val notes: String,
    /** YYYY-MM-DD */
    val date: String,
    /** HH:MM (null = all day) */
    val startTime: String? = null,
    val endTime: String? = null,
    val allDay: Boolean,
    val color: String,
    val location: String,
    val category: String,
    /** "local" (created in Reciprocal) or "apple" (imported from the system calendar) */
    val source: String = "local",
    val externalId: String? = null,
    val externalCalendar: String? = null,
    val externalCalendarId: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class EventInput(
    val id: Long? = null,
    val title: String,
    val notes: String = "",
    val date: String,
    val startTime: String? = null,
    val endTime: String? = null,
    val allDay: Boolean = false,
    val color: String = "",
    val location: String = "",
    val category: String = "",
    /** Calendar the event should be mirrored into; null keeps it in the app only. */
    val appleCalendarId: String? = null,
)

@Serializable
data class Task(
    val id: Long,
    val title: String,
    val notes: String,
    /** todo | doing | done */
    val status: String,
    /** 0 none · 1 low · 2 medium · 3 high */
    val priority: Long,
    val dueDate: String? = null,
    val tags: List<String>,
    val list: String,
    val createdAt: String,
    val completedAt: String? = null,
    val sortOrder: Long,
)

@Serializable
data class TaskInput(
    val id: Long? = null,
    val title: String,
    val notes: String = "",
    val status: String = "",
    val priority: Long = 0,
    val dueDate: String? = null,
    val tags: List<String> = emptyList(),
    val list: String = "",
)

@Serializable
data class TimetableBlock(
    val id: Long,
    /** 1 = Monday … 5 = Friday */
    val day: Long,
    /** HH:MM */
    val startTime: String,
    /** HH:MM */
    val endTime: String,
    val title: String,
    val notes: String,
    val color: String,
    val createdAt: String,
)

@Serializable
data class TimetableInput(
    val id: Long? = null,
    val day: Long,
    val startTime: String,
    val endTime: String,
    val title: String,
    val notes: String = "",
    val color: String = "",
)

@Serializable
data class AppData(
    val habits: List<Habit>,
    val logs: List<HabitLog>,
    val events: List<EventItem>,
    val tasks: List<Task>,
    val timetable: List<TimetableBlock>,
    val settings: Map<String, String>,
)

@Serializable
data class BackupData(
    val version: Long,
    val exportedAt: String,
    val habits: List<Habit> = emptyList(),
    val logs: List<HabitLog> = emptyList(),
    val events: List<EventItem> = emptyList(),
    val timetable: List<TimetableBlock> = emptyList(),
    val tasks: List<Task> = emptyList(),
    val settings: Map<String, String> = emptyMap(),
)

@Serializable
data class StorageInfo(
    val dbPath: String,
    val dataDir: String,
    val sizeBytes: Long,
)

// ---------------------------------------------------------------- system calendar

@Serializable
data class CalendarInfo(
    val id: String,
    val title: String,
    val source: String,
    val subscribed: Boolean,
    val kind: String,
    val color: String,
    val allowsModifications: Boolean,
)

@Serializable
data class CalendarStatus(
    val supported: Boolean,
    val enabled: Boolean,
    /** fullAccess | writeOnly | denied | restricted | notDetermined | unsupported */
    val authorization: String,
    val calendarId: String? = null,
    val lastSync: String? = null,
    val importedCount: Long,
    val mirroredCount: Long,
)

@Serializable
data class CalendarsResponse(
    val calendars: List<CalendarInfo>,
    val selected: List<String>,
    val cardSelected: List<String>,
    val eventCalendars: List<CalendarInfo>,
)

// ---------------------------------------------------------------- updates

@Serializable
data class UpdateInfo(
    val currentVersion: String,
    val latestVersion: String? = null,
    val updateAvailable: Boolean,
    val releaseUrl: String? = null,
    val releaseName: String? = null,
    val publishedAt: String? = null,
    /** "release" | "tag" | "none" */
    val source: String,
)
