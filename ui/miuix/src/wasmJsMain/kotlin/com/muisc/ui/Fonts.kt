@file:OptIn(ExperimentalEncodingApi::class, ExperimentalWasmJsInterop::class)

package com.muisc.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.js.ExperimentalWasmJsInterop
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.TextStyles

/**
 * The bundled variable fonts, restricted to the Unicode ranges used by the extension UI.
 * They come from Google Fonts' upstream Noto Sans families; each OFL license is stored
 * beside its WOFF2 file. The files are intentionally UI subsets rather than full Pan-CJK
 * fonts, which keeps the extension package near 2 MiB instead of tens of MiB.
 */
private data class BundledFont(
    val id: String,
    val fileName: String,
)

private val bundledFonts = listOf(
    BundledFont("muisc-latin", "noto-sans-latin-ui.woff2"),
    BundledFont("muisc-sc", "noto-sans-sc-ui.woff2"),
    BundledFont("muisc-tc", "noto-sans-tc-ui.woff2"),
    BundledFont("muisc-jp", "noto-sans-jp-ui.woff2"),
    BundledFont("muisc-kr", "noto-sans-kr-ui.woff2"),
    BundledFont("muisc-arabic", "noto-sans-arabic-ui.woff2"),
    BundledFont("muisc-hebrew", "noto-sans-hebrew-ui.woff2"),
    BundledFont("muisc-devanagari", "noto-sans-devanagari-ui.woff2"),
    BundledFont("muisc-bengali", "noto-sans-bengali-ui.woff2"),
    BundledFont("muisc-thai", "noto-sans-thai-ui.woff2"),
    BundledFont("muisc-tamil", "noto-sans-tamil-ui.woff2"),
    BundledFont("muisc-telugu", "noto-sans-telugu-ui.woff2"),
)

private val bundledFontWeights = listOf(
    FontWeight.W400 to 400,
    FontWeight.W500 to 500,
    FontWeight.W600 to 600,
    FontWeight.W700 to 700,
)

private data class LoadedBundledFont(
    val id: String,
    val family: FontFamily,
)

private data class BundledFontLoadResult(
    val primaryFamily: FontFamily?,
    val failures: List<String>,
)

/** The primary local family, or null outside [MuiscFonts]. */
val LocalMuiscFontFamily = staticCompositionLocalOf<FontFamily?> { null }

/**
 * Preloads the extension's local Noto Sans subsets and applies them to every Miuix text style.
 *
 * Put this once around the root Compose content. Nested `MiuixTheme(colors = ...)` calls inherit
 * the resulting text styles through MiuixTheme.textStyles. Rendering is held until every fetch has
 * settled so the first text frame cannot cause Compose Web's automatic remote Noto fallback.
 *
 * @param loading content painted while local assets are loading; the default is blank.
 * @param content application UI. If every bundled file is unavailable, it is rendered with the
 * platform fallback so the settings UI remains reachable; individual failures are logged.
 */
@Composable
fun MuiscFonts(
    loading: @Composable () -> Unit = {},
    content: @Composable () -> Unit,
) {
    val resolver = LocalFontFamilyResolver.current
    var result by remember { mutableStateOf<BundledFontLoadResult?>(null) }

    LaunchedEffect(resolver) {
        result = loadBundledFonts(resolver)
    }

    val loaded = result
    if (loaded == null) {
        loading()
        return
    }

    val family = loaded.primaryFamily
    if (family == null) {
        content()
        return
    }

    val baseTextStyles = MiuixTheme.textStyles
    val textStyles = remember(baseTextStyles, family) { baseTextStyles.withMuiscFontFamily(family) }
    MiuixTheme(textStyles = textStyles) {
        CompositionLocalProvider(LocalMuiscFontFamily provides family) {
            content()
        }
    }
}

/** Copies a Miuix type scale with [fontFamily] assigned to every text role. */
fun TextStyles.withMuiscFontFamily(fontFamily: FontFamily): TextStyles = copy(
    main = main.withFontFamily(fontFamily),
    paragraph = paragraph.withFontFamily(fontFamily),
    body1 = body1.withFontFamily(fontFamily),
    body2 = body2.withFontFamily(fontFamily),
    button = button.withFontFamily(fontFamily),
    footnote1 = footnote1.withFontFamily(fontFamily),
    footnote2 = footnote2.withFontFamily(fontFamily),
    headline1 = headline1.withFontFamily(fontFamily),
    headline2 = headline2.withFontFamily(fontFamily),
    subtitle = subtitle.withFontFamily(fontFamily),
    title1 = title1.withFontFamily(fontFamily),
    title2 = title2.withFontFamily(fontFamily),
    title3 = title3.withFontFamily(fontFamily),
    title4 = title4.withFontFamily(fontFamily),
)

