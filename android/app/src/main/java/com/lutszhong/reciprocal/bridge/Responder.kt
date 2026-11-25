package com.lutszhong.reciprocal.bridge

import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Handles exactly one response for a bridge request.
 *
 * Tauri resolves an `invoke()` promise with the command's return value and rejects it with the
 * command's `Err(String)`. The web shim mirrors that: `json()`/`text()`/`unit()` resolve,
 * `error()` rejects.
 */
class Responder(private val emit: (ok: Boolean, payloadJson: String) -> Unit) {
    private val settled = AtomicBoolean(false)

    /** Resolve with a raw JSON payload (already serialized). */
    fun json(payloadJson: String) {
        if (settled.compareAndSet(false, true)) emit(true, payloadJson)
    }

    /** Resolve with a JSON string value. */
    fun text(value: String) = json(JSONObject.quote(value))

    /** Resolve with `null` (a Rust command returning `()`). */
    fun unit() = json("null")

    /** Reject the promise with a message, exactly like a Tauri `Err(String)`. */
    fun error(message: String) {
        if (settled.compareAndSet(false, true)) emit(false, JSONObject.quote(message))
    }

    fun isSettled(): Boolean = settled.get()
}

/**
 * A slice of the command surface. The router asks each group in order; the first one that claims a
 * command must call the responder exactly once — possibly later, from another thread
 * (file pickers, permission dialogs, network calls).
 */
interface CommandGroup {
    fun handle(command: String, args: JSONObject, responder: Responder): Boolean
}
