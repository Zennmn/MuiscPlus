package com.muisc.ui

import androidx.compose.animation.animateBounds
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitLongPressOrCancellation
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.LookaheadScope
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.CollectionItemInfo
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.collectionItemInfo
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlin.math.abs
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.CardDefaults
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Surface
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.icon.MiuixIcons
import top.yukonga.miuix.kmp.icon.extended.Add
import top.yukonga.miuix.kmp.icon.extended.ChevronForward
import top.yukonga.miuix.kmp.icon.extended.Close
import top.yukonga.miuix.kmp.icon.extended.Delete
import top.yukonga.miuix.kmp.overlay.OverlayDialog
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.squircle.squircleBorder
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** Browser operations required by the playback, source, and local lyric pages. */
object SettingsPlaybackActions {
    const val IMPORT_PLAYER_FONT = "playerFont.import"
    const val RESET_PLAYER_FONT = "playerFont.reset"
    const val REFRESH_LOCAL_LYRICS = "loadLocalLyrics"
    const val DELETE_LOCAL_LYRICS = "deleteLocalLyrics"
    const val OPEN_EXTERNAL = "openExternal"
}

private const val NATIVE_LYRICS_SOURCE = "applemusic"
private const val TTML_TRANSLATION_GUIDE =
    "https://github.com/Zennmn/MuiscPlus/blob/main/docs/ttml-translation.md"

private val allLyricsSources = listOf("amll", "lunabeat", "amlyrics", NATIVE_LYRICS_SOURCE)
private val defaultLyricsSources = allLyricsSources
private val fallbackLyricsSources = listOf("netease", "kugou", "soda")

private data class Choice(val value: String, val label: String)

/** Playback and appearance settings backed entirely by [SettingsState] and [SettingsActions]. */
@Composable
fun PlaybackSection(
    state: SettingsState,
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    SettingsPage {
        SettingsCategory(title = tr("categoryApplePlayer", "Apple Music player"), insideMargin = PaddingValues(0.dp)) {
            ToggleSetting(
                title = tr("settingEnableExtension", "Enable Muisc+"),
                description = tr("descEnableExtension", "Globally enable or disable the extension."),
                checked = state.enabled("isEnabled", true),
                onCheckedChange = { actions.set("isEnabled", it.toString()) },
            )
            ToggleSetting(
                title = tr("settingUseAMLLPlayer", "Use AMLL lyrics player"),
                description = tr(
                    "descUseAMLLPlayer",
                    "Show Apple Music lyrics in the original AMLL player. Turn this off to use Apple's native lyrics view.",
                ),
                checked = state.enabled("appleMusicAMLL", true),
                onCheckedChange = { actions.set("appleMusicAMLL", it.toString()) },
            )
            ToggleSetting(
                title = tr("settingAnimatedLyricsBackground", "Animated lyrics background"),
                description = tr(
                    "descAnimatedLyricsBackground",
                    "Keep the AMLL album background and its original animation.",
                ),
                checked = state.enabled("appleMusicAMLLBackground", true),
                onCheckedChange = { actions.set("appleMusicAMLLBackground", it.toString()) },
            )
            ChoiceSetting(
                title = tr("labelLyricsDisplayMode", "Lyrics display mode"),
                description = tr(
                    "descLyricsDisplayMode",
                    "Default for translation and transliteration. The player menu offers the same choice.",
                ),
                value = allowedValue(
                    state.value("appleMusicDisplayMode"),
                    listOf("none", "translate", "romanize", "both"),
                    "none",
                ),
                choices = listOf(
                    Choice("none", tr("optionDisplayOriginal", "Original lyrics")),
                    Choice("translate", tr("optionDisplayTranslation", "Translation")),
                    Choice("romanize", tr("optionDisplayTransliteration", "Transliteration")),
                    Choice("both", tr("optionDisplayBoth", "Translation + transliteration")),
                ),
                onSelected = { actions.set("appleMusicDisplayMode", it) },
            )
            ChoiceSetting(
                title = tr("settingTitleCorrection", "Song title correction"),
                description = tr(
                    "descTitleCorrection",
                    "Show the title, artist, and album in the selected Apple Music region.",
                ),
                value = allowedValue(
                    state.value("appleMusicTitleCorrection"),
                    listOf("off", "original", "cn", "jp"),
                    "off",
                ),
                choices = listOf(
                    Choice("off", tr("titleCorrectionOff", "Off")),
                    Choice("original", tr("titleCorrectionOriginal", "Use the song's original region")),
                    Choice("cn", tr("titleCorrectionChina", "Use mainland China")),
                    Choice("jp", tr("titleCorrectionJapan", "Use Japan")),
                ),
                onSelected = { actions.set("appleMusicTitleCorrection", it) },
            )
        }

        SettingsCategory(title = tr("categoryTextDisplay", "Text display"), insideMargin = PaddingValues(0.dp)) {
            ToggleSetting(
                title = tr("settingWordByWord", "Word-by-word highlighting"),
                description = tr(
                    "descWordByWord",
                    "Use karaoke-style word highlighting when the lyrics include word timing.",
                ),
                checked = state.enabled("wordByWord", true),
                onCheckedChange = { actions.set("wordByWord", it.toString()) },
            )
            ChoiceSetting(
                title = tr("labelLargerTextMode", "Larger text: pronunciation or lyrics"),
                description = tr(
                    "descLargerTextMode",
                    "Choose which line becomes visually larger when lyrics and pronunciation are both shown.",
                ),
                value = allowedValue(
                    state.value("largerTextMode"),
                    listOf("lyrics", "romanization"),
                    "lyrics",
                ),
                choices = listOf(
                    Choice("lyrics", tr("optionLyrics", "Lyrics")),
                    Choice("romanization", tr("optionPronunciation", "Pronunciation")),
                ),
                onSelected = { actions.set("largerTextMode", it) },
            )
            ToggleSetting(
                title = tr("settingHideLatinPronunciation", "Hide Latin pronunciation"),
                description = tr(
                    "descHideLatinPronunciation",
                    "Hide phonetic guides when the lyrics already use the Latin alphabet.",
                ),
                checked = state.enabled("hidePhoneticDup", true),
                onCheckedChange = { actions.set("hidePhoneticDup", it.toString()) },
            )
            ToggleSetting(
                title = tr("settingLightweightMode", "Lightweight mode"),
                description = tr(
                    "descLightweightMode",
                    "Reduce background animation and visual effects on slower devices.",
                ),
                checked = state.enabled("lightweight", false),
                onCheckedChange = { actions.set("lightweight", it.toString()) },
            )
        }

        SettingsCategory(title = tr("categoryPlayerFont", "Player font")) {
            PlayerFontSetting(state, tr, actions)
        }

        StatusMessage(statusValue(state, "playback-save-status", "playback"))
    }
}

