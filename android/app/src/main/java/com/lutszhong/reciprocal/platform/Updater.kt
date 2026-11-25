package com.lutszhong.reciprocal.platform

import android.content.Context
import android.content.pm.PackageManager
import com.lutszhong.reciprocal.data.AppJson
import com.lutszhong.reciprocal.data.UpdateInfo
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Port of `src-tauri/src/update.rs`: compares this build against the public GitHub Releases of
 * `david0304git/reciprocal` (falling back to the newest tag when there is no release).
 *
 * The behaviour, including the Traditional Chinese error messages, mirrors the Rust implementation.
 * `check()` performs blocking network I/O (12 s connect / 12 s read timeout) and must run on a
 * background thread.
 */
class Updater(private val context: Context) {

    /** `versionName` from the package manager, e.g. "0.1.7". */
    @Suppress("DEPRECATION")
    fun currentVersionName(): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0)
            .versionName
            ?.takeIf { it.isNotBlank() }
            ?: FALLBACK_VERSION
    } catch (error: PackageManager.NameNotFoundException) {
        FALLBACK_VERSION
    }

    /**
     * Queries GitHub for the latest release (falling back to `/tags`) and compares it to
     * [currentVersionName].
     *
     * @throws PlatformException with the same Chinese wording as `update::check`'s `Err(String)`.
     */
    fun check(): UpdateInfo {
        val current = currentVersionName()

        val releaseResponse = get(RELEASE_API_URL, current)
        if (releaseResponse.status in 200..299) {
            val release = decodeRelease(releaseResponse.body)
            val latest = normalizeVersion(release.tagName)
            // Rust: release.name.filter(!empty).unwrap_or_else(|| tag_name)
            val name = release.name?.takeIf { it.trim().isNotEmpty() } ?: release.tagName
            return result(
                current = current,
                latest = latest,
                releaseUrl = release.htmlUrl,
                releaseName = name,
                publishedAt = release.publishedAt,
                source = SOURCE_RELEASE,
            )
        }

        if (releaseResponse.status == HttpURLConnection.HTTP_NOT_FOUND) {
            // Older repositories without a published release: fall back to the newest tag.
            val tagsResponse = get(TAGS_API_URL, current)
            if (tagsResponse.status !in 200..299) {
                throw PlatformException("無法讀取 GitHub 版本：${statusLine(tagsResponse)}")
            }
            val tags = decodeTags(tagsResponse.body)
            val tag = tags.firstOrNull()
                ?: return result(current, null, null, null, null, SOURCE_NONE)
            return result(
                current = current,
                latest = normalizeVersion(tag.name),
                releaseUrl = "$GITHUB_WEB_URL/releases/tag/${tag.name}",
                releaseName = tag.name,
                publishedAt = null,
                source = SOURCE_TAG,
            )
        }

        throw PlatformException(
            "GitHub API 回應異常：${statusLine(releaseResponse)}（可能超過未登入查詢次數）",
        )
    }

    // ------------------------------------------------------------------ http

    private data class HttpResponse(val status: Int, val message: String, val body: String)

    private fun get(url: String, version: String): HttpResponse {
        val connection: HttpURLConnection
        try {
            connection = URL(url).openConnection() as HttpURLConnection
        } catch (error: IOException) {
            throw PlatformException("無法連線到 GitHub：${describe(error)}")
        }

        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = true
            connection.useCaches = false
            connection.setRequestProperty("Accept", ACCEPT_HEADER)
            connection.setRequestProperty("User-Agent", "$USER_AGENT_PREFIX$version")

            val status = connection.responseCode
            val stream: InputStream? =
                if (status in 200..299) connection.inputStream else connection.errorStream
            // Always drain (and close) the stream so the connection can be released.
            val body = stream?.use { String(it.readBytes(), Charsets.UTF_8) } ?: ""
            HttpResponse(status, connection.responseMessage.orEmpty(), body)
        } catch (error: IOException) {
            throw PlatformException("無法連線到 GitHub：${describe(error)}")
        } finally {
            connection.disconnect()
        }
    }

    private fun statusLine(response: HttpResponse): String =
        if (response.message.isBlank()) response.status.toString()
        else "${response.status} ${response.message}"

    // ------------------------------------------------------------------ json payloads

    @Serializable
    private data class GitHubRelease(
        @SerialName("tag_name") val tagName: String,
        val name: String? = null,
        @SerialName("html_url") val htmlUrl: String,
        @SerialName("published_at") val publishedAt: String? = null,
    )

    @Serializable
    private data class GitHubTag(val name: String)

    private fun decodeRelease(body: String): GitHubRelease = try {
        AppJson.json.decodeFromString(GitHubRelease.serializer(), body)
    } catch (error: IllegalArgumentException) {
        throw PlatformException("無法解析 GitHub Release：${describe(error)}")
    }

    private fun decodeTags(body: String): List<GitHubTag> = try {
        AppJson.json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(GitHubTag.serializer()), body)
    } catch (error: IllegalArgumentException) {
        throw PlatformException("無法解析 GitHub Tags：${describe(error)}")
    }

    // ------------------------------------------------------------------ version comparison

    private fun normalizeVersion(tag: String): String =
        tag.trim().trimStart('v').trimStart('V').trim()

    private data class SemVer(
        val major: Long,
        val minor: Long,
        val patch: Long,
        val prerelease: List<String>,
    )

    private fun parseSemver(raw: String): SemVer? {
        val match = SEMVER_PATTERN.matchEntire(raw) ?: return null
        val prerelease = match.groupValues[4]
            .takeIf { it.isNotEmpty() }
            ?.split('.')
            ?: emptyList()
        if (prerelease.any { isInvalidPrereleaseIdentifier(it) }) return null
        return SemVer(
            major = match.groupValues[1].toLongOrNull() ?: return null,
            minor = match.groupValues[2].toLongOrNull() ?: return null,
            patch = match.groupValues[3].toLongOrNull() ?: return null,
            prerelease = prerelease,
        )
    }

    /** SemVer forbids leading zeroes on purely numeric pre-release identifiers (e.g. `-01`). */
    private fun isInvalidPrereleaseIdentifier(identifier: String): Boolean =
        identifier.isEmpty() ||
            (identifier.length > 1 && identifier[0] == '0' && identifier.all(Char::isDigit))

    private fun isNewer(latest: String, current: String): Boolean {
        val latestVersion = parseSemver(latest)
        val currentVersion = parseSemver(current)
        // Same fallback as update.rs: unparsable versions compare as plain strings.
        if (latestVersion == null || currentVersion == null) return latest != current
        return compareSemver(latestVersion, currentVersion) > 0
    }

    private fun compareSemver(left: SemVer, right: SemVer): Int {
        if (left.major != right.major) return left.major.compareTo(right.major)
        if (left.minor != right.minor) return left.minor.compareTo(right.minor)
        if (left.patch != right.patch) return left.patch.compareTo(right.patch)
        return comparePrerelease(left.prerelease, right.prerelease)
    }

    private fun comparePrerelease(left: List<String>, right: List<String>): Int {
        // A release (no pre-release) outranks any pre-release of the same version.
        if (left.isEmpty() && right.isEmpty()) return 0
        if (left.isEmpty()) return 1
        if (right.isEmpty()) return -1
        for (index in 0 until minOf(left.size, right.size)) {
            val leftPart = left[index]
            val rightPart = right[index]
            val leftNumber = leftPart.toLongOrNull()
            val rightNumber = rightPart.toLongOrNull()
            val comparison = when {
                leftNumber != null && rightNumber != null -> leftNumber.compareTo(rightNumber)
                leftNumber != null -> -1 // numeric identifiers sort before alphanumeric ones
                rightNumber != null -> 1
                else -> leftPart.compareTo(rightPart) // ASCII lexical order, like semver
            }
            if (comparison != 0) return comparison
        }
        return left.size.compareTo(right.size)
    }

    private fun result(
        current: String,
        latest: String?,
        releaseUrl: String?,
        releaseName: String?,
        publishedAt: String?,
        source: String,
    ): UpdateInfo = UpdateInfo(
        currentVersion = current,
        latestVersion = latest,
        updateAvailable = latest?.let { isNewer(it, current) } ?: false,
        releaseUrl = releaseUrl,
        releaseName = releaseName,
        publishedAt = publishedAt,
        source = source,
    )

    private fun describe(error: Throwable): String =
        error.localizedMessage ?: error.message ?: error.javaClass.simpleName

    private companion object {
        const val GITHUB_OWNER = "david0304git"
        const val GITHUB_REPO = "reciprocal"
        const val GITHUB_WEB_URL = "https://github.com/$GITHUB_OWNER/$GITHUB_REPO"
        const val RELEASE_API_URL = "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/releases/latest"
        const val TAGS_API_URL = "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/tags"
        const val ACCEPT_HEADER = "application/vnd.github+json"
        const val USER_AGENT_PREFIX = "Reciprocal/"
        const val TIMEOUT_MS = 12_000
        const val FALLBACK_VERSION = "0.0.0"
        const val SOURCE_RELEASE = "release"
        const val SOURCE_TAG = "tag"
        const val SOURCE_NONE = "none"

        /** SemVer 2.0.0: MAJOR.MINOR.PATCH[-prerelease][+build], build metadata is ignored. */
        val SEMVER_PATTERN = Regex(
            "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)" +
                "(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?" +
                "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
        )
    }
}
