package com.lutszhong.reciprocal.platform

import android.content.Context
import android.net.Uri
import com.lutszhong.reciprocal.bridge.ActivityHost
import java.io.File
import java.io.FileNotFoundException
import java.io.OutputStream

/**
 * Reads and writes the files the user picked through the Storage Access Framework.
 *
 * On desktop the Tauri dialog plugin handed the Rust side a real filesystem path; on Android the
 * picker returns a `content://` URI, so the backup commands treat the "path" argument as an opaque
 * document URI. `file://` URIs and bare filesystem paths are accepted too: the end-to-end test
 * harness calls `export_backup` / `import_backup` straight at the app's private directory so it can
 * read the written JSON back with `adb` without driving the system picker.
 *
 * The web layer appends `.json` when the picked path does not already end with it
 * (`web/src/lib/files.ts`), and a `content://` document URI never does. Every lookup therefore
 * tries the string it was given first and then the same string with one trailing `.json` removed.
 *
 * Everything here is blocking I/O on the caller's thread; the commands run it on a background
 * executor, never on the UI thread.
 */
class FilesGateway(context: Context, @Suppress("UNUSED_PARAMETER") host: ActivityHost) {

    private val appContext: Context = context.applicationContext

    /**
     * Writes [text] as UTF-8 to the document behind [path].
     *
     * @return the candidate string that actually resolved (the caller passes it back to the web
     *   layer, mirroring how `export_backup` returns the desktop path it wrote).
     * @throws PlatformException with the same Traditional Chinese wording as `store.rs`.
     */
    fun writeText(path: String, text: String): String {
        var failure: Exception? = null
        for (candidate in candidates(path)) {
            try {
                writeCandidate(candidate, text)
                return candidate
            } catch (error: Exception) {
                failure = error
            }
        }
        throw PlatformException("寫入備份檔失敗：${describe(failure)}")
    }

    /**
     * Reads the document behind [path] as UTF-8.
     *
     * @throws PlatformException with the same Traditional Chinese wording as `store.rs`.
     */
    fun readText(path: String): String {
        var failure: Exception? = null
        for (candidate in candidates(path)) {
            try {
                return readCandidate(candidate)
            } catch (error: Exception) {
                failure = error
            }
        }
        throw PlatformException("讀取備份檔失敗：${describe(failure)}")
    }

    // ------------------------------------------------------------------ candidates

    /** The path as given, then the same path with one trailing `.json` removed (if any). */
    private fun candidates(path: String): List<String> {
        if (!path.endsWith(".json", ignoreCase = true)) return listOf(path)
        val withoutSuffix = path.dropLast(".json".length)
        if (withoutSuffix.isEmpty()) return listOf(path)
        return listOf(path, withoutSuffix)
    }

    // ------------------------------------------------------------------ read / write

    private fun writeCandidate(candidate: String, text: String) {
        when (val target = resolve(candidate)) {
            is Target.Document -> {
                val stream: OutputStream = openOutputStream(target.uri)
                stream.use {
                    it.write(text.toByteArray(Charsets.UTF_8))
                    it.flush()
                }
            }

            is Target.LocalFile -> {
                target.file.absoluteFile.parentFile?.mkdirs()
                target.file.writeText(text, Charsets.UTF_8)
            }
        }
    }

    private fun readCandidate(candidate: String): String = when (val target = resolve(candidate)) {
        is Target.Document -> {
            val stream = appContext.contentResolver.openInputStream(target.uri)
                ?: throw FileNotFoundException("無法開啟檔案：${target.uri}")
            stream.use { String(it.readBytes(), Charsets.UTF_8) }
        }

        is Target.LocalFile -> target.file.readText(Charsets.UTF_8)
    }

    private fun openOutputStream(uri: Uri): OutputStream {
        val resolver = appContext.contentResolver
        // "wt" truncates an existing document; a few older providers only understand "w".
        val stream = try {
            resolver.openOutputStream(uri, "wt")
        } catch (error: IllegalArgumentException) {
            resolver.openOutputStream(uri, "w")
        }
        return stream ?: throw FileNotFoundException("無法開啟檔案：$uri")
    }

    // ------------------------------------------------------------------ uri / path parsing

    private sealed interface Target {
        /** A Storage Access Framework document (`content://…`). */
        data class Document(val uri: Uri) : Target

        /** A real file (`file://…` or a bare filesystem path, used by the E2E harness). */
        data class LocalFile(val file: File) : Target
    }

    private fun resolve(path: String): Target {
        val uri = try {
            Uri.parse(path)
        } catch (error: Exception) {
            throw PlatformException("無法開啟檔案：${error.localizedMessage ?: path}")
        }
        return when (uri.scheme?.lowercase()) {
            "content" -> Target.Document(uri)
            "file" -> {
                val filePath = uri.path
                if (filePath.isNullOrEmpty()) throw PlatformException("無法開啟檔案：$path")
                Target.LocalFile(File(filePath))
            }

            null -> {
                if (path.isEmpty()) throw PlatformException("無法開啟檔案：路徑為空")
                Target.LocalFile(File(path))
            }

            else -> throw PlatformException("無法開啟檔案：不支援的 URI 配置（${uri.scheme}）")
        }
    }

    // ------------------------------------------------------------------ errors

    private fun describe(failure: Exception?): String {
        if (failure == null) return "無法開啟檔案"
        val message = failure.message
        if (!message.isNullOrBlank()) return message
        return when (failure) {
            is FileNotFoundException -> "找不到檔案"
            else -> failure.javaClass.simpleName
        }
    }
}

/**
 * A command failure whose message is already a user-facing (Traditional Chinese) error, mirroring
 * the `Err(String)` values the Tauri commands returned.
 */
class PlatformException(message: String) : Exception(message)
