package com.muisc.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.ComposeViewport
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    val popup = hostPage() == "popup"
    val direction = if (hostIsRtl()) LayoutDirection.Rtl else LayoutDirection.Ltr
    ComposeViewport(viewportContainerId = "composeApp") {
        var snapshot by remember { mutableStateOf<String?>(null) }
        val actions = remember { SettingsActions(set = ::hostSet, call = ::hostPerform) }

        LaunchedEffect(Unit) {
            hostSubscribe { snapshot = it }
            if (popup) hostPerform("refreshCache", "")
        }

        CompositionLocalProvider(LocalLayoutDirection provides direction) {
          MuiscFonts {
            LaunchedEffect(Unit) { hostReady() }
            val current = snapshot
            if (current == null) {
                MiuixTheme { Text(hostTranslate("msgLoading", "Loading…")) }
            } else if (popup) {
                val state = remember(current) { parseSettingsState(current) }
                MuiscPopup(
                    state = PopupState(
                        isEnabled = state.enabled("isEnabled", true),
                        appleMusicAMLL = state.enabled("appleMusicAMLL", true),
                        appleMusicAMLLBackground = state.enabled("appleMusicAMLLBackground", true),
                        appleMusicDisplayMode = state.value("appleMusicDisplayMode", "none"),
                        appleMusicTitleCorrection = state.value("appleMusicTitleCorrection", "off"),
                        largerTextMode = state.value("largerTextMode", "lyrics"),
                        wordByWord = state.enabled("wordByWord", true),
                        hidePhoneticDup = state.enabled("hidePhoneticDup", true),
                        lightweight = state.enabled("lightweight"),
                        cacheSize = state.cacheStats["sizeMB"] ?: "0.00 MB",
                        cacheCount = state.cacheStats["cacheCount"] ?: "0",
                        status = state.status["popup"] ?: "",
                    ),
                    translate = ::hostTranslate,
                    onBooleanChange = { key, value -> hostSet(key, value.toString()) },
                    onStringChange = ::hostSet,
                    onCacheRefresh = { hostPerform("refreshCache", "") },
                    onCacheClear = { hostPerform("clearCache", "all") },
                    onOpenSettings = { hostPerform("openSettings", "") },
                )
            } else {
                val state = remember(current) { parseSettingsState(current) }
                MuiscSettings(state = state, tr = ::hostTranslate, actions = actions)
            }
          }
        }
    }
}
