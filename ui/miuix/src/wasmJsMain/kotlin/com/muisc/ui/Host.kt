package com.muisc.ui

/** All browser APIs and persistence stay in the extension's JavaScript host. */
fun hostSubscribe(callback: (String) -> Unit): Unit =
    js("globalThis.MiuixHost.subscribe(callback)")

fun hostTranslate(key: String, fallback: String): String =
    js("globalThis.MiuixHost.translate(key, fallback)")

fun hostSet(key: String, value: String): Unit =
    js("globalThis.MiuixHost.setRaw(key, value)")

fun hostPerform(action: String, argument: String): Unit =
    js("globalThis.MiuixHost.perform(action, argument)")

fun hostReadFont(id: String, callback: (String, String) -> Unit): Unit =
    js("globalThis.MiuixHost.readFontBase64(id, callback)")

fun hostPage(): String =
    js("document.body.dataset.page || 'settings'")

fun hostIsRtl(): Boolean =
    js("/^(ar|fa|he|ur)(-|$)/i.test(document.documentElement.lang || navigator.language || '')")

fun hostReady(): Unit =
    js("document.getElementById('miuix-loading')?.remove()")

private fun visitEntries(json: String, field: String, callback: (String, String) -> Unit): Unit = js(
    """{
        const entries = JSON.parse(json)[field] || {};
        for (const [key, value] of Object.entries(entries)) callback(key, String(value ?? ''));
    }""",
)

private fun visitSources(json: String, callback: (String) -> Unit): Unit = js(
    """{ for (const source of JSON.parse(json).sourceOrder || []) callback(String(source)); }""",
)

private fun visitLyrics(json: String, callback: (String, String, String) -> Unit): Unit = js(
    """{
        for (const item of JSON.parse(json).localLyrics || []) {
            callback(String(item.songId || ''), String(item.title || ''), String(item.artist || ''));
        }
    }""",
)

private fun scalar(json: String, field: String): String =
    js("String(JSON.parse(json)[field] || '')")

fun parseSettingsState(json: String): SettingsState {
    fun entries(field: String): Map<String, String> = buildMap {
        visitEntries(json, field) { key, value -> put(key, value) }
    }
    val sources = buildList { visitSources(json) { add(it) } }
    val lyrics = buildList {
        visitLyrics(json) { id, title, artist -> add(LocalLyric(id, title, artist)) }
    }
    return SettingsState(
        values = entries("values"),
        sourceOrder = sources,
        localLyrics = lyrics,
        dictionaryStatus = entries("dictionaryStatus"),
        fontName = scalar(json, "fontName"),
        cacheStats = entries("cacheStats"),
        status = entries("status"),
    )
}
