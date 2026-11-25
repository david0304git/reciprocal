package com.lutszhong.reciprocal.platform

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.lutszhong.reciprocal.bridge.ActivityHost
import com.lutszhong.reciprocal.bridge.CommandGroup
import com.lutszhong.reciprocal.bridge.PickMode
import com.lutszhong.reciprocal.bridge.Responder
import com.lutszhong.reciprocal.data.AppData
import com.lutszhong.reciprocal.data.AppJson
import com.lutszhong.reciprocal.data.Store
import com.lutszhong.reciprocal.data.UpdateInfo
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Commands that touch the Android platform: file pickers/backups, version, GitHub update check and
 * external links — plus the `plugin:*` commands the bundled Tauri frontend still calls.
 *
 * Command names and argument shapes are exactly the ones `web/src/lib/api.ts` and
 * `@tauri-apps/plugin-dialog` produce. The bridge invokes command groups on its background thread;
 * anything that needs the Activity (file pickers, intents) is posted to the main thread, and the
 * responder is settled from whichever thread finishes last — [Responder] allows a single, late
 * answer.
 */
class PlatformCommands(
    @Suppress("UNUSED_PARAMETER") context: Context,
    private val host: ActivityHost,
    private val files: FilesGateway,
    private val updater: Updater,
    private val store: Store,
) : CommandGroup {

    override fun handle(command: String, args: JSONObject, responder: Responder): Boolean {
        when (command) {
            // The dialog plugin's `getVersion()` resolves to a plain version string.
            "plugin:app|version" -> responder.text(updater.currentVersionName())

            // `plugin:dialog|save({ title, defaultPath, filters })` → path string or null.
            "plugin:dialog|save" -> pickDocument(args, responder, PickMode.CREATE)

            // `plugin:dialog|open({ title, multiple, directory, filters })` → path string or null.
            "plugin:dialog|open" -> pickDocument(args, responder, PickMode.OPEN)

            // `export_backup{path}` → the written target (the frontend only shows its last segment).
            "export_backup" -> {
                val path = args.optString("path")
                submit(IO_EXECUTOR, responder) {
                    responder.text(files.writeText(path, store.backupJson()))
                }
            }

            // `import_backup{path}` → AppData of the restored dataset.
            "import_backup" -> {
                val path = args.optString("path")
                submit(IO_EXECUTOR, responder) {
                    val data = store.restoreFromJson(files.readText(path))
                    responder.json(AppJson.json.encodeToString(AppData.serializer(), data))
                }
            }

            // Blocking HTTP (up to ~24 s of timeouts) would stall every queued bridge command.
            "check_for_updates" -> submit(NETWORK_EXECUTOR, responder) {
                responder.json(AppJson.json.encodeToString(UpdateInfo.serializer(), updater.check()))
            }

            // Same allow-list as `commands.rs::open_external`.
            "open_external" -> {
                val url = args.optString("url")
                if (!url.startsWith(GITHUB_URL_PREFIX)) {
                    responder.error("只允許開啟 GitHub 連結")
                } else {
                    MAIN_HANDLER.post {
                        try {
                            host.openExternal(url)
                        } catch (ignored: Throwable) {
                            // ActivityHost.openExternal cannot report failure (MainActivity toasts
                            // when no browser exists), so the promise resolves either way.
                        }
                    }
                    responder.unit()
                }
            }

            else -> return false
        }
        return true
    }

    // ------------------------------------------------------------------ file pickers

    /**
     * Launches the SAF picker on the main thread. The bridge command returns immediately; the
     * responder is settled by the Activity's result callback with the document URI or `null`.
     */
    private fun pickDocument(args: JSONObject, responder: Responder, mode: PickMode) {
        val options = args.optJSONObject("options") ?: JSONObject()
        val suggestedName = if (mode == PickMode.CREATE) {
            suggestedFileName(options.optString("defaultPath"))
        } else {
            null
        }
        MAIN_HANDLER.post {
            try {
                host.pickDocument(mode, JSON_MIME_TYPE, suggestedName) { uri ->
                    if (uri.isNullOrBlank()) responder.unit() else responder.text(uri)
                }
            } catch (error: Throwable) {
                responder.error("無法開啟檔案選擇器：${error.localizedMessage ?: error.message ?: "未知錯誤"}")
            }
        }
    }

    /** `defaultPath` is a full desktop path; SAF's EXTRA_TITLE only wants the file name. */
    private fun suggestedFileName(defaultPath: String): String? {
        if (defaultPath.isBlank()) return null
        val name = defaultPath.substringAfterLast('/').substringAfterLast('\\')
        return name.takeIf { it.isNotBlank() }
    }

    // ------------------------------------------------------------------ async plumbing

    /**
     * Runs [block] on [executor] and guarantees exactly one response: the block's own success
     * value, or a rejection carrying its (already localized) message.
     */
    private fun submit(executor: ExecutorService, responder: Responder, block: () -> Unit) {
        try {
            executor.execute {
                try {
                    block()
                } catch (error: Throwable) {
                    responder.error(error.message ?: "執行失敗")
                }
            }
        } catch (error: RejectedExecutionException) {
            responder.error("應用程式正在關閉")
        }
    }

    private companion object {
        const val JSON_MIME_TYPE = "application/json"
        const val GITHUB_URL_PREFIX = "https://github.com/"

        /** ActivityResultLauncher / startActivity must run on the main thread. */
        val MAIN_HANDLER = Handler(Looper.getMainLooper())

        /** Backups: serialized so an export cannot interleave with an import. */
        val IO_EXECUTOR: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "reciprocal-platform-io").apply { isDaemon = true }
        }

        /** Update checks: separate from backups so a slow GitHub request never blocks a backup. */
        val NETWORK_EXECUTOR: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "reciprocal-platform-net").apply { isDaemon = true }
        }
    }
}
