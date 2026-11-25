package com.lutszhong.reciprocal.bridge

/**
 * The Android capabilities that command groups need from the hosting Activity.
 *
 * Keeping this small interface between the data/calendar layers and the Activity means the command
 * implementations stay testable and `MainActivity` stays the only place that knows about
 * `registerForActivityResult`.
 */
interface ActivityHost {

    /** Opens an https link in the system browser. Only GitHub URLs are allowed, like the desktop app. */
    fun openExternal(url: String)

    /** Reads the current grant state without prompting. */
    fun hasPermission(permission: String): Boolean

    /** True when the user checked "don't ask again" (or policy blocked the permission). */
    fun isPermissionPermanentlyDenied(permission: String): Boolean

    /**
     * Requests runtime permissions and reports the outcome once every permission settled.
     *
     * @param onResult granted map keyed by permission name.
     */
    fun requestPermissions(permissions: Array<String>, onResult: (granted: Map<String, Boolean>) -> Unit)

    /**
     * Launches the Storage Access Framework picker.
     *
     * @param mode [PickMode.OPEN] → ACTION_OPEN_DOCUMENT, [PickMode.CREATE] → ACTION_CREATE_DOCUMENT.
     * @param onResult the picked document URI as a string, or null when the user cancels.
     */
    fun pickDocument(
        mode: PickMode,
        mimeType: String,
        suggestedName: String?,
        onResult: (uri: String?) -> Unit,
    )

    /** Deep-links to this app's system settings page (used after a permanent permission denial). */
    fun openAppSettings()
}

enum class PickMode { OPEN, CREATE }