private fun TextStyle.withFontFamily(fontFamily: FontFamily): TextStyle =
    copy(fontFamily = fontFamily)

private suspend fun loadBundledFonts(resolver: FontFamily.Resolver): BundledFontLoadResult = coroutineScope {
    val downloaded = bundledFonts.map { font ->
        async { font to fetchBundledFont(font.fileName) }
    }.awaitAll()

    val failures = mutableListOf<String>()
    val loaded = downloaded.mapNotNull { (font, bytes) ->
        if (bytes == null) {
            failures += font.fileName
            null
        } else {
            runCatching { createVariableFamily(font.id, bytes) }
                .onFailure { error ->
                    failures += font.fileName
                    muiscConsoleWarn("Could not construct ${font.fileName}: ${error.message ?: error}")
                }
                .getOrNull()
                ?.let { family ->
                    val preloaded = runCatching { resolver.preload(family) }
                    preloaded
                        .onFailure { error ->
                            failures += font.fileName
                            muiscConsoleWarn("Could not preload ${font.fileName}: ${error.message ?: error}")
                        }
                    if (preloaded.isSuccess) LoadedBundledFont(font.id, family) else null
                }
        }
    }

    if (failures.isNotEmpty()) {
        muiscConsoleWarn("Offline Muisc fonts unavailable: ${failures.joinToString()}")
    }

    BundledFontLoadResult(
        primaryFamily = loaded.firstOrNull { it.id == "muisc-latin" }?.family
            ?: loaded.firstOrNull()?.family,
        failures = failures,
    )
}

private fun createVariableFamily(id: String, bytes: ByteArray): FontFamily = FontFamily(
    bundledFontWeights.map { (weight, variationWeight) ->
        Font(
            identity = "$id-$variationWeight",
            getData = { bytes },
            weight = weight,
            style = FontStyle.Normal,
            variationSettings = FontVariation.Settings(FontVariation.weight(variationWeight)),
        )
    },
)

/** The browser host has not supplied an imported font record. */
sealed interface MuiscImportedFontState {
    data object NoFont : MuiscImportedFontState
    data object Loading : MuiscImportedFontState
    @Immutable
    data class Ready(val family: FontFamily) : MuiscImportedFontState
    data class Failed(val reason: MuiscImportedFontError) : MuiscImportedFontState
}

enum class MuiscImportedFontError {
    InvalidBase64,
    UnsupportedData,
}

/**
 * Converts the base64 representation of a stored IndexedDB ArrayBuffer into a Compose FontFamily.
 * Pass the record ID (not the bytes) as [identity]. A content hash is added to the internal Compose
 * identity so replacing the bytes for the same record cannot reuse a stale cached face. No callback
 * in this module reads Chrome storage.
 *
 * The host must first call the existing `readImportedFont(id)` path and base64-encode
 * `record.buffer`. Until that value arrives, this state remains [MuiscImportedFontState.NoFont].
 */
@Composable
fun rememberMuiscImportedFontState(
    bytesBase64: String?,
    identity: String,
): MuiscImportedFontState {
    val encoded = bytesBase64?.takeIf { it.isNotBlank() }
    var state by remember(encoded, identity) {
        mutableStateOf<MuiscImportedFontState>(
            if (encoded == null) MuiscImportedFontState.NoFont else MuiscImportedFontState.Loading,
        )
    }

    LaunchedEffect(encoded, identity) {
        if (encoded == null) {
            state = MuiscImportedFontState.NoFont
            return@LaunchedEffect
        }
        state = MuiscImportedFontState.Loading
        state = decodeImportedFont(encoded, identity)
    }
    return state
}

/**
 * Renders [content] only when the real imported font bytes are ready. Use the idle, loading, and
 * failed slots for localized status UI; this prevents the default-font sample from masquerading as
 * the selected player font.
 */
