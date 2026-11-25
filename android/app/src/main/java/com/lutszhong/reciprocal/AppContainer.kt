package com.lutszhong.reciprocal

import android.content.Context
import com.lutszhong.reciprocal.bridge.ActivityHost
import com.lutszhong.reciprocal.bridge.CommandRouter
import com.lutszhong.reciprocal.calendar.CalendarCommands
import com.lutszhong.reciprocal.calendar.CalendarSync
import com.lutszhong.reciprocal.calendar.SystemCalendar
import com.lutszhong.reciprocal.data.ReciprocalDb
import com.lutszhong.reciprocal.data.Store
import com.lutszhong.reciprocal.data.StoreCommands
import com.lutszhong.reciprocal.platform.FilesGateway
import com.lutszhong.reciprocal.platform.PlatformCommands
import com.lutszhong.reciprocal.platform.Updater

/**
 * Owns the app-wide singletons and wires the command surface together.
 *
 * Created once per Activity; the database handle itself is process-wide (SQLiteOpenHelper caches
 * the connection), so rotation and process restarts keep the same data.
 */
class AppContainer(context: Context, host: ActivityHost) {

    private val appContext: Context = context.applicationContext

    val db: ReciprocalDb = ReciprocalDb(appContext)
    val store: Store = Store(appContext, db)
    val files: FilesGateway = FilesGateway(appContext, host)
    val updater: Updater = Updater(appContext)
    val systemCalendar: SystemCalendar = SystemCalendar(appContext, host)
    val calendarSync: CalendarSync = CalendarSync(db, store, systemCalendar)

    val router: CommandRouter = CommandRouter(
        listOf(
            StoreCommands(store),
            PlatformCommands(appContext, host, files, updater, store),
            CalendarCommands(appContext, host, store, calendarSync),
        ),
    )
}
