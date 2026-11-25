package com.lutszhong.reciprocal.calendar

import android.Manifest
import android.content.Context
import android.util.Log
import com.lutszhong.reciprocal.bridge.ActivityHost
import com.lutszhong.reciprocal.bridge.CommandGroup
import com.lutszhong.reciprocal.bridge.Responder
import com.lutszhong.reciprocal.data.AppData
import com.lutszhong.reciprocal.data.AppJson
import com.lutszhong.reciprocal.data.CalendarStatus
import com.lutszhong.reciprocal.data.CalendarsResponse
import com.lutszhong.reciprocal.data.Store
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The `apple_*` command names are kept verbatim: the bundled frontend calls them and renders the
 * same "Apple 日曆" card, now backed by the Android system calendar.
 *
 * `apple_connect` / `apple_sync` / `apple_calendars` / `apple_set_calendars` need READ_CALENDAR +
 * WRITE_CALENDAR. Runtime permission requests are asynchronous, so the handler claims the command
 * and answers the [Responder] later (possibly from the permission callback).
 */
class CalendarCommands(
    @Suppress("unused") private val context: Context,
    private val host: ActivityHost,
    @Suppress("unused") private val store: Store,
    private val sync: CalendarSync,
) : CommandGroup {

    /** Serializes the work that continues after a permission dialog (never the UI thread). */
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "reciprocal-calendar").apply { isDaemon = true }
    }

    /**
     * [ActivityHost.requestPermissions] keeps a single pending callback, so the calendar layer only
     * ever asks once: extra `apple_connect` calls made while the dialog is up wait in this queue and
     * are answered from the same callback.
     */
    private val permissionLock = Any()

    @Volatile
    private var permissionRequestInFlight = false
    private val permissionQueue = mutableListOf<Pair<Responder, () -> String>>()

    override fun handle(command: String, args: JSONObject, responder: Responder): Boolean = when (command) {
        "apple_status" -> {
            guarded(responder) {
                AppJson.json.encodeToString(CalendarStatus.serializer(), sync.status())
            }
            true
        }

        "apple_disconnect" -> {
            guarded(responder) {
                AppJson.json.encodeToString(AppData.serializer(), sync.disconnect())
            }
            true
        }

        "apple_connect" -> {
            // The only command allowed to raise the permission dialog: it is an explicit user tap
            // on the card's switch, unlike the launch/5-minute background sync.
            withCalendarPermission(responder, requestPermission = true) {
                AppJson.json.encodeToString(AppData.serializer(), sync.connect())
            }
            true
        }

        "apple_sync" -> {
            if (sync.enabled()) {
                withCalendarPermission(responder, requestPermission = false) {
                    AppJson.json.encodeToString(AppData.serializer(), sync.sync())
                }
            } else {
                responder.error("尚未連結 Apple 日曆")
            }
            true
        }

        "apple_calendars" -> {
            withCalendarPermission(responder, requestPermission = false) {
                AppJson.json.encodeToString(CalendarsResponse.serializer(), sync.calendars())
            }
            true
        }

        "apple_set_calendars" -> {
            val ids = readIds(args)
            if (ids == null) {
                responder.error("缺少 ids 參數")
            } else {
                withCalendarPermission(responder, requestPermission = false) {
                    AppJson.json.encodeToString(AppData.serializer(), sync.setCalendars(ids))
                }
            }
            true
        }

        else -> false
    }

    // ------------------------------------------------------------------ permission plumbing

    /**
     * Runs [action] once the calendar permission is settled.
     *
     * A `notDetermined` state only triggers the runtime dialog when [requestPermission] is true
     * (`apple_connect`); background commands answer with the same guidance error the desktop app
     * shows instead, so a launch/timer sync can never pop a dialog the user did not ask for.
     */
    private fun withCalendarPermission(
        responder: Responder,
        requestPermission: Boolean,
        action: () -> String,
    ) {
        if (!sync.isSupported()) {
            responder.error("這個裝置沒有可用的系統日曆服務。")
            return
        }
        val inFlight = synchronized(permissionLock) {
            if (permissionRequestInFlight && requestPermission) {
                permissionQueue += responder to action
                true
            } else {
                false
            }
        }
        if (inFlight) return
        if (permissionRequestInFlight) {
            responder.error(PERMISSION_HELP)
            return
        }
        when (sync.authorizationStatus()) {
            "fullAccess" -> guarded(responder, action)
            "notDetermined" -> if (requestPermission) {
                requestPermissionThen(responder, action)
            } else {
                responder.error(PERMISSION_HELP)
            }

            else -> responder.error(PERMISSION_HELP)
        }
    }

    private fun requestPermissionThen(responder: Responder, action: () -> String) {
        synchronized(permissionLock) {
            permissionRequestInFlight = true
            permissionQueue += responder to action
        }
        sync.markPermissionRequested()
        host.requestPermissions(CALENDAR_PERMISSIONS) { granted ->
            val queued = synchronized(permissionLock) {
                permissionRequestInFlight = false
                val pending = permissionQueue.toList()
                permissionQueue.clear()
                pending
            }
            if (CALENDAR_PERMISSIONS.all { granted[it] == true }) {
                queued.forEach { (pendingResponder, pendingAction) ->
                    worker.execute { guarded(pendingResponder, pendingAction) }
                }
            } else {
                queued.forEach { (pendingResponder, _) -> pendingResponder.error(PERMISSION_HELP) }
            }
        }
    }

    // ------------------------------------------------------------------ helpers

    private fun guarded(responder: Responder, action: () -> String) {
        try {
            responder.json(action())
        } catch (error: Throwable) {
            Log.w(TAG, "日曆指令失敗", error)
            responder.error(error.message ?: "日曆操作失敗")
        }
    }

    /** `apple_set_calendars{ids}`; null when the argument is missing (an empty list is valid). */
    private fun readIds(args: JSONObject): List<String>? {
        val array = args.optJSONArray("ids") ?: return null
        val ids = mutableListOf<String>()
        for (index in 0 until array.length()) {
            val value = array.optString(index, "")
            if (value.isNotEmpty()) ids += value
        }
        return ids
    }

    private companion object {
        const val TAG = "ReciprocalCalendar"

        val CALENDAR_PERMISSIONS = arrayOf(
            Manifest.permission.READ_CALENDAR,
            Manifest.permission.WRITE_CALENDAR,
        )

        const val PERMISSION_HELP =
            "日曆權限未開啟，請到「設定 → 應用程式 → Reciprocal → 權限 → 日曆」開啟權限。"
    }
}
