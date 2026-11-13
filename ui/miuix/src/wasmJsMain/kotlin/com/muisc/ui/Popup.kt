package com.muisc.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.DropdownEntry
import top.yukonga.miuix.kmp.basic.DropdownItem
import top.yukonga.miuix.kmp.basic.Scaffold
import top.yukonga.miuix.kmp.basic.SmallTitle
import top.yukonga.miuix.kmp.basic.TabRow
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.menu.OverlayDropdownMenu
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.darkColorScheme
import top.yukonga.miuix.kmp.theme.lightColorScheme

/** Browser-owned state for the toolbar popup. */
data class PopupState(
    val isEnabled: Boolean = true,
    val appleMusicAMLL: Boolean = true,
    val appleMusicAMLLBackground: Boolean = true,
    val appleMusicDisplayMode: String = "none",
    val appleMusicTitleCorrection: String = "off",
    val largerTextMode: String = "lyrics",
    val wordByWord: Boolean = true,
    val hidePhoneticDup: Boolean = true,
    val lightweight: Boolean = false,
    val cacheSize: String = "0.00 MB",
    val cacheCount: String = "0",
    val status: String = "",
)

private data class DropdownOption(
    val value: String,
    val translationKey: String,
    val fallback: String,
)

private val displayModeOptions = listOf(
    DropdownOption("none", "optionDisplayOriginal", "Original lyrics"),
    DropdownOption("translate", "optionDisplayTranslation", "Translation"),
    DropdownOption("romanize", "optionDisplayTransliteration", "Transliteration"),
    DropdownOption("both", "optionDisplayBoth", "Translation + transliteration"),
)

private val titleCorrectionOptions = listOf(
    DropdownOption("off", "titleCorrectionOff", "Off"),
    DropdownOption("original", "titleCorrectionOriginal", "Use original region"),
    DropdownOption("cn", "titleCorrectionChina", "Use mainland China"),
    DropdownOption("jp", "titleCorrectionJapan", "Use Japan"),
)

private val largerTextOptions = listOf(
    DropdownOption("lyrics", "optionLyrics", "Lyrics"),
    DropdownOption("romanization", "optionPronunciation", "Pronunciation"),
)

/** Lets the host return either an already-localized status or one of the popup message keys. */
private val statusFallbacks = mapOf(
    "msgSettingsSaved" to "Settings saved. Apple Music lyrics will refresh automatically.",
    "msgSettingsSaveFailed" to "Could not save settings. Try again.",
    "msgCacheCleared" to "Cache cleared successfully!",
    "msgCacheClearFailed" to "Failed to clear cache.",
    "msgCacheRefreshed" to "Cache info refreshed.",
    "msgErrorLoadingCache" to "Error loading cache size.",
    "msgCacheUnavailable" to "Cache info unavailable.",
)

@Composable
fun MuiscPopup(
    state: PopupState,
    translate: (String, String) -> String,
    onBooleanChange: (String, Boolean) -> Unit,
    onStringChange: (String, String) -> Unit,
    onCacheRefresh: () -> Unit,
    onCacheClear: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val dark = isSystemInDarkTheme()
    val colors = remember(dark) {
        if (dark) darkColorScheme() else lightColorScheme()
    }

    MiuixTheme(colors = colors) {
        var selectedTab by remember { mutableIntStateOf(0) }
        val tabLabels = listOf(
            tr(translate, "tabPlayback", "Playback"),
            tr(translate, "tabStorage", "Cache & storage"),
        )

        Scaffold(
            modifier = Modifier.fillMaxSize(),
            topBar = {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BrandMark(Modifier.size(40.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                text = tr(translate, "popupTitle", "Muisc+ Settings"),
                                style = MiuixTheme.textStyles.headline1,
                                color = MiuixTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = tr(
                                    translate,
                                    "popupAppleDescription",
                                    "Apple Music lyrics, appearance and cache.",
                                ),
                                style = MiuixTheme.textStyles.body2,
                                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                            )
                        }
                    }
                    TabRow(
                        tabs = tabLabels,
                        selectedTabIndex = selectedTab,
                        onTabSelected = { selectedTab = it },
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                }
            },
            bottomBar = {
                PopupFooter(
                    status = resolveStatus(state.status, translate),
                    onOpenSettings = onOpenSettings,
                    translate = translate,
                )
            },
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            containerColor = MiuixTheme.colorScheme.surface,
        ) { contentPadding ->
            when (selectedTab) {
                0 -> PlaybackTab(
                    state = state,
                    translate = translate,
                    onBooleanChange = onBooleanChange,
                    onStringChange = onStringChange,
                    contentPadding = contentPadding,
                )

                else -> CacheTab(
                    state = state,
                    translate = translate,
                    onCacheRefresh = onCacheRefresh,
                    onCacheClear = onCacheClear,
                    contentPadding = contentPadding,
                )
            }
        }
    }
}