/** Independent source groups; only the main group pins Apple Music. */
@Composable
fun SourcesSection(
    state: SettingsState,
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    SettingsPage(
        introduction = tr(
            "sourcesAppleOnlyNote",
            "Muisc+ works with Apple Music only. Local TTML and a source chosen in the player can override the automatic order for the current song.",
        ),
    ) {
        LyricsSourceGroup(
            incoming = lyricsSourceOrder(state),
            allSources = allLyricsSources,
            pinNative = true,
            actionPrefix = "lyricsSources",
            title = tr("categoryAppleSourceOrder", "Apple Music lyrics source order"),
            label = tr("labelProviderOrder", "Lyrics source priority"),
            description = tr(
                "descAppleMainSourceOrder",
                "Press and hold to reorder. AMLL, LunaBeat and AmLyrics are tried first by default; Apple Music's native lyrics stay last in this group.",
            ),
            tr = tr,
            actions = actions,
        )
        StatusMessage(statusValue(state, "source-order-status", "add-provider-status", "sources", "sourceOrder"))
        LyricsSourceGroup(
            incoming = normalizeLyricsSources(
                state.value("appleMusicLyricsFallbackOrder", "netease,kugou,soda").split(',').map(String::trim),
                fallbackLyricsSources,
                pinNative = false,
            ),
            allSources = fallbackLyricsSources,
            pinNative = false,
            actionPrefix = "fallbackLyricsSources",
            title = tr("categoryFallbackSourceOrder", "Fallback lyrics sources"),
            label = tr("labelFallbackProviderOrder", "Fallback source priority"),
            description = tr(
                "descFallbackSourceOrder",
                "Only when the main group reaches Apple Music and native lyrics are plain text or unavailable, try this group in order for word timing. Native line or word timing is used directly without fallback. Show plain text first and replace it when a more precise match arrives in the background. Keep searching after line-timed or plain-text fallback results. Prefer word timing, then line timing, then plain text; native lyrics win at equal precision, otherwise this order breaks ties. Press and hold to reorder, or add/remove sources. Removing all sources disables this group; the default enables all three.",
            ),
            tr = tr,
            actions = actions,
        )
        StatusMessage(statusValue(state, "fallbackSources"))
    }
}

