package com.muisc.ui

/** Browser-owned settings and service state presented by the Compose UI. */
data class SettingsState(
    val values: Map<String, String> = emptyMap(),
    val sourceOrder: List<String> = emptyList(),
    val localLyrics: List<LocalLyric> = emptyList(),
    val dictionaryStatus: Map<String, String> = emptyMap(),
    val fontName: String = "",
    val cacheStats: Map<String, String> = emptyMap(),
    val status: Map<String, String> = emptyMap(),
) {
    fun value(key: String, fallback: String = ""): String = values[key] ?: fallback
    fun enabled(key: String, fallback: Boolean = false): Boolean =
        values[key]?.toBooleanStrictOrNull() ?: fallback
}

data class LocalLyric(
    val songId: String,
    val title: String,
    val artist: String = "",
)

/** Actions are implemented by the extension host; the UI owns no browser storage. */
data class SettingsActions(
    val set: (key: String, value: String) -> Unit,
    val call: (action: String, argument: String) -> Unit,
)
