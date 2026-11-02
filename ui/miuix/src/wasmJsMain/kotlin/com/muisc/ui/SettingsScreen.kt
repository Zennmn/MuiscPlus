package com.muisc.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.NavigationRail
import top.yukonga.miuix.kmp.basic.NavigationRailItem
import top.yukonga.miuix.kmp.basic.NavigationRailValue
import top.yukonga.miuix.kmp.basic.Scaffold
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.rememberNavigationRailState
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Folder
import top.yukonga.miuix.kmp.icon.extended.Music
import top.yukonga.miuix.kmp.icon.extended.Playlist
import top.yukonga.miuix.kmp.icon.extended.Settings
import top.yukonga.miuix.kmp.icon.extended.Translate
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.ThemeController

@Composable
fun MuiscSettings(state: SettingsState, tr: (String, String) -> String, actions: SettingsActions) {
    var section by remember { mutableIntStateOf(0) }
    val theme = remember { ThemeController() }
    val titles = listOf(
        tr("navPlaybackAppearance", "Playback & appearance"),
        tr("navLyricsSourcesApple", "Lyrics sources"),
        tr("navLocalLyrics", "Local lyrics"),
        tr("navTranslationTransliteration", "Translation & transliteration"),
        tr("navStorageAdvanced", "Storage & advanced"),
    )
    val compactTitles = listOf(
        tr("tabPlayback", "Playback"),
        tr("playerLyricsSource", "Lyrics source"),
        tr("navLocalLyrics", "Local lyrics"),
        tr("optionDisplayTranslation", "Translation"),
        tr("tabStorage", "Storage"),
    )
    val icons = listOf(
        MiuixIcons.Music,
        MiuixIcons.Playlist,
        MiuixIcons.Folder,
        MiuixIcons.Translate,
        MiuixIcons.Settings,
    )

    val scroll = rememberScrollState()

    LaunchedEffect(section) {
        scroll.scrollTo(0)
        when (section) {
            2 -> actions.call("loadLocalLyrics", "")
            3 -> actions.call("refreshDictionaries", "")
            4 -> actions.call("refreshCache", "")
        }
    }

    MiuixTheme(controller = theme) {
        Scaffold(modifier = Modifier.fillMaxSize()) { padding ->
            BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
                val compactWindow = maxWidth < 720.dp
                val navigation = rememberNavigationRailState(
                    if (compactWindow) NavigationRailValue.Collapsed else NavigationRailValue.Expanded,
                )
                LaunchedEffect(compactWindow) {
                    if (compactWindow) navigation.collapse()
                }

                Row(Modifier.fillMaxSize()) {
                    NavigationRail(
                        state = navigation,
                        modifier = Modifier.fillMaxHeight(),
                        defaultWindowInsetsPadding = false,
                        expandContentDescription = tr("navExpandSidebar", "Expand navigation"),
                        collapseContentDescription = tr("navCollapseSidebar", "Collapse navigation"),
                    ) {
                        titles.forEachIndexed { index, title ->
                            NavigationRailItem(
                                selected = section == index,
                                onClick = { section = index },
                                icon = icons[index],
                                label = if (navigation.isExpanded) title else compactTitles[index],
                            )
                        }
                    }
                    Column(Modifier.weight(1f).fillMaxHeight()) {
                        Box(
                            modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(titles[section], style = MiuixTheme.textStyles.headline1)
                        }
                        Column(
                            modifier = Modifier.weight(1f).fillMaxWidth()
                                .verticalScroll(scroll).padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(18.dp),
                        ) {
                            state.status["reload"]?.takeIf { it.isNotEmpty() }?.let { message ->
                                Card(modifier = Modifier.fillMaxWidth()) {
                                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(message)
                                        TextButton(tr("buttonReloadAppleMusic", "Reload Apple Music"), onClick = { actions.call("reloadAppleMusic", "") })
                                    }
                                }
                            }
                            when (section) {
                                0 -> PlaybackSection(state, tr, actions)
                                1 -> SourcesSection(state, tr, actions)
                                2 -> LocalLyricsSection(state, tr, actions)
                                3 -> TranslationSection(state, tr, actions)
                                4 -> AdvancedSection(state, tr, actions)
                            }
                            Text(tr("footerAppleOnly", "Muisc+ · Apple Music lyrics"), style = MiuixTheme.textStyles.footnote1)
                        }
                    }
                }
            }
        }
    }
}
