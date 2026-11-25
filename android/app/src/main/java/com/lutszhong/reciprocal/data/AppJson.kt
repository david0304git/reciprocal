package com.lutszhong.reciprocal.data

import kotlinx.serialization.json.Json

/** Shared JSON configuration: the wire format is camelCase JSON produced by Tauri's serde layer. */
object AppJson {
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        coerceInputValues = true
        explicitNulls = true
    }
}

// ---------------------------------------------------------------- helpers mirrored from models.rs

fun parseWeekdays(raw: String): List<Int> =
    raw.split(',')
        .mapNotNull { it.trim().toIntOrNull() }
        .filter { it in 1..7 }

fun weekdaysToString(days: List<Int>): String =
    days.filter { it in 1..7 }.distinct().sorted().joinToString(",")

fun parseTags(raw: String): List<String> =
    raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()

fun tagsToString(tags: List<String>): String =
    tags.map { it.trim() }.filter { it.isNotEmpty() }.distinct().joinToString(",")