/** Shared ordering, long-press gesture, keyboard controls and add/remove UI. */
@Composable
private fun LyricsSourceGroup(
    incoming: List<String>,
    allSources: List<String>,
    pinNative: Boolean,
    actionPrefix: String,
    title: String,
    label: String,
    description: String,
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    val draftOrder = remember { mutableStateOf(incoming) }
    val lastAcceptedHostOrder = remember { mutableStateOf(incoming) }
    val pendingExternalOrder = remember { mutableStateOf<List<String>?>(null) }
    val submittedOrders = remember { mutableStateOf<List<List<String>>>(emptyList()) }
    val awaitingOrder = remember { mutableStateOf<List<String>?>(null) }
    val draggingProvider = remember { mutableStateOf<String?>(null) }
    val draggedCenterY = remember { mutableStateOf(0f) }
    val dragSlotCenters = remember { mutableStateOf<List<Float>>(emptyList()) }
    val dragSnapshot = remember { mutableStateOf(incoming) }
    val currentActions = rememberUpdatedState(actions)
    val currentIncoming = rememberUpdatedState(incoming)

    // These bounds are kept in root coordinates. The gesture itself stays on the
    // stable list container, so moving a row cannot change the pointer coordinate.
    val rowBounds = remember { mutableMapOf<String, Rect>() }
    val listCoordinates = remember { arrayOfNulls<LayoutCoordinates>(1) }

    fun acceptHostOrder(order: List<String>) {
        lastAcceptedHostOrder.value = order
        draftOrder.value = order
        pendingExternalOrder.value = null
        submittedOrders.value = emptyList()
        awaitingOrder.value = null
    }

    fun submitOrder(order: List<String>) {
        val normalized = normalizeLyricsSources(order, allSources, pinNative)
        draftOrder.value = normalized
        submittedOrders.value = (submittedOrders.value.filter { it != normalized } + listOf(normalized)).takeLast(8)
        awaitingOrder.value = normalized
        currentActions.value.call("$actionPrefix.reorder", normalized.joinToString(","))
    }

    fun completeDrag(save: Boolean) {
        if (draggingProvider.value == null) return
        val external = pendingExternalOrder.value ?: currentIncoming.value.takeIf { candidate ->
            candidate != lastAcceptedHostOrder.value &&
                candidate !in submittedOrders.value &&
                candidate != awaitingOrder.value
        }
        draggingProvider.value = null
        pendingExternalOrder.value = null

        if (!save) {
            if (external != null) acceptHostOrder(external) else draftOrder.value = dragSnapshot.value
            return
        }
        if (external != null) {
            acceptHostOrder(external)
            return
        }

        val next = normalizeLyricsSources(draftOrder.value, allSources, pinNative)
        draftOrder.value = next
        if (next != dragSnapshot.value) submitOrder(next)
    }

    fun moveSourceWithKeyboard(provider: String, offset: Int) {
        val next = moveLyricsSource(draftOrder.value, provider, offset, allSources, pinNative) ?: return
        submitOrder(next)
    }

    val latestCompleteDrag = rememberUpdatedState<(Boolean) -> Unit> { save ->
        completeDrag(save)
    }

    LaunchedEffect(incoming) {
        if (incoming == lastAcceptedHostOrder.value) return@LaunchedEffect
        val submitted = submittedOrders.value

        if (draggingProvider.value != null) {
            // Own pending saves are not external edits. Anything else must win
            // over the local preview and must never be replaced by an old drag.
            if (incoming !in submitted) pendingExternalOrder.value = incoming
            return@LaunchedEffect
        }

        when {
            incoming == awaitingOrder.value -> acceptHostOrder(incoming)
            incoming in submitted -> Unit
            else -> acceptHostOrder(incoming)
        }
    }

    val availableSources = allSources.filter {
        (!pinNative || it != NATIVE_LYRICS_SOURCE) && it !in draftOrder.value
    }
    var selectedProvider by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(availableSources) {
        if (selectedProvider != null && availableSources.none { it == selectedProvider }) {
            selectedProvider = null
        }
    }

    SettingsCategory(title = title) {
        Text(
            text = label,
            style = MiuixTheme.textStyles.title3,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = description,
            style = MiuixTheme.textStyles.footnote1,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            modifier = Modifier.padding(top = 4.dp),
        )
        Spacer(Modifier.size(12.dp))

        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val compactControls = maxWidth < 520.dp

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 2.dp, vertical = 4.dp)
                        .onGloballyPositioned { listCoordinates[0] = it }
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                val down = awaitFirstDown(
                                    requireUnconsumed = false,
                                    pass = PointerEventPass.Initial,
                                )
                                val coordinates = listCoordinates[0] ?: return@awaitEachGesture
                                val downRoot = coordinates.localToRoot(down.position)
                                val initialOrder = draftOrder.value
                                val provider = initialOrder.firstOrNull { candidate ->
                                    (!pinNative || candidate != NATIVE_LYRICS_SOURCE) &&
                                        rowBounds[candidate]?.contains(downRoot) == true
                                } ?: return@awaitEachGesture
                                // Let child buttons claim the press before starting a long press.
                                val finalDown = awaitPointerEvent(PointerEventPass.Final)
                                    .changes.firstOrNull { it.id == down.id }
                                if (finalDown == null || !finalDown.pressed || finalDown.isConsumed) {
                                    return@awaitEachGesture
                                }
                                val longPress = awaitLongPressOrCancellation(down.id)
                                    ?: return@awaitEachGesture
                                if (provider !in draftOrder.value) return@awaitEachGesture
                                val currentCoordinates = listCoordinates[0] ?: return@awaitEachGesture
                                val rowCenter = rowBounds[provider]?.center?.y ?: return@awaitEachGesture
                                val grabOffset = rowCenter - currentCoordinates.localToRoot(longPress.position).y
                                val centers = draftOrder.value
                                    .filter { !pinNative || it != NATIVE_LYRICS_SOURCE }
                                    .mapNotNull { rowBounds[it]?.center?.y }
                                if (centers.isEmpty() || centers.size != draftOrder.value.count { !pinNative || it != NATIVE_LYRICS_SOURCE }) return@awaitEachGesture
                                val minCenter = centers.first()
                                val maxCenter = centers.last()
                                dragSnapshot.value = draftOrder.value
                                pendingExternalOrder.value = null
                                dragSlotCenters.value = centers
                                draggedCenterY.value = rowCenter
                                draggingProvider.value = provider
                                longPress.consume()

                                var finished = false
                                try {
                                    while (true) {
                                        val event = awaitPointerEvent(PointerEventPass.Initial)
                                        val change = event.changes.firstOrNull { it.id == longPress.id } ?: break
                                        if (!change.pressed) {
                                            latestCompleteDrag.value(true)
                                            finished = true
                                            change.consume()
                                            break
                                        }
                                        if (change.isConsumed) break

                                        val coordinatesNow = listCoordinates[0] ?: break
                                        val pointer = coordinatesNow.localToRoot(change.position)
                                        val centerY = (pointer.y + grabOffset).coerceIn(minCenter, maxCenter)
                                        draggedCenterY.value = centerY

                                        val next = reorderLyricsSourceAt(
                                            order = draftOrder.value,
                                            provider = provider,
                                            pointerCenterY = centerY,
                                            slotCenters = centers,
                                            allSources = allSources,
                                            pinNative = pinNative,
                                        )
                                        if (next != draftOrder.value) draftOrder.value = next
                                        change.consume()
                                    }
                                } finally {
                                    if (!finished) latestCompleteDrag.value(false)
                                }
                            }
                        },
                ) {
                    LookaheadScope {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .semantics {
                                    collectionInfo = CollectionInfo(
                                        rowCount = draftOrder.value.size,
                                        columnCount = 1,
                                    )
                                },
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            draftOrder.value.forEachIndexed { index, provider ->
                                key(provider) {
                                    val dragging = draggingProvider.value == provider
                                    val desiredOffset = if (dragging) {
                                        val slotCenter = dragSlotCenters.value.getOrNull(index) ?: draggedCenterY.value
                                        draggedCenterY.value - slotCenter
                                    } else {
                                        0f
                                    }
                                    val offset by animateFloatAsState(
                                        targetValue = desiredOffset,
                                        animationSpec = if (dragging) snap() else spring(stiffness = 700f),
                                        label = "source-drag-offset",
                                    )
                                    val scale by animateFloatAsState(
                                        targetValue = if (dragging) 1.015f else 1f,
                                        animationSpec = tween(160),
                                        label = "source-drag-scale",
                                    )
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .then(
                                                if (dragging) Modifier
                                                else Modifier.animateBounds(this@LookaheadScope),
                                            )
                                            .onGloballyPositioned { rowBounds[provider] = it.boundsInRoot() }
                                            .zIndex(if (dragging || abs(offset) > 0.5f) 1f else 0f),
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .graphicsLayer {
                                                    translationY = offset
                                                    scaleY = scale
                                                },
                                        ) {
                                            LyricsSourceRow(
                                                provider = provider,
                                                order = draftOrder.value,
                                                index = index,
                                                dragging = dragging,
                                                tr = tr,
                                                onMove = ::moveSourceWithKeyboard,
                                                onRemove = { currentActions.value.call("$actionPrefix.remove", provider) },
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (availableSources.isNotEmpty()) {
                    SourceAddControls(
                        availableSources = availableSources,
                        selectedProvider = selectedProvider,
                        compact = compactControls,
                        tr = tr,
                        onSelectedProviderChange = { selectedProvider = it },
                        onAdd = {
                            val provider = selectedProvider
                            if (provider != null) {
                                selectedProvider = null
                                currentActions.value.call("$actionPrefix.add", provider)
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun LyricsSourceRow(
    provider: String,
    order: List<String>,
    index: Int,
    dragging: Boolean,
    tr: (String, String) -> String,
    onMove: (String, Int) -> Unit,
    onRemove: () -> Unit,
) {
    val native = provider == NATIVE_LYRICS_SOURCE
    val name = lyricsSourceName(provider, tr)
    val dragHint = tr("sourceDragHandle", "Press and hold to reorder")
    val pinnedDescription = tr("sourceNativeMainPinned", "Always last in the main group")
    val moveUpLabel = tr("sourceMoveUp", "Move up")
    val moveDownLabel = tr("sourceMoveDown", "Move down")
    val fromIndex = order.indexOf(provider)
    val lastMovableIndex = order.lastIndex - if (NATIVE_LYRICS_SOURCE in order) 1 else 0
    val canMoveUp = !native && fromIndex > 0
    val canMoveDown = !native && fromIndex in 0..<lastMovableIndex
    val customActions = buildList {
        if (canMoveUp) add(CustomAccessibilityAction(moveUpLabel) { onMove(provider, -1); true })
        if (canMoveDown) add(CustomAccessibilityAction(moveDownLabel) { onMove(provider, 1); true })
    }
    val interactionSource = remember { MutableInteractionSource() }
    val hovered by interactionSource.collectIsHoveredAsState()
    val focused by interactionSource.collectIsFocusedAsState()
    val rowColor by animateColorAsState(
        targetValue = when {
            dragging -> MiuixTheme.colorScheme.tertiaryContainer
            !native && (hovered || focused) -> lerp(
                MiuixTheme.colorScheme.surfaceVariant,
                MiuixTheme.colorScheme.onSurface,
                0.065f,
            )
            else -> lerp(
                MiuixTheme.colorScheme.surfaceVariant,
                MiuixTheme.colorScheme.onSurface,
                if (native) 0.025f else 0.04f,
            )
        },
        animationSpec = tween(160),
        label = "source-drag-color",
    )

    val interactionModifier = if (native) {
        Modifier
    } else {
        Modifier
            .focusable(interactionSource = interactionSource)
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (event.key) {
                    Key.DirectionUp -> if (canMoveUp) {
                        onMove(provider, -1)
                        true
                    } else {
                        false
                    }
                    Key.DirectionDown -> if (canMoveDown) {
                        onMove(provider, 1)
                        true
                    } else {
                        false
                    }
                    else -> false
                }
            }
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 54.dp)
            .then(if (native) Modifier else Modifier.hoverable(interactionSource = interactionSource))
            .then(interactionModifier)
            .semantics {
                contentDescription = name
                stateDescription = if (native) pinnedDescription else dragHint
                collectionItemInfo = CollectionItemInfo(
                    rowIndex = index,
                    rowSpan = 1,
                    columnIndex = 0,
                    columnSpan = 1,
                )
                if (customActions.isNotEmpty()) this.customActions = customActions
            },
        insideMargin = PaddingValues(horizontal = 12.dp),
        cornerRadius = 14.dp,
        colors = CardDefaults.defaultColors(
            color = rowColor,
            contentColor = MiuixTheme.colorScheme.onSurface,
        ),
    ) {
        if (native) {
            Column(
                modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp).padding(vertical = 7.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = name,
                    style = MiuixTheme.textStyles.body2,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = pinnedDescription,
                    style = MiuixTheme.textStyles.footnote2,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier.size(width = 20.dp, height = 20.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    val handleColor = MiuixTheme.colorScheme.onSurfaceVariantSummary
                    Canvas(Modifier.size(width = 14.dp, height = 18.dp)) {
                        val radius = 1.35.dp.toPx()
                        val xOffset = 2.6.dp.toPx()
                        val yOffset = 5.4.dp.toPx()
                        for (column in 0..1) {
                            val x = center.x + if (column == 0) -xOffset else xOffset
                            for (row in -1..1) {
                                drawCircle(
                                    color = handleColor,
                                    radius = radius,
                                    center = Offset(x, center.y + row * yOffset),
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.size(10.dp))
                Text(
                    text = name,
                    style = MiuixTheme.textStyles.body2,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                IconButton(
                    onClick = onRemove,
                    minWidth = 40.dp,
                    minHeight = 40.dp,
                    modifier = Modifier.semantics {
                        contentDescription = tr("titleRemoveSource", "Remove item")
                    },
                ) {
                    Icon(
                        imageVector = MiuixIcons.Delete,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    )
                }
            }
        }
    }
}

@Composable
private fun SourceAddControls(
    availableSources: List<String>,
    selectedProvider: String?,
    compact: Boolean,
    tr: (String, String) -> String,
    onSelectedProviderChange: (String?) -> Unit,
    onAdd: () -> Unit,
) {
    val selectedIndex = availableSources.indexOf(selectedProvider)
    val items = availableSources.map { lyricsSourceName(it, tr) }
    val dropdownTitle = tr("placeholderSelectSource", "Select source…")
    val pickerColors = CardDefaults.defaultColors(
        color = lerp(MiuixTheme.colorScheme.surfaceVariant, MiuixTheme.colorScheme.onSurface, 0.04f),
        contentColor = MiuixTheme.colorScheme.onSurface,
    )

    if (compact) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                insideMargin = PaddingValues(0.dp),
                cornerRadius = 14.dp,
                colors = pickerColors,
            ) {
                OverlayDropdownPreference(
                    items = items,
                    selectedIndex = selectedIndex,
                    title = dropdownTitle,
                    modifier = Modifier.fillMaxWidth(),
                    onSelectedIndexChange = { index ->
                        onSelectedProviderChange(availableSources.getOrNull(index))
                    },
                )
            }
            AddSourceButton(
                label = tr("buttonAddProvider", "Add source"),
                enabled = selectedProvider != null,
                onClick = onAdd,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    } else {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Card(
                modifier = Modifier.weight(1f),
                insideMargin = PaddingValues(0.dp),
                cornerRadius = 14.dp,
                colors = pickerColors,
            ) {
                OverlayDropdownPreference(
                    items = items,
                    selectedIndex = selectedIndex,
                    title = dropdownTitle,
                    modifier = Modifier.fillMaxWidth(),
                    onSelectedIndexChange = { index ->
                        onSelectedProviderChange(availableSources.getOrNull(index))
                    },
                )
            }
            AddSourceButton(
                label = tr("buttonAddProvider", "Add source"),
                enabled = selectedProvider != null,
                onClick = onAdd,
            )
        }
    }
}

@Composable
private fun AddSourceButton(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(),
    ) {
        Icon(
            imageVector = MiuixIcons.Add,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.size(7.dp))
        Text(text = label, style = MiuixTheme.textStyles.button)
    }
}

/** Locally imported TTML library with refresh and per-song deletion. */
@Composable
fun LocalLyricsSection(
    state: SettingsState,
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    SettingsPage {
        Card(
            modifier = Modifier.fillMaxWidth(),
            insideMargin = PaddingValues(horizontal = 18.dp, vertical = 16.dp),
            colors = CardDefaults.defaultColors(
                color = MiuixTheme.colorScheme.primaryContainer,
                contentColor = MiuixTheme.colorScheme.onPrimaryContainer,
            ),
        ) {
            Text(
                text = tr("localLyricsImportGuideTitle", "Import TTML from the song player"),
                style = MiuixTheme.textStyles.headline2,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.size(8.dp))
            GuideStep(
                1,
                tr("localLyricsImportStep1", "Open the current Apple Music song in the fullscreen lyrics player."),
            )
            GuideStep(
                2,
                tr("localLyricsImportStep2", "Open the player menu and choose Import TTML."),
            )
            GuideStep(
                3,
                tr(
                    "localLyricsImportStep3",
                    "The file is saved for that song and filled in automatically on later loads.",
                ),
            )
            Text(
                text = tr(
                    "localLyricsOverrideNote",
                    "In automatic mode, local TTML takes priority for the matching song. Delete it here to use other sources.",
                ),
                style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.padding(top = 10.dp),
            )
            TextButton(
                text = tr("linkTTMLTranslationGuide", "TTML translation guide"),
                onClick = {
                    actions.call(SettingsPlaybackActions.OPEN_EXTERNAL, TTML_TRANSLATION_GUIDE)
                },
                modifier = Modifier.padding(top = 4.dp),
                colors = ButtonDefaults.textButtonColorsPrimary(),
            )
        }

        SettingsCategory(title = tr("categoryLocalLyricsLibrary", "Local TTML library")) {
            if (state.localLyrics.isEmpty()) {
                Text(
                    text = tr("msgNoLocalLyrics", "No local TTML imports yet."),
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.localLyrics.forEach { entry ->
                        key(entry.songId) {
                            LocalLyricRow(entry, tr, actions)
                        }
                    }
                }
            }
            Spacer(Modifier.size(12.dp))
            Button(
                onClick = { actions.call(SettingsPlaybackActions.REFRESH_LOCAL_LYRICS, "") },
                colors = ButtonDefaults.buttonColors(),
            ) {
                Text(
                    text = tr("buttonRefreshList", "Refresh list"),
                    style = MiuixTheme.textStyles.button,
                )
            }
        }

        StatusMessage(
            statusValue(state, "local-lyrics-status", "localLyrics", "localLyricsStatus"),
        )
    }
}

@Composable
private fun SettingsPage(
    introduction: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (!introduction.isNullOrBlank()) {
            Text(
                text = introduction,
                style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
        content()
    }
}

@Composable
private fun SettingsCategory(
    title: String,
    insideMargin: PaddingValues = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = title,
            style = MiuixTheme.textStyles.subtitle,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        Card(
            modifier = Modifier.fillMaxWidth(),
            insideMargin = insideMargin,
        ) {
            content()
        }
    }
}

@Composable
private fun ToggleSetting(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    SwitchPreference(
        checked = checked,
        onCheckedChange = onCheckedChange,
        title = title,
        summary = description,
    )
}

@Composable
private fun ChoiceSetting(
    title: String,
    description: String,
    value: String,
    choices: List<Choice>,
    onSelected: (String) -> Unit,
) {
    OverlayDropdownPreference(
        items = choices.map { it.label },
        selectedIndex = choices.indexOfFirst { it.value == value }.coerceAtLeast(0),
        title = title,
        summary = description,
        onSelectedIndexChange = { index ->
            choices.getOrNull(index)?.let { onSelected(it.value) }
        },
    )
}

@Composable
private fun PlayerFontSetting(
    state: SettingsState,
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    val fontId = state.value("__fontId")
    var fontBytes by remember(fontId) { mutableStateOf<String?>(null) }
    var fontError by remember(fontId) { mutableStateOf("") }
    LaunchedEffect(fontId) {
        if (fontId.isNotEmpty()) {
            hostReadFont(fontId) { encoded, error ->
                fontError = error
                fontBytes = encoded.takeIf { it.isNotEmpty() }
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = tr("labelPlayerFont", "Player font file"),
            style = MiuixTheme.textStyles.body1,
            fontWeight = FontWeight.Medium,
        )
        Text(
            text = tr(
                "descPlayerFont",
                "Apply one font to all Apple Music player text. The file stays in extension storage.",
            ),
            style = MiuixTheme.textStyles.footnote1,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
        )

        Card(
            modifier = Modifier.fillMaxWidth().squircleBorder(
                width = 1.dp,
                color = MiuixTheme.colorScheme.dividerLine,
                cornerRadius = CardDefaults.CornerRadius,
            ),
            insideMargin = PaddingValues(0.dp),
            colors = CardDefaults.defaultColors(
                color = MiuixTheme.colorScheme.surfaceVariant,
                contentColor = MiuixTheme.colorScheme.onSurface,
            ),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                MuiscImportedFontPreview(
                    bytesBase64 = fontBytes,
                    identity = fontId,
                    idle = {
                        if (fontId.isEmpty()) FontSample(null)
                        else Text(if (fontError.isEmpty()) tr("msgLoading", "Loading…") else tr("msgPlayerFontPreviewFailed", "Could not load font preview."))
                    },
                    loading = { Text(tr("msgLoading", "Loading…")) },
                    failed = { Text(tr("msgPlayerFontPreviewFailed", "Could not load font preview.")) },
                    content = { family -> FontSample(family) },
                )
            }
        }

        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val compact = maxWidth < 480.dp
            if (compact) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FontActions(tr, actions)
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FontActions(tr, actions)
                }
            }
        }

        val status = statusValue(state, "player-font-status", "playerFont", "font")
        Text(
            text = status.ifBlank {
                state.fontName.ifBlank { tr("msgPlayerFontDefault", "Using default font") }
            },
            style = MiuixTheme.textStyles.footnote1,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
        )
    }
}

@Composable
private fun FontSample(family: FontFamily?) {
    Text(
        text = "夜航 · Night Voyage",
        style = MiuixTheme.textStyles.title3,
        fontFamily = family,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
    Text(
        text = "晚风轻轻掠过海面 · 01:23 / 04:56",
        style = MiuixTheme.textStyles.footnote1,
        fontFamily = family,
        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
    )
}

@Composable
private fun FontActions(
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    Button(
        onClick = { actions.call(SettingsPlaybackActions.IMPORT_PLAYER_FONT, "") },
        colors = ButtonDefaults.buttonColorsPrimary(),
    ) {
        Text(
            text = tr("buttonImportPlayerFont", "Import font file"),
            style = MiuixTheme.textStyles.button,
        )
    }
    TextButton(
        text = tr("buttonDefaultPlayerFont", "Use default font"),
        onClick = { actions.call(SettingsPlaybackActions.RESET_PLAYER_FONT, "") },
        colors = ButtonDefaults.textButtonColors(),
    )
}

@Composable
private fun CompactTextButton(
    label: String,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val rotation = when (label) {
        "↑" -> -90f
        "↓" -> 90f
        else -> 0f
    }
    val tint = MiuixTheme.colorScheme.onSurfaceVariantSummary.copy(
        alpha = if (enabled) 1f else 0.36f,
    )
    IconButton(
        onClick = onClick,
        enabled = enabled,
        minWidth = 34.dp,
        minHeight = 34.dp,
        modifier = Modifier.semantics { contentDescription = description },
    ) {
        Icon(
            imageVector = if (rotation == 0f) MiuixIcons.Close else MiuixIcons.ChevronForward,
            contentDescription = null,
            modifier = Modifier.size(18.dp).rotate(rotation),
            tint = tint,
        )
    }
}

@Composable
private fun LocalLyricRow(
    entry: LocalLyric,
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    val title = entry.title.ifBlank { entry.songId }
    val heading = if (entry.artist.isBlank()) title else "$title — ${entry.artist}"
    val prompt = tr(
        "confirmDeleteLyrics",
        "Delete local lyrics for \"\$NAME\$\"?",
    ).replace("\$NAME\$", heading)
    var confirming by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth().squircleBorder(
            width = 1.dp,
            color = MiuixTheme.colorScheme.dividerLine,
            cornerRadius = CardDefaults.CornerRadius,
        ),
        insideMargin = PaddingValues(0.dp),
        colors = CardDefaults.defaultColors(
            color = MiuixTheme.colorScheme.surfaceVariant,
            contentColor = MiuixTheme.colorScheme.onSurface,
        ),
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = heading,
                    style = MiuixTheme.textStyles.body1,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = entry.songId,
                    style = MiuixTheme.textStyles.footnote1,
                    color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            CompactTextButton(
                label = "×",
                description = tr("titleDeleteLocalLyrics", "Delete local lyrics"),
                enabled = true,
                onClick = { confirming = true },
            )
        }
    }

    OverlayDialog(
        show = confirming,
        title = tr("titleDeleteLocalLyrics", "Delete local lyrics"),
        summary = prompt,
        onDismissRequest = { confirming = false },
    ) {
        TextButton(
            text = tr("btnDeleteDict", "Delete"),
            onClick = {
                confirming = false
                actions.call(SettingsPlaybackActions.DELETE_LOCAL_LYRICS, entry.songId)
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.textButtonColorsPrimary(),
        )
    }
}

@Composable
private fun GuideStep(number: Int, text: String) {
    Row(
        modifier = Modifier.padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Surface(
            modifier = Modifier.size(24.dp),
            shape = CircleShape,
            color = MiuixTheme.colorScheme.primary,
            contentColor = MiuixTheme.colorScheme.onPrimary,
            shadowElevation = 0.dp,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = number.toString(),
                    style = MiuixTheme.textStyles.footnote2,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        Text(
            text = text,
            style = MiuixTheme.textStyles.body2,
            color = MiuixTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun StatusMessage(text: String) {
    if (text.isBlank()) return
    Text(
        text = text,
        style = MiuixTheme.textStyles.footnote1,
        color = MiuixTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = 4.dp),
    )
}

private fun allowedValue(value: String, allowed: List<String>, fallback: String): String =
    value.takeIf { it in allowed } ?: fallback

private fun statusValue(state: SettingsState, vararg keys: String): String =
    keys.firstNotNullOfOrNull { key -> state.status[key]?.takeIf { it.isNotBlank() } }.orEmpty()

private fun lyricsSourceOrder(state: SettingsState): List<String> {
    val configured = state.sourceOrder
        .takeIf { it.isNotEmpty() }
        ?: state.value("appleMusicLyricsProviderOrder")
            .split(',')
            .map(String::trim)
            .filter(String::isNotEmpty)
    val selected = if (configured.isEmpty()) defaultLyricsSources else configured
    return normalizeLyricsSources(selected)
}

private fun normalizeLyricsSources(
    order: List<String>,
    allSources: List<String> = allLyricsSources,
    pinNative: Boolean = true,
): List<String> =
    order.filter { it in allSources && (!pinNative || it != NATIVE_LYRICS_SOURCE) }
        .distinct() + (if (pinNative) listOf(NATIVE_LYRICS_SOURCE) else emptyList())

private fun moveLyricsSource(
    order: List<String>,
    provider: String,
    offset: Int,
    allSources: List<String> = allLyricsSources,
    pinNative: Boolean = true,
): List<String>? {
    val normalized = normalizeLyricsSources(order, allSources, pinNative)
    val from = normalized.indexOf(provider)
    val lastMovableIndex = normalized.lastIndex - if (pinNative) 1 else 0
    val to = from + offset
    if (from !in 0..lastMovableIndex || to !in 0..lastMovableIndex) return null
    return normalized.toMutableList().apply {
        removeAt(from)
        add(to, provider)
    }
}

private fun reorderLyricsSourceAt(
    order: List<String>,
    provider: String,
    pointerCenterY: Float,
    slotCenters: List<Float>,
    allSources: List<String> = allLyricsSources,
    pinNative: Boolean = true,
): List<String> {
    val normalized = normalizeLyricsSources(order, allSources, pinNative)
    val movable = normalized.filter { !pinNative || it != NATIVE_LYRICS_SOURCE }
    val from = movable.indexOf(provider)
    if (from < 0 || slotCenters.size != movable.size) return normalized

    var to = from
    while (to > 0) {
        val previous = slotCenters[to - 1]
        val current = slotCenters[to]
        val threshold = (previous + current) / 2f - (current - previous) * 0.12f
        if (pointerCenterY >= threshold) break
        to--
    }
    while (to < movable.lastIndex) {
        val current = slotCenters[to]
        val next = slotCenters[to + 1]
        val threshold = (current + next) / 2f + (next - current) * 0.12f
        if (pointerCenterY <= threshold) break
        to++
    }
    if (to == from) return normalized

    return movable.toMutableList().apply {
        removeAt(from)
        add(to, provider)
        if (pinNative) add(NATIVE_LYRICS_SOURCE)
    }
}

private fun lyricsSourceName(provider: String, tr: (String, String) -> String): String = when (provider) {
    "amll" -> "AMLL TTML DB"
    "lunabeat" -> "LunaBeat"
    "amlyrics" -> "AmLyrics"
    NATIVE_LYRICS_SOURCE -> "Apple Music"
    "netease" -> tr("lyricsSourceNetease", "NetEase Cloud Music")
    "kugou" -> tr("lyricsSourceKugou", "Kugou Music")
    "soda" -> tr("lyricsSourceSoda", "Soda Music")
    else -> provider
}
