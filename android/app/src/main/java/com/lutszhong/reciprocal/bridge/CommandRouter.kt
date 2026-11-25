package com.lutszhong.reciprocal.bridge

import org.json.JSONObject

/**
 * Dispatches a Tauri command name to the first [CommandGroup] that claims it.
 *
 * The command names and argument shapes are exactly those produced by `web/src/lib/api.ts` and the
 * Tauri plugin calls the frontend makes (`plugin:app|version`, `plugin:dialog|save`,
 * `plugin:dialog|open`).
 */
class CommandRouter(private val groups: List<CommandGroup>) {

    fun dispatch(command: String, args: JSONObject, responder: Responder) {
        for (group in groups) {
            if (group.handle(command, args, responder)) return
        }
        responder.error("不支援的指令：$command")
    }
}