@Composable
private fun PlaybackTab(
    state: PopupState,
    translate: (String, String) -> String,
    onBooleanChange: (String, Boolean) -> Unit,
    onStringChange: (String, String) -> Unit,
    contentPadding: PaddingValues,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            SmallTitle(tr(translate, "categoryApplePlayer", "Apple Music player"))
        }
        item {
            PreferenceCard {
                SwitchPreference(
                    checked = state.isEnabled,
                    onCheckedChange = { onBooleanChange("isEnabled", it) },
                    title = tr(translate, "settingEnableExtension", "Enable Muisc+"),
                )
                GroupDivider()
                SwitchPreference(
                    checked = state.appleMusicAMLL,
                    onCheckedChange = { onBooleanChange("appleMusicAMLL", it) },
                    title = tr(translate, "settingUseAMLLPlayer", "Use AMLL lyrics player"),
                )
                GroupDivider()
                SwitchPreference(
                    checked = state.appleMusicAMLLBackground,
                    onCheckedChange = { onBooleanChange("appleMusicAMLLBackground", it) },
                    title = tr(
                        translate,
                        "settingAnimatedLyricsBackground",
                        "Animated lyrics background",
                    ),
                )
                GroupDivider()
                SettingDropdown(
                    titleKey = "labelLyricsDisplayMode",
                    titleFallback = "Lyrics display mode",
                    selectedValue = state.appleMusicDisplayMode,
                    options = displayModeOptions,
                    translate = translate,
                    onSelected = { onStringChange("appleMusicDisplayMode", it) },
                )
                GroupDivider()
                SettingDropdown(
                    titleKey = "settingTitleCorrection",
                    titleFallback = "Song title correction",
                    selectedValue = state.appleMusicTitleCorrection,
                    options = titleCorrectionOptions,
                    translate = translate,
                    onSelected = { onStringChange("appleMusicTitleCorrection", it) },
                )
            }
        }
        item {
            SmallTitle(tr(translate, "categoryTextDisplay", "Text display"))
        }
        item {
            PreferenceCard {
                SettingDropdown(
                    titleKey = "labelLargerTextModeShort",
                    titleFallback = "Larger text",
                    selectedValue = state.largerTextMode,
                    options = largerTextOptions,
                    translate = translate,
                    onSelected = { onStringChange("largerTextMode", it) },
                )
                GroupDivider()
                SwitchPreference(
                    checked = state.wordByWord,
                    onCheckedChange = { onBooleanChange("wordByWord", it) },
                    title = tr(translate, "settingWordByWord", "Word-by-word highlighting"),
                )
                GroupDivider()
                SwitchPreference(
                    checked = state.hidePhoneticDup,
                    onCheckedChange = { onBooleanChange("hidePhoneticDup", it) },
                    title = tr(
                        translate,
                        "settingHideLatinPronunciation",
                        "Hide Latin pronunciation",
                    ),
                )
                GroupDivider()
                SwitchPreference(
                    checked = state.lightweight,
                    onCheckedChange = { onBooleanChange("lightweight", it) },
                    title = tr(translate, "settingLightweightMode", "Lightweight mode"),
                )
            }
        }
    }
}

