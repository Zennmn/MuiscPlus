package com.muisc.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun AdvancedSection(
    state: SettingsState,
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(tr("categoryCacheConfig", "Cache configuration and storage"), style = MiuixTheme.textStyles.title3)
        Card(modifier = Modifier.fillMaxWidth()) {
            val strategies = listOf("bounded", "none")
            OverlayDropdownPreference(
                items = listOf(tr("optionBounded", "Bounded (100 recent entries)"), tr("optionNone", "None (no caching)")),
                selectedIndex = strategies.indexOf(state.value("cacheStrategy", "bounded")).coerceAtLeast(0),
                title = tr("labelCacheStrategy", "Cache strategy"),
                summary = tr("descCacheStrategy", "Choose whether to keep recently used results."),
                onSelectedIndexChange = { actions.set("cacheStrategy", strategies[it]) },
            )
            CacheRow(tr("labelLyricsCache", "Lyrics cache"), state.cacheStats["lyrics"], tr("buttonClearLyricsCache", "Clear lyrics cache")) {
                actions.call("clearCache", "lyrics")
            }
            CacheRow(tr("labelTranslationCache", "Translation cache"), state.cacheStats["translations"], tr("buttonClearTranslationCache", "Clear translation cache")) {
                actions.call("clearCache", "translations")
            }
            CacheRow(tr("labelRomanizationCache", "Transliteration cache"), state.cacheStats["romanization"], tr("buttonClearRomanizationCache", "Clear transliteration cache")) {
                actions.call("clearCache", "romanization")
            }
            CacheRow(tr("labelTotalCacheUsage", "Total cache usage"), state.cacheStats["all"], tr("buttonClearAllCache", "Clear all cache")) {
                actions.call("clearCache", "all")
            }
        }
        Text(
            tr("cacheScopeExplanation", "Clearing the cache keeps local lyrics, offsets, source preferences, and fonts."),
            style = MiuixTheme.textStyles.footnote1,
        )
        Text(tr("categoryConfigManagement", "Configuration management"), style = MiuixTheme.textStyles.title3)
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(tr("labelBackupRestore", "Backup and restore settings"))
                Text(tr("descConfigManagement", "Export settings to JSON or restore a previous backup."), style = MiuixTheme.textStyles.footnote1)
                TextButton(text = tr("buttonExport", "Export"), onClick = { actions.call("exportSettings", "") })
                TextButton(text = tr("buttonImport", "Import"), onClick = { actions.call("importSettings", "") })
                state.status["config"]?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MiuixTheme.textStyles.footnote1) }
            }
        }
        Text(tr("categoryHelpSources", "Help and source"), style = MiuixTheme.textStyles.title3)
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Muisc+ ${state.value("__version")}".trim())
                Text(tr("aboutAppleDescription", "Apple Music lyrics with the AMLL player and optional translation."), style = MiuixTheme.textStyles.footnote1)
                Text(tr("upstreamAttribution", "Built on AMLL and open-source lyric sources."), style = MiuixTheme.textStyles.footnote1)
                TextButton(text = tr("linkSourceCode", "Source code"), onClick = { actions.call("openExternal", "https://github.com/Zennmn/YouLyPlus") })
                TextButton(text = tr("linkIssues", "Issues & help"), onClick = { actions.call("openExternal", "https://github.com/Zennmn/YouLyPlus/issues") })
            }
        }
        state.status["advanced"]?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MiuixTheme.textStyles.footnote1) }
    }
}

@Composable
private fun CacheRow(title: String, summary: String?, button: String, onClear: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title)
        if (!summary.isNullOrEmpty()) Text(summary, style = MiuixTheme.textStyles.footnote1)
        TextButton(text = button, onClick = onClear)
    }
}