@Composable
fun MuiscImportedFontPreview(
    bytesBase64: String?,
    identity: String,
    idle: @Composable () -> Unit,
    loading: @Composable () -> Unit,
    failed: @Composable (MuiscImportedFontError) -> Unit,
    content: @Composable (FontFamily) -> Unit,
) {
    when (val state = rememberMuiscImportedFontState(bytesBase64, identity)) {
        MuiscImportedFontState.NoFont -> idle()
        MuiscImportedFontState.Loading -> loading()
        is MuiscImportedFontState.Ready -> content(state.family)
        is MuiscImportedFontState.Failed -> failed(state.reason)
    }
}

private fun decodeImportedFont(encoded: String, identity: String): MuiscImportedFontState {
    val bytes = runCatching { Base64.decode(encoded) }.getOrNull()
        ?: return MuiscImportedFontState.Failed(MuiscImportedFontError.InvalidBase64)
    if (!looksLikeFont(bytes)) {
        return MuiscImportedFontState.Failed(MuiscImportedFontError.UnsupportedData)
    }
    return runCatching {
        val family = FontFamily(listOf(
            Font(
                identity = "muisc-imported-${identity.hashCode()}-${bytes.contentHashCode()}",
                getData = { bytes },
                weight = FontWeight.Normal,
                style = FontStyle.Normal,
            ),
        ))
        MuiscImportedFontState.Ready(family)
    }.getOrElse { error ->
        muiscConsoleWarn("Could not construct imported font preview: ${error.message ?: error}")
        MuiscImportedFontState.Failed(MuiscImportedFontError.UnsupportedData)
    }
}

private fun looksLikeFont(bytes: ByteArray): Boolean {
    if (bytes.size < 4) return false
    val first = bytes[0].toInt() and 0xFF
    val second = bytes[1].toInt() and 0xFF
    val third = bytes[2].toInt() and 0xFF
    val fourth = bytes[3].toInt() and 0xFF
    if (first == 0 && second == 1 && third == 0 && fourth == 0) return true
    val tag = "${first.toChar()}${second.toChar()}${third.toChar()}${fourth.toChar()}"
    return tag == "OTTO" || tag == "true" || tag == "typ1" || tag == "ttcf" ||
        tag == "wOFF" || tag == "wOF2"
}

private suspend fun fetchBundledFont(fileName: String): ByteArray? = suspendCancellableCoroutine { continuation ->
    fetchBundledFontJs(
        fileName = fileName,
        onOk = { encoded ->
            if (continuation.isActive) {
                continuation.resume(runCatching { Base64.decode(encoded) }.getOrNull())
            }
        },
        onErr = { error ->
            if (continuation.isActive) {
                muiscConsoleWarn("Could not load $fileName: $error")
                continuation.resume(null)
            }
        },
    )
}

@JsFun(
    """
    function fetchBundledFontJs(fileName, onOk, onErr) {
        function fail(error) {
            onErr(String(error && error.message || error));
        }
        try {
            var scripts = Array.from(document.scripts || []);
            var entry = scripts.find(function (script) {
                var path = String(script.src || '').split(/[?#]/, 1)[0];
                return path.endsWith('/muiscMiuix.js');
            });
            var scriptUrl = entry ? entry.src : document.baseURI;
            var url = new URL('fonts/' + fileName, scriptUrl).href;
            var controller = new AbortController();
            var timer = setTimeout(function () { controller.abort(); }, 30000);
            fetch(url, { cache: 'force-cache', credentials: 'omit', signal: controller.signal })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
                    return response.arrayBuffer();
                })
                .then(function (buffer) {
                    clearTimeout(timer);
                    var bytes = new Uint8Array(buffer);
                    var chunks = [];
                    var step = 0x8000;
                    for (var i = 0; i < bytes.length; i += step) {
                        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step)));
                    }
                    onOk(btoa(chunks.join('')));
                })
                .catch(function (error) {
                    clearTimeout(timer);
                    fail(error);
                });
        } catch (error) {
            fail(error);
        }
    }
    """,
)
private external fun fetchBundledFontJs(
    fileName: String,
    onOk: (String) -> Unit,
    onErr: (String) -> Unit,
)

@JsFun(
    """
    function muiscConsoleWarn(message) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[Muisc fonts]', message);
    }
    """,
)
private external fun muiscConsoleWarn(message: String)
