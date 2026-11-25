package com.lutszhong.reciprocal.data

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Matches SQLite's `strftime('%Y-%m-%dT%H:%M:%fZ','now')` exactly, so timestamps sort together. */
private val ISO_MILLIS: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

fun nowIso(): String = ISO_MILLIS.format(Instant.now())