@Composable
private fun CacheTab(
    state: PopupState,
    translate: (String, String) -> String,
    onCacheRefresh: () -> Unit,
    onCacheClear: () -> Unit,
    contentPadding: PaddingValues,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            SmallTitle(tr(translate, "sectionDataManagement", "Cache & storage"))
        }
        item {
            PreferenceCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    CacheStat(
                        label = tr(translate, "labelStorageUsed", "Storage used:"),
                        value = state.cacheSize,
                        modifier = Modifier.weight(1f),
                    )
                    CacheStat(
                        label = tr(translate, "labelCachedItems", "Cached items:"),
                        value = state.cacheCount,
                        modifier = Modifier.weight(1f),
                    )
                }
                GroupDivider()
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = onCacheRefresh,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            modifier = Modifier.fillMaxWidth(),
                            text = tr(translate, "buttonRefresh", "Refresh"),
                            style = MiuixTheme.textStyles.button,
                            textAlign = TextAlign.Center,
                        )
                    }
                    Button(
                        onClick = onCacheClear,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            color = MiuixTheme.colorScheme.errorContainer,
                            contentColor = MiuixTheme.colorScheme.onErrorContainer,
                        ),
                    ) {
                        Text(
                            modifier = Modifier.fillMaxWidth(),
                            text = tr(translate, "buttonClearCache", "Clear cache"),
                            style = MiuixTheme.textStyles.button,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
        }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                insideMargin = PaddingValues(14.dp),
            ) {
                Text(
                    text = tr(
                        translate,
                        "popupFullSettingsHint",
                        "Sources, local TTML, translation, fonts and advanced options are in the full settings page.",
                    ),
                    style = MiuixTheme.textStyles.body2,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                )
            }
        }
    }
}

@Composable
private fun PreferenceCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        insideMargin = PaddingValues(0.dp),
        content = content,
    )
}

@Composable
private fun GroupDivider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp)
            .height(1.dp)
            .background(MiuixTheme.colorScheme.dividerLine),
    )
}

@Composable
private fun SettingDropdown(
    titleKey: String,
    titleFallback: String,
    selectedValue: String,
    options: List<DropdownOption>,
    translate: (String, String) -> String,
    onSelected: (String) -> Unit,
) {
    val localizedOptions = options.map { option ->
        option to tr(translate, option.translationKey, option.fallback)
    }
    val selectedLabel = localizedOptions
        .firstOrNull { (option, _) -> option.value == selectedValue }
        ?.second
        ?: selectedValue

    OverlayDropdownMenu(
        entry = DropdownEntry(
            items = localizedOptions.map { (option, label) ->
                DropdownItem(
                    text = label,
                    selected = option.value == selectedValue,
                    onClick = { onSelected(option.value) },
                )
            },
        ),
        title = tr(translate, titleKey, titleFallback),
        summary = selectedLabel,
    )
}

@Composable
private fun CacheStat(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = label,
            style = MiuixTheme.textStyles.body2,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
        )
        Text(
            text = value.ifBlank { "—" },
            style = MiuixTheme.textStyles.headline1,
            color = MiuixTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun PopupFooter(
    status: String,
    onOpenSettings: () -> Unit,
    translate: (String, String) -> String,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MiuixTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (status.isNotBlank()) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                insideMargin = PaddingValues(12.dp),
            ) {
                Text(
                    text = status,
                    style = MiuixTheme.textStyles.body2,
                    color = MiuixTheme.colorScheme.primary,
                )
            }
        }
        Button(
            onClick = onOpenSettings,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColorsPrimary(),
        ) {
            Text(
                modifier = Modifier.fillMaxWidth(),
                text = tr(translate, "buttonMoreSettings", "More settings"),
                style = MiuixTheme.textStyles.button,
                textAlign = TextAlign.Center,
            )
        }
    }
}

private fun tr(
    translate: (String, String) -> String,
    key: String,
    fallback: String,
): String = translate(key, fallback).ifBlank { fallback }

private fun resolveStatus(
    status: String,
    translate: (String, String) -> String,
): String {
    val fallback = statusFallbacks[status] ?: return status
    return tr(translate, status, fallback)
}
