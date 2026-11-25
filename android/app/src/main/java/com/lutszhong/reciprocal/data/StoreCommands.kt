package com.lutszhong.reciprocal.data

import com.lutszhong.reciprocal.bridge.CommandGroup
import com.lutszhong.reciprocal.bridge.Responder
import kotlinx.serialization.KSerializer
import org.json.JSONObject

/**
 * Core CRUD commands — the Android counterpart of `src-tauri/src/commands.rs`.
 *
 * Argument names/JSON shapes must match `web/src/lib/api.ts` exactly:
 *
 * | command | args | resolves |
 * | --- | --- | --- |
 * | `load_app` | — | `AppData` |
 * | `save_habit` | `habit` | `Habit` |
 * | `delete_habit` | `id` | `null` |
 * | `set_habit_archived` | `id`, `archived` | `Habit` |
 * | `set_habit_log` | `habitId`, `date`, `present`, `note?` | `HabitLog \| null` |
 * | `save_event` | `event` | `EventItem` |
 * | `delete_event` | `id` | `null` |
 * | `save_task` | `task` | `Task` |
 * | `set_task_status` | `id`, `status` | `Task` |
 * | `delete_task` | `id` | `null` |
 * | `save_timetable` | `block` | `TimetableBlock` |
 * | `delete_timetable` | `id` | `null` |
 * | `set_setting` | `key`, `value` | `null` |
 * | `clear_all_data` | — | `AppData` |
 * | `storage_info` | — | `StorageInfo` |
 *
 * Every claimed command answers exactly once: either the serialized row or the store's
 * Traditional-Chinese error message (the same text the Rust command rejected with).
 *
 * NOTE (ownership): implemented by the data-layer task.
 */
class StoreCommands(private val store: Store) : CommandGroup {

    override fun handle(command: String, args: JSONObject, responder: Responder): Boolean =
        try {
            dispatch(command, args, responder)
        } catch (error: Exception) {
            responder.error(error.message?.takeIf { it.isNotBlank() } ?: "執行失敗")
            true
        }

    private fun dispatch(command: String, args: JSONObject, responder: Responder): Boolean {
        when (command) {
            "load_app" ->
                responder.json(encode(AppData.serializer(), store.loadApp()))

            "save_habit" -> {
                val input = AppJson.json.decodeFromString(
                    HabitInput.serializer(),
                    args.getJSONObject("habit").toString(),
                )
                responder.json(encode(Habit.serializer(), store.saveHabit(input)))
            }

            "delete_habit" -> {
                store.deleteHabit(args.getLong("id"))
                responder.unit()
            }

            "set_habit_archived" -> {
                val habit = store.setHabitArchived(args.getLong("id"), args.getBoolean("archived"))
                responder.json(encode(Habit.serializer(), habit))
            }

            "set_habit_log" -> {
                val note = if (args.has("note") && !args.isNull("note")) args.getString("note") else null
                val log = store.setHabitLog(
                    args.getLong("habitId"),
                    args.getString("date"),
                    args.getBoolean("present"),
                    note,
                )
                responder.json(log?.let { encode(HabitLog.serializer(), it) } ?: "null")
            }

            "save_event" -> {
                val input = AppJson.json.decodeFromString(
                    EventInput.serializer(),
                    args.getJSONObject("event").toString(),
                )
                responder.json(encode(EventItem.serializer(), store.saveEvent(input)))
            }

            "delete_event" -> {
                store.deleteEvent(args.getLong("id"))
                responder.unit()
            }

            "save_task" -> {
                val input = AppJson.json.decodeFromString(
                    TaskInput.serializer(),
                    args.getJSONObject("task").toString(),
                )
                responder.json(encode(Task.serializer(), store.saveTask(input)))
            }

            "set_task_status" -> {
                val task = store.setTaskStatus(args.getLong("id"), args.getString("status"))
                responder.json(encode(Task.serializer(), task))
            }

            "delete_task" -> {
                store.deleteTask(args.getLong("id"))
                responder.unit()
            }

            "save_timetable" -> {
                val input = AppJson.json.decodeFromString(
                    TimetableInput.serializer(),
                    args.getJSONObject("block").toString(),
                )
                responder.json(encode(TimetableBlock.serializer(), store.saveTimetable(input)))
            }

            "delete_timetable" -> {
                store.deleteTimetable(args.getLong("id"))
                responder.unit()
            }

            "set_setting" -> {
                store.setSetting(args.getString("key"), args.getString("value"))
                responder.unit()
            }

            "clear_all_data" ->
                responder.json(encode(AppData.serializer(), store.clearAll()))

            "storage_info" ->
                responder.json(encode(StorageInfo.serializer(), store.storageInfo()))

            else -> return false
        }
        return true
    }

    private fun <T> encode(serializer: KSerializer<T>, value: T): String =
        AppJson.json.encodeToString(serializer, value)
}
