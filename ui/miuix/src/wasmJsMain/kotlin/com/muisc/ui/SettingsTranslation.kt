package com.muisc.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.preference.OverlayDropdownPreference
import top.yukonga.miuix.kmp.preference.SwitchPreference
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** Service actions used by the translation and transliteration section. */
private object TranslationActions {
    const val DICTIONARY_STATUS = "dictionary.status"
    const val DICTIONARY_DOWNLOAD = "dictionary.download"
    const val DICTIONARY_DELETE = "dictionary.delete"
    const val CUSTOM_LLM_TEST = "customLLM.test"
}

private data class LocalizedChoice(
    val value: String,
    val labelKey: String,
    val fallback: String,
)

private data class Option(
    val value: String,
    val label: String,
)

private val TranslationProviderChoices = listOf(
    LocalizedChoice("google", "optionGoogleTranslate", "Google Translate"),
    LocalizedChoice("gemini", "optionGeminiAI", "Gemini AI"),
    LocalizedChoice("openrouter", "optionOpenRouter", "OpenRouter (LLM)"),
    LocalizedChoice("customllm", "optionCustomLLM", "Third-party LLM (Chat Completions)"),
    LocalizedChoice("deepl", "optionDeepL", "DeepL"),
    LocalizedChoice("deepl-keyless", "optionDeepLKeyless", "DeepL (Keyless)"),
)
private val TranslationProviderCodes = TranslationProviderChoices.map { it.value }.toSet()

private val RomanizationProviderChoices = listOf(
    LocalizedChoice("offline", "optionOfflineRomanizer", "Local / Offline"),
    LocalizedChoice("google", "optionGoogleTranslate", "Google Translate"),
    LocalizedChoice("gemini", "optionGeminiAI", "Gemini AI"),
    LocalizedChoice("openrouter", "optionOpenRouter", "OpenRouter (LLM)"),
    LocalizedChoice("customllm", "optionCustomLLM", "Third-party LLM (Chat Completions)"),
)
private val RomanizationProviderCodes = RomanizationProviderChoices.map { it.value }.toSet()

private val TransliterationTargetChoices = listOf(
    LocalizedChoice("latin", "optionLatin", "Latin (Romaji / Phonetic)"),
    LocalizedChoice("japanese", "optionJapanese", "Japanese (Katakana)"),
    LocalizedChoice("korean", "optionKorean", "Korean (Hangul)"),
    LocalizedChoice("cyrillic", "optionCyrillic", "Cyrillic (Russian)"),
    LocalizedChoice("devanagari", "optionDevanagari", "Devanagari (Hindi)"),
    LocalizedChoice("arabic", "optionArabic", "Arabic"),
    LocalizedChoice("hebrew", "optionHebrew", "Hebrew"),
    LocalizedChoice("greek", "optionGreek", "Greek"),
    LocalizedChoice("thai", "optionThai", "Thai"),
)
private val TransliterationTargetCodes = TransliterationTargetChoices.map { it.value }.toSet()

private val ThinkingFormatChoices = listOf(
    LocalizedChoice("auto", "optionLLMThinkingFormatAuto", "Auto"),
    LocalizedChoice("deepseek", "optionLLMThinkingFormatDeepSeek", "thinking.type + reasoning_effort"),
    LocalizedChoice("openrouter", "optionLLMThinkingFormatOpenRouter", "reasoning.enabled + reasoning.effort"),
    LocalizedChoice("none", "optionLLMThinkingFormatNone", "None (server default)"),
)
private val ThinkingFormatCodes = ThinkingFormatChoices.map { it.value }.toSet()

private val ThinkingEffortChoices = listOf(
    LocalizedChoice("low", "optionLLMThinkingLow", "Low"),
    LocalizedChoice("high", "optionLLMThinkingHigh", "High"),
    LocalizedChoice("max", "optionLLMThinkingMax", "Maximum"),
)
private val ThinkingEffortCodes = ThinkingEffortChoices.map { it.value }.toSet()

private val GeminiTranslationModelOptions = listOf(
    Option("gemini-flash-latest", "Gemini Flash Latest"),
    Option("gemini-flash-lite-latest", "Gemini Flash-Lite Latest"),
    Option("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"),
    Option("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"),
    Option("gemini-3-flash-preview", "Gemini 3 Flash Preview"),
    Option("gemini-2.5-flash", "Gemini 2.5 Flash"),
    Option("gemini-2.5-pro", "Gemini 2.5 Pro"),
    Option("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"),
    Option("gemini-2.0-flash", "Gemini 2.0 Flash"),
    Option("gemini-2.0-flash-lite", "Gemini 2.0 Flash-Lite"),
    Option("gemini-1.5-pro", "Gemini 1.5 Pro"),
    Option("gemini-1.5-flash", "Gemini 1.5 Flash"),
    Option("gemini-1.5-flash-8b", "Gemini 1.5 Flash-8B"),
    Option("gemma-4-31b-it", "Gemma 4-31B"),
    Option("gemma-4-26b-a4b-it", "Gemma 4-26B MoE"),
)
private val GeminiTranslationModelCodes = GeminiTranslationModelOptions.map { it.value }.toSet()

private val GeminiRomanizationModelOptions = listOf(
    Option("gemini-flash-latest", "Gemini Flash Latest"),
    Option("gemini-flash-lite-latest", "Gemini Flash-Lite Latest"),
    Option("gemini-3-flash-preview", "Gemini 3 Flash Preview"),
    Option("gemini-3-pro-preview", "Gemini 3 Pro Preview"),
    Option("gemini-2.5-flash", "Gemini 2.5 Flash"),
    Option("gemini-2.5-pro", "Gemini 2.5 Pro"),
    Option("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"),
    Option("gemini-2.0-flash", "Gemini 2.0 Flash"),
    Option("gemini-2.0-flash-lite", "Gemini 2.0 Flash-Lite"),
    Option("gemini-1.5-pro", "Gemini 1.5 Pro"),
    Option("gemini-1.5-flash", "Gemini 1.5 Flash"),
    Option("gemini-1.5-flash-8b", "Gemini 1.5 Flash-8B"),
    Option("gemma-4-31b-it", "Gemma 4-31B"),
    Option("gemma-4-26b-a4b-it", "Gemma 4-26B MoE"),
)
private val GeminiRomanizationModelCodes = GeminiRomanizationModelOptions.map { it.value }.toSet()

private val DeepLProviders = setOf("deepl", "deepl-keyless")
private val AIScriptProviders = setOf("gemini", "openrouter", "customllm")
private val DeepLSupportedCodes = setOf(
    "ace", "af", "sq", "ar", "an", "hy", "as", "ay", "az", "ba", "eu", "be", "bn", "bho", "bs", "br",
    "bg", "my", "yue", "ca", "ceb", "zh-CN", "zh-TW", "hr", "cs", "da", "fa-AF", "nl", "en",
    "eo", "et", "fi", "fr", "gl", "ka", "de", "el", "gn", "gu", "ht", "ha", "he", "hi", "hu", "is",
    "ig", "id", "ga", "it", "ja", "jv", "pam", "kk", "gom", "ko", "ku", "ckb", "ky", "la", "lv",
    "ln", "lt", "lmo", "lb", "mk", "mai", "mg", "ms", "ml", "mt", "mi", "mr", "mn", "ne", "no",
    "oc", "om", "pag", "ps", "fa", "pl", "pt", "pa", "qu", "ro", "ru", "sa", "sr", "st", "scn",
    "sk", "sl", "es", "su", "sw", "sv", "tl", "tg", "ta", "tt", "te", "th", "ts", "tn", "tr",
    "tk", "uk", "ur", "uz", "vi", "cy", "wo", "xh", "yi", "zu",
)

private val TargetLanguageTable = """
ab|Abkhaz (Аҧсуа)
ace|Acehnese (Basa Acèh)
ach|Acholi
aa|Afar (Qafaraf)
af|Afrikaans
ak|Akan / Twi
sq|Albanian (Shqip)
alz|Alur
am|Amharic (አማርኛ)
ar|Arabic (العربية)
hy|Armenian (Հայերեն)
as|Assamese (অসমীয়া)
av|Avar (Авар)
awa|Awadhi (अवधी)
ay|Aymara
az|Azerbaijani (Azərbaycan)
ban|Balinese (Basa Bali)
bal|Baluchi (بلوچی)
bm|Bambara
bci|Baoulé
ba|Bashkir (Башҡорт)
eu|Basque (Euskara)
btx|Batak Karo
bts|Batak Simalungun
bbc|Batak Toba
be|Belarusian (Беларуская)
bem|Bemba
bn|Bengali (বাংলা)
bew|Betawi (Basa Betawi)
bho|Bhojpuri (भोजपुरी)
bik|Bikol
bs|Bosnian (Bosanski)
br|Breton (Brezhoneg)
bg|Bulgarian (Български)
bua|Buryat (Буряад)
yue|Cantonese (粵語)
ca|Catalan (Català)
ceb|Cebuano
ch|Chamorro
ce|Chechen (Нохчийн)
ny|Chichewa / Nyanja
zh-CN|Chinese Simplified (简体中文)
zh-TW|Chinese Traditional (繁體中文)
chk|Chuukese
cv|Chuvash (Чӑвашла)
co|Corsican (Corsu)
crh|Crimean Tatar (Qırımtatarca)
hr|Croatian (Hrvatski)
cs|Czech (Čeština)
da|Danish (Dansk)
fa-AF|Dari (دری)
dv|Dhivehi (ދިވެހި)
din|Dinka
doi|Dogri (डोगरी)
dov|Dombe
nl|Dutch (Nederlands)
dyu|Dyula
dz|Dzongkha (རྫོང་ཁ)
en|English
eo|Esperanto
et|Estonian (Eesti)
ee|Ewe (Eʋegbe)
fo|Faroese (Føroyskt)
fj|Fijian (Na Vosa Vakaviti)
tl|Filipino / Tagalog
fi|Finnish (Suomi)
fon|Fon
fr|French (Français)
fy|Frisian (Frysk)
fur|Friulian (Furlan)
ff|Fulani / Peul (Fulfulde)
gaa|Ga
gl|Galician (Galego)
ka|Georgian (ქართული)
de|German (Deutsch)
el|Greek (Ελληνικά)
gn|Guarani
gu|Gujarati (ગુજરાતી)
ht|Haitian Creole (Kreyòl Ayisyen)
cnh|Hakha Chin
ha|Hausa
haw|Hawaiian (ʻŌlelo Hawaiʻi)
he|Hebrew (עברית)
hil|Hiligaynon
hi|Hindi (हिन्दी)
hmn|Hmong
hu|Hungarian (Magyar)
hrx|Hunsrik
iba|Iban
is|Icelandic (Íslenska)
ig|Igbo
ilo|Ilocano
id|Indonesian (Bahasa Indonesia)
ga|Irish (Gaeilge)
it|Italian (Italiano)
jam|Jamaican Patois
ja|Japanese (日本語)
jv|Javanese (Basa Jawa)
kac|Jingpo / Kachin
kl|Kalaallisut / Greenlandic
kn|Kannada (ಕನ್ನಡ)
knc|Kanuri
pam|Kapampangan
kk|Kazakh (Қазақша)
kha|Khasi
km|Khmer (ភាសាខ្មែរ)
cgg|Kiga
kg|Kikongo
rw|Kinyarwanda
ktu|Kituba
trp|Kokborok
kv|Komi (Коми)
gom|Konkani (कोंकणी)
ko|Korean (한국어)
kri|Krio
ku|Kurdish Kurmanji (Kurdî)
ckb|Kurdish Sorani (کوردی)
ky|Kyrgyz (Кыргызча)
lo|Lao (ພາສາລາວ)
ltg|Latgalian
la|Latin (Latina)
lv|Latvian (Latviešu)
lij|Ligurian
li|Limburgish
ln|Lingala
lt|Lithuanian (Lietuvių)
lmo|Lombard
lg|Luganda
luo|Luo
lb|Luxembourgish (Lëtzebuergesch)
mk|Macedonian (Македонски)
mad|Madurese (Basa Madhurâ)
mai|Maithili (मैथिली)
mak|Makassarese (Basa Mangkasara)
mg|Malagasy
ms|Malay (Bahasa Melayu)
ms-Arab|Malay Jawi (بهاس ملايو)
ml|Malayalam (മലയാളം)
mt|Maltese (Malti)
mam|Mam
gv|Manx (Gaelg)
mi|Maori (Te Reo Māori)
mr|Marathi (मराठी)
mh|Marshallese (Kajin M̧ajeļ)
mwr|Marwadi (मारवाड़ी)
mfe|Mauritian Creole (Morisien)
mhr|Meadow Mari (Марий)
mni-Mtei|Meiteilon / Manipuri (মৈতৈলোন্)
min|Minang (Baso Minangkabau)
lus|Mizo
mn|Mongolian (Монгол)
my|Myanmar / Burmese (မြန်မာ)
nah|Nahuatl
ndc|Ndau
nr|Ndebele South (isiNdebele)
new|Nepalbhasa / Newari (नेपालभाषा)
ne|Nepali (नेपाली)
nqo|NKo
nso|Northern Sotho / Sepedi
no|Norwegian (Norsk)
nus|Nuer
oc|Occitan
or|Odia / Oriya (ଓଡ଼ିଆ)
om|Oromo
os|Ossetian (Ирон)
pag|Pangasinan
pap|Papiamento
ps|Pashto (پښتو)
fa|Persian (فارسی)
pl|Polish (Polski)
pt|Portuguese (Português)
pa|Punjabi (ਪੰਜਾਬੀ)
pa-Arab|Punjabi Shahmukhi (پنجابی)
qu|Quechua
kek|Qʼeqchiʼ
rom|Romani
ro|Romanian (Română)
rn|Rundi / Kirundi
ru|Russian (Русский)
se|Sami North (Davvisámegiella)
sm|Samoan (Gagana Sāmoa)
sg|Sango
sa|Sanskrit (संस्कृतम्)
sat|Santali (ᱥᱟᱱᱛᱟᱲᱤ)
gd|Scots Gaelic (Gàidhlig)
sr|Serbian (Српски)
st|Sesotho
crs|Seychellois Creole
shn|Shan (ၵႂၢမ်းတႆး)
sn|Shona
scn|Sicilian (Sicilianu)
szl|Silesian (Ślōnskŏ)
sd|Sindhi (سنڌي)
si|Sinhala (සිංහල)
sk|Slovak (Slovenčina)
sl|Slovenian (Slovenščina)
so|Somali (Soomaali)
es|Spanish (Español)
su|Sundanese (Basa Sunda)
sus|Susu
sw|Swahili (Kiswahili)
ss|Swati / Swazi (SiSwati)
sv|Swedish (Svenska)
ty|Tahitian (Reo Tahiti)
tg|Tajik (Тоҷикӣ)
zgh|Tamazight (ⵜⴰⵎⴰⵣⵉⵖⵜ)
ta|Tamil (தமிழ்)
tt|Tatar (Татарча)
te|Telugu (తెలుగు)
tet|Tetum
th|Thai (ไทย)
bo|Tibetan (བོད་སྐད་)
ti|Tigrinya (ትግርኛ)
tiv|Tiv
tpi|Tok Pisin
to|Tongan (Lea Faka-Tonga)
ts|Tsonga (Xitsonga)
tn|Tswana (Setswana)
tcy|Tulu (ತುಳು)
tum|Tumbuka
tr|Turkish (Türkçe)
tk|Turkmen (Türkmençe)
tyv|Tuvan (Тыва дыл)
udm|Udmurt (Удмурт)
uk|Ukrainian (Українська)
ur|Urdu (اردو)
ug|Uyghur (ئۇيغۇرچە)
uz|Uzbek (Oʻzbekcha)
ve|Venda (Tshivenḓa)
vec|Venetian
vi|Vietnamese (Tiếng Việt)
war|Waray
cy|Welsh (Cymraeg)
wo|Wolof
xh|Xhosa (isiXhosa)
sah|Yakut / Sakha (Саха тыла)
yi|Yiddish (ייִדיש)
yo|Yoruba (Èdè Yorùbá)
yua|Yucatec Maya
zap|Zapotec
zu|Zulu (isiZulu)
""".trimIndent()

private val TargetLanguageOptions: List<Option> = TargetLanguageTable
    .lineSequence()
    .map { it.trim() }
    .filter { it.isNotEmpty() }
    .mapNotNull { line ->
        val separator = line.indexOf('|')
        if (separator <= 0) null else Option(line.substring(0, separator), line.substring(separator + 1))
    }
    .toList()

@Composable
fun TranslationSection(
    state: SettingsState,
    tr: (String, String) -> String,
    actions: SettingsActions,
) {
    val translationProviderState = rememberSyncedString(state, "translationProvider", "google")
    val translationProvider = normalizedChoice(
        translationProviderState.value,
        TranslationProviderCodes,
        "google",
    )
    val targetLanguageState = rememberSyncedString(state, "customTranslateTarget")
    val targetLanguage = targetLanguageState.value
    val romanizationProviderState = rememberSyncedString(state, "romanizationProvider", "offline")
    val romanizationProvider = normalizedChoice(
        romanizationProviderState.value,
        RomanizationProviderCodes,
        "offline",
    )
    val transliterationTargetState = rememberSyncedString(state, "transliterationTargetScript", "latin")
    val transliterationTarget = normalizedChoice(
        transliterationTargetState.value,
        TransliterationTargetCodes,
        "latin",
    )
    val thinkingFormatState = rememberSyncedString(state, "llmThinkingFormat", "auto")
    val thinkingFormat = normalizedChoice(thinkingFormatState.value, ThinkingFormatCodes, "auto")
    val thinkingEffortState = rememberSyncedString(state, "llmThinkingEffort", "high")
    val thinkingEffort = normalizedChoice(thinkingEffortState.value, ThinkingEffortCodes, "high")
    val thinkingEnabled = rememberSyncedBoolean(state, "llmThinkingEnabled", false)

    val geminiModelState = rememberSyncedString(state, "geminiModel", "gemini-flash-lite-latest")
    val geminiModel = normalizedChoice(
        geminiModelState.value,
        GeminiTranslationModelCodes,
        "gemini-flash-lite-latest",
    )
    val geminiRomanizationModelState = rememberSyncedString(
        state,
        "geminiRomanizationModel",
        "gemini-flash-latest",
    )
    val geminiRomanizationModel = normalizedChoice(
        geminiRomanizationModelState.value,
        GeminiRomanizationModelCodes,
        "gemini-flash-latest",
    )

    val geminiApiKey = rememberSyncedString(state, "geminiApiKey")
    val openRouterApiKey = rememberSyncedString(state, "openRouterApiKey")
    val openRouterModel = rememberSyncedString(state, "openRouterModel")
    val customLLMBaseUrl = rememberSyncedString(state, "customLLMBaseUrl")
    val customLLMApiKey = rememberSyncedString(state, "customLLMApiKey")
    val customLLMModel = rememberSyncedString(state, "customLLMModel")
    val deeplApiKey = rememberSyncedString(state, "deeplApiKey")
    val overrideTranslationPrompt = rememberSyncedBoolean(state, "overrideGeminiPrompt", false)
    val translationPrompt = rememberSyncedString(state, "customGeminiPrompt")
    val overrideRomanizationPrompt = rememberSyncedBoolean(
        state,
        "overrideGeminiRomanizePrompt",
        false,
    )
    val romanizationPrompt = rememberSyncedString(state, "customGeminiRomanizePrompt")

    val translationGemini = translationProvider == "gemini"
    val translationOpenRouter = translationProvider == "openrouter"
    val translationCustomLLM = translationProvider == "customllm"
    val translationAI = translationGemini || translationOpenRouter
    val romanizationGemini = romanizationProvider == "gemini"
    val romanizationOpenRouter = romanizationProvider == "openrouter"
    val romanizationCustomLLM = romanizationProvider == "customllm"
    val romanizationScriptAI = romanizationProvider in AIScriptProviders
    val customLLMSettings = translationCustomLLM || romanizationCustomLLM
    val offlineRomanization = romanizationProvider == "offline"
    val isDeepL = translationProvider in DeepLProviders
    val thinkingDisabled = customLLMSettings && thinkingFormat == "none" && !translationOpenRouter

    val translationProviderOptions = localizedOptions(TranslationProviderChoices, tr)
    val romanizationProviderOptions = localizedOptions(RomanizationProviderChoices, tr)
    val transliterationTargetOptions = localizedOptions(TransliterationTargetChoices, tr)
    val thinkingFormatOptions = localizedOptions(ThinkingFormatChoices, tr)
    val thinkingEffortOptions = localizedOptions(ThinkingEffortChoices, tr)
    val autoLabel = tr("optionTargetLangAuto", "Auto")
    val targetLanguageOptions = remember(isDeepL, targetLanguage, autoLabel) {
        buildTargetLanguageOptions(isDeepL, targetLanguage, autoLabel)
    }

    LaunchedEffect(isDeepL, targetLanguage) {
        if (isDeepL && targetLanguage.isNotEmpty() && targetLanguage !in DeepLSupportedCodes) {
            targetLanguageState.value = ""
            actions.set("customTranslateTarget", "")
        }
    }
    LaunchedEffect(romanizationProvider, transliterationTarget) {
        if (!romanizationScriptAI && transliterationTarget != "latin") {
            transliterationTargetState.value = "latin"
            actions.set("transliterationTargetScript", "latin")
        }
    }
    LaunchedEffect(romanizationProvider) {
        if (romanizationProvider == "offline") {
            actions.call(TranslationActions.DICTIONARY_STATUS, "japanese")
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            tr("navTranslationTransliteration", "Translation & transliteration"),
            style = MiuixTheme.textStyles.title3,
        )
        Text(
            tr(
                "translationApplePolicyNote",
                "Machine translation is used only when Apple Music provides original lyrics without a built-in translation. Apple-provided translations are kept.",
            ),
            style = MiuixTheme.textStyles.footnote1,
        )

        Text(
            tr("categoryTranslationService", "Translation Service"),
            style = MiuixTheme.textStyles.title3,
        )
        Card(modifier = Modifier.fillMaxWidth()) {
            ChoiceDropdown(
                title = tr("labelTranslationProvider", "Translation Provider"),
                summary = tr(
                    "descTranslationProvider",
                    "Select the service for translating lyrics.",
                ),
                options = translationProviderOptions,
                selectedValue = translationProvider,
                onSelectedValueChange = { provider ->
                    translationProviderState.value = provider
                    actions.set("translationProvider", provider)
                    if (provider in DeepLProviders
                        && targetLanguage.isNotEmpty()
                        && targetLanguage !in DeepLSupportedCodes
                    ) {
                        targetLanguageState.value = ""
                        actions.set("customTranslateTarget", "")
                    }
                },
            )
            ChoiceDropdown(
                title = tr("labelCustomTranslateTarget", "Target Language"),
                summary = tr(
                    "descOverrideTranslateTarget",
                    "Choose the language for lyric translations. The browser language is used by default.",
                ),
                options = targetLanguageOptions,
                selectedValue = targetLanguage,
                maxHeight = 420.dp,
                onSelectedValueChange = { language ->
                    targetLanguageState.value = language
                    actions.set("customTranslateTarget", language)
                },
            )
        }

        if (translationGemini || romanizationGemini) {
            Text(
                tr("categoryGeminiSettings", "Gemini AI Settings"),
                style = MiuixTheme.textStyles.title3,
            )
            Card(modifier = Modifier.fillMaxWidth()) {
                ApiKeyEditor(
                    title = tr("labelGeminiApiKey", "Gemini AI API Key"),
                    summary = tr(
                        "helperGeminiApiKey",
                        "Your API key is stored locally and sent only to Google's Gemini API.",
                    ),
                    value = geminiApiKey.value,
                    onValueChange = {
                        geminiApiKey.value = it
                        actions.set("geminiApiKey", it)
                    },
                    tr = tr,
                )
                if (translationGemini) {
                    ChoiceDropdown(
                        title = tr("labelGeminiModel", "Gemini AI Model"),
                        summary = tr("descGeminiModel", "Choose the Gemini AI model for translations."),
                        options = GeminiTranslationModelOptions,
                        selectedValue = geminiModel,
                        onSelectedValueChange = {
                            geminiModelState.value = it
                            actions.set("geminiModel", it)
                        },
                    )
                }
            }
        }

        if (translationOpenRouter || customLLMSettings) {
            Card(modifier = Modifier.fillMaxWidth()) {
                if (customLLMSettings) {
                    ChoiceDropdown(
                        title = tr("labelLLMThinkingFormat", "Thinking parameter format"),
                        summary = tr(
                            "descLLMThinkingFormat",
                            "Use a fixed format for proxy endpoints or model aliases. None leaves thinking behavior to the server.",
                        ),
                        options = thinkingFormatOptions,
                        selectedValue = thinkingFormat,
                        onSelectedValueChange = {
                            thinkingFormatState.value = it
                            actions.set("llmThinkingFormat", it)
                        },
                    )
                }
                SwitchPreference(
                    title = tr("labelLLMThinkingMode", "Thinking mode"),
                    summary = tr(
                        "descLLMThinkingMode",
                        "Only applies to DeepSeek-compatible endpoints and OpenRouter models that support thinking. Enabling it may increase response time.",
                    ),
                    checked = thinkingEnabled.value,
                    enabled = !thinkingDisabled,
                    onCheckedChange = {
                        thinkingEnabled.value = it
                        actions.set("llmThinkingEnabled", it.toString())
                    },
                )
                ChoiceDropdown(
                    title = tr("labelLLMThinkingEffort", "Thinking effort"),
                    summary = tr(
                        "descLLMThinkingEffort",
                        "Only applies when thinking is enabled. Higher effort may take longer.",
                    ),
                    options = thinkingEffortOptions,
                    selectedValue = thinkingEffort,
                    enabled = !thinkingDisabled && thinkingEnabled.value,
                    onSelectedValueChange = {
                        thinkingEffortState.value = it
                        actions.set("llmThinkingEffort", it)
                    },
                )
            }
        }

        if (translationOpenRouter || romanizationOpenRouter) {
            Text(
                tr("categoryOpenRouterSettings", "OpenRouter Settings"),
                style = MiuixTheme.textStyles.title3,
            )
            Card(modifier = Modifier.fillMaxWidth()) {
                ApiKeyEditor(
                    title = tr("labelOpenRouterApiKey", "OpenRouter API Key"),
                    summary = tr("helperOpenRouterApiKey", "Your API key is stored locally."),
                    value = openRouterApiKey.value,
                    onValueChange = {
                        openRouterApiKey.value = it
                        actions.set("openRouterApiKey", it)
                    },
                    tr = tr,
                )
                LabeledTextField(
                    title = tr(
                        "labelOpenRouterModel",
                        "OpenRouter Model (e.g., google/gemini-2.0-flash-001)",
                    ),
                    summary = tr(
                        "helperOpenRouterModel",
                        "Specify the model ID from OpenRouter.",
                    ),
                    value = openRouterModel.value,
                    onValueChange = {
                        openRouterModel.value = it
                        actions.set("openRouterModel", it)
                    },
                    placeholder = "google/gemini-2.0-flash-001",
                )
            }
        }

        if (customLLMSettings) {
            Text(
                tr("categoryCustomLLM", "Third-party LLM"),
                style = MiuixTheme.textStyles.title3,
            )
            Card(modifier = Modifier.fillMaxWidth()) {
                LabeledTextField(
                    title = tr("labelCustomLLMUrl", "API address"),
                    summary = tr(
                        "descCustomLLMUrl",
                        "Use a Chat Completions compatible base URL or full endpoint.",
                    ),
                    value = customLLMBaseUrl.value,
                    onValueChange = {
                        customLLMBaseUrl.value = it
                        actions.set("customLLMBaseUrl", it)
                    },
                    placeholder = "https://api.example.com/v1",
                )
                ApiKeyEditor(
                    title = "API key",
                    summary = tr(
                        "descCustomLLMKey",
                        "The key is stored locally and sent only to the API address you configure. Leave it blank if the service does not require one.",
                    ),
                    value = customLLMApiKey.value,
                    onValueChange = {
                        customLLMApiKey.value = it
                        actions.set("customLLMApiKey", it)
                    },
                    tr = tr,
                )
                LabeledTextField(
                    title = tr("labelCustomLLMModel", "Model name"),
                    summary = tr(
                        "descCustomLLMModel",
                        "Enter the model ID provided by your service.",
                    ),
                    value = customLLMModel.value,
                    onValueChange = {
                        customLLMModel.value = it
                        actions.set("customLLMModel", it)
                    },
                    placeholder = "model-id",
                )
                Column(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    TextButton(
                        text = tr(
                            "buttonTestCustomLLM",
                            "Authorize address and test connection",
                        ),
                        onClick = {
                            actions.call(
                                TranslationActions.CUSTOM_LLM_TEST,
                                customLLMTestPayload(
                                    baseUrl = customLLMBaseUrl.value,
                                    apiKey = customLLMApiKey.value,
                                    model = customLLMModel.value,
                                    thinkingFormat = thinkingFormat,
                                    thinkingEnabled = thinkingEnabled.value,
                                    thinkingEffort = thinkingEffort,
                                ),
                            )
                        },
                    )
                    state.status["customLLM"]?.takeIf { it.isNotEmpty() }?.let {
                        Text(it, style = MiuixTheme.textStyles.footnote1)
                    }
                }
            }
        }

        if (translationProvider == "deepl") {
            Text(
                tr("categoryDeepLSettings", "DeepL Settings"),
                style = MiuixTheme.textStyles.title3,
            )
            Card(modifier = Modifier.fillMaxWidth()) {
                ApiKeyEditor(
                    title = tr("labelDeepLApiKey", "DeepL API Key"),
                    summary = tr(
                        "helperDeepLApiKey",
                        "Your API key is stored locally. Free plan keys usually end with :fx",
                    ),
                    value = deeplApiKey.value,
                    onValueChange = {
                        deeplApiKey.value = it
                        actions.set("deeplApiKey", it)
                    },
                    tr = tr,
                )
            }
        }

        Text(
            tr("categoryRomanization", "Transliteration (script conversion)"),
            style = MiuixTheme.textStyles.title3,
        )
        Card(modifier = Modifier.fillMaxWidth()) {
            ChoiceDropdown(
                title = tr("labelRomanizationProvider", "Transliteration provider"),
                summary = tr(
                    "descRomanizationProvider",
                    "For Latin script, uses transliteration included in the lyrics when available; otherwise, it tries the selected service.",
                ),
                options = romanizationProviderOptions,
                selectedValue = romanizationProvider,
                onSelectedValueChange = { provider ->
                    romanizationProviderState.value = provider
                    actions.set("romanizationProvider", provider)
                    if (provider !in AIScriptProviders && transliterationTarget != "latin") {
                        transliterationTargetState.value = "latin"
                        actions.set("transliterationTargetScript", "latin")
                    }
                },
            )
            ChoiceDropdown(
                title = tr("labelTransliterationTarget", "Target writing system"),
                summary = tr(
                    "descTransliterationTarget",
                    "Convert lyrics to the selected writing system as a pronunciation aid (for example, English to Japanese Katakana). Non-Latin scripts require Gemini, OpenRouter, or a third-party LLM.",
                ),
                options = transliterationTargetOptions,
                selectedValue = transliterationTarget,
                enabled = romanizationScriptAI,
                onSelectedValueChange = {
                    transliterationTargetState.value = it
                    actions.set("transliterationTargetScript", it)
                },
            )
            if (!romanizationScriptAI) {
                Text(
                    tr(
                        "noteTransliterationTargetDisabled",
                        "Google Translate supports only Latin (romaji) transliteration. Choose Gemini, OpenRouter, or a third-party LLM as the transliteration provider to use other scripts.",
                    ),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    style = MiuixTheme.textStyles.footnote1,
                )
            }
            if (romanizationGemini) {
                ChoiceDropdown(
                    title = tr("labelGeminiRomanizationModel", "Gemini AI transliteration model"),
                    summary = tr(
                        "descGeminiRomanizationModel",
                        "Choose the Gemini AI model for transliteration.",
                    ),
                    options = GeminiRomanizationModelOptions,
                    selectedValue = geminiRomanizationModel,
                    onSelectedValueChange = {
                        geminiRomanizationModelState.value = it
                        actions.set("geminiRomanizationModel", it)
                    },
                )
            }
            if (offlineRomanization) {
                val japaneseStatus = dictionaryStatus(state, "japanese")
                DictionaryEditor(
                    title = tr("labelOfflineJapaneseDict", "Offline Japanese Dictionary (Kuromoji)"),
                    summary = tr(
                        "descOfflineJapaneseDict",
                        "Kuromoji's morphological analyzer dictionary (~17 MB) for more accurate Japanese pronunciation. Stored locally in your browser.",
                    ),
                    rawStatus = japaneseStatus,
                    size = "17 MB",
                    onDownload = {
                        actions.call(TranslationActions.DICTIONARY_DOWNLOAD, "japanese")
                    },
                    onDelete = {
                        actions.call(TranslationActions.DICTIONARY_DELETE, "japanese")
                    },
                    tr = tr,
                )
            }
        }

        if (translationAI || romanizationScriptAI) {
            Text(
                tr("categoryAdvancedPrompting", "Advanced Prompting (AI)"),
                style = MiuixTheme.textStyles.title3,
            )
            Card(modifier = Modifier.fillMaxWidth()) {
                if (translationAI) {
                    SwitchPreference(
                        title = tr("settingOverrideAIPrompt", "Override AI Translation Prompt"),
                        summary = tr(
                            "descOverrideAIPrompt",
                            "Use a custom prompt for Gemini/OpenRouter translations. Use {targetLang} and {lyrics} placeholders.",
                        ),
                        checked = overrideTranslationPrompt.value,
                        onCheckedChange = {
                            overrideTranslationPrompt.value = it
                            actions.set("overrideGeminiPrompt", it.toString())
                        },
                    )
                    if (overrideTranslationPrompt.value) {
                        LabeledTextField(
                            title = tr("labelCustomAIPrompt", "Custom AI Translation Prompt"),
                            summary = tr(
                                "helperCustomAIPrompt",
                                "Customize the prompt sent to the AI for translations. Use {targetLang} for the target language",
                            ),
                            value = translationPrompt.value,
                            onValueChange = {
                                translationPrompt.value = it
                                actions.set("customGeminiPrompt", it)
                            },
                            placeholder = tr(
                                "placeholderCustomTranslationPrompt",
                                "Custom translation prompt...",
                            ),
                            multiline = true,
                        )
                    }
                }
                if (romanizationScriptAI) {
                    SwitchPreference(
                        title = tr(
                            "settingOverrideRomanizePrompt",
                            "Override AI Romanization Prompt",
                        ),
                        summary = tr(
                            "descOverrideRomanizePrompt",
                            "Use a custom prompt for AI romanization.",
                        ),
                        checked = overrideRomanizationPrompt.value,
                        onCheckedChange = {
                            overrideRomanizationPrompt.value = it
                            actions.set("overrideGeminiRomanizePrompt", it.toString())
                        },
                    )
                    if (overrideRomanizationPrompt.value) {
                        LabeledTextField(
                            title = tr(
                                "labelCustomRomanizePrompt",
                                "Custom AI Romanization Prompt",
                            ),
                            summary = tr(
                                "helperCustomRomanizePrompt",
                                "Customize the prompt sent to the AI for romanization.",
                            ),
                            value = romanizationPrompt.value,
                            onValueChange = {
                                romanizationPrompt.value = it
                                actions.set("customGeminiRomanizePrompt", it)
                            },
                            placeholder = tr(
                                "placeholderCustomRomanizationPrompt",
                                "Custom romanization prompt...",
                            ),
                            multiline = true,
                        )
                    }
                }
            }
        }

        state.status["translation"]?.takeIf { it.isNotEmpty() }?.let {
            Text(it, style = MiuixTheme.textStyles.footnote1)
        }
    }
}

@Composable
private fun ChoiceDropdown(
    title: String,
    summary: String,
    options: List<Option>,
    selectedValue: String,
    onSelectedValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    maxHeight: androidx.compose.ui.unit.Dp? = null,
) {
    val selectedIndex = options.indexOfFirst { it.value == selectedValue }.coerceAtLeast(0)
    OverlayDropdownPreference(
        items = options.map { it.label },
        selectedIndex = selectedIndex,
        title = title,
        summary = summary,
        modifier = modifier,
        enabled = enabled,
        maxHeight = maxHeight,
        onSelectedIndexChange = { index ->
            options.getOrNull(index)?.let { onSelectedValueChange(it.value) }
        },
    )
}

@Composable
private fun ApiKeyEditor(
    title: String,
    summary: String,
    value: String,
    onValueChange: (String) -> Unit,
    tr: (String, String) -> String,
) {
    val visible = remember { mutableStateOf(false) }
    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title)
        Text(summary, style = MiuixTheme.textStyles.footnote1)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                label = "API key",
                useLabelAsPlaceholder = true,
                singleLine = true,
                visualTransformation = if (visible.value) {
                    VisualTransformation.None
                } else {
                    PasswordVisualTransformation()
                },
            )
            TextButton(
                text = if (visible.value) {
                    tr("buttonHideKey", "Hide")
                } else {
                    tr("buttonShowKey", "Show")
                },
                onClick = { visible.value = !visible.value },
            )
        }
    }
}

@Composable
private fun LabeledTextField(
    title: String,
    summary: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    multiline: Boolean = false,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title)
        Text(summary, style = MiuixTheme.textStyles.footnote1)
        TextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            label = placeholder,
            useLabelAsPlaceholder = placeholder.isNotEmpty(),
            singleLine = !multiline,
            minLines = if (multiline) 3 else 1,
            maxLines = if (multiline) 8 else 1,
        )
    }
}

@Composable
private fun DictionaryEditor(
    title: String,
    summary: String,
    rawStatus: String?,
    size: String,
    onDownload: () -> Unit,
    onDelete: () -> Unit,
    tr: (String, String) -> String,
) {
    val installed = dictionaryInstalled(rawStatus)
    val downloading = dictionaryDownloading(rawStatus)
    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title)
        Text(summary, style = MiuixTheme.textStyles.footnote1)
        Text(
            dictionaryStatusText(rawStatus, size, tr),
            style = MiuixTheme.textStyles.footnote1,
        )
        if (installed) {
            TextButton(
                text = tr("btnDeleteDict", "Delete"),
                onClick = onDelete,
            )
        } else {
            TextButton(
                text = tr("btnDownloadDict", "Download"),
                enabled = !downloading,
                onClick = onDownload,
            )
        }
    }
}

@Composable
private fun rememberSyncedString(
    state: SettingsState,
    settingKey: String,
    fallback: String = "",
): MutableState<String> {
    val stored = state.value(settingKey, fallback)
    val value = remember(settingKey) { mutableStateOf(stored) }
    LaunchedEffect(stored) {
        if (value.value != stored) value.value = stored
    }
    return value
}

@Composable
private fun rememberSyncedBoolean(
    state: SettingsState,
    settingKey: String,
    fallback: Boolean = false,
): MutableState<Boolean> {
    val stored = state.enabled(settingKey, fallback)
    val value = remember(settingKey) { mutableStateOf(stored) }
    LaunchedEffect(stored) {
        if (value.value != stored) value.value = stored
    }
    return value
}

private fun localizedOptions(
    choices: List<LocalizedChoice>,
    tr: (String, String) -> String,
): List<Option> = choices.map { Option(it.value, tr(it.labelKey, it.fallback)) }

private fun normalizedChoice(value: String, allowed: Set<String>, fallback: String): String =
    if (value in allowed) value else fallback

private fun buildTargetLanguageOptions(
    isDeepL: Boolean,
    selectedValue: String,
    autoLabel: String,
): List<Option> {
    val available = if (isDeepL) {
        TargetLanguageOptions.filter { it.value in DeepLSupportedCodes }
    } else {
        TargetLanguageOptions
    }
    val unknownSelection = selectedValue
        .takeIf {
            it.isNotEmpty()
                && available.none { option -> option.value == it }
                && (!isDeepL || it in DeepLSupportedCodes)
        }
        ?.let { listOf(Option(it, it)) }
        ?: emptyList()
    return listOf(Option("", autoLabel)) + available + unknownSelection
}

private fun dictionaryStatus(state: SettingsState, kind: String): String? =
    state.dictionaryStatus[kind]
        ?: state.dictionaryStatus["" + kind + "Status"]
        ?: state.dictionaryStatus["" + kind + "Installed"]

private fun dictionaryInstalled(rawStatus: String?): Boolean {
    val status = rawStatus?.trim()?.lowercase().orEmpty()
    return status == "true"
        || status == "installed"
        || status.startsWith("installed")
        || status.contains("\"installed\":true")
}

private fun dictionaryDownloading(rawStatus: String?): Boolean =
    rawStatus?.trim()?.lowercase()?.startsWith("downloading") == true

private fun dictionaryStatusText(
    rawStatus: String?,
    size: String,
    tr: (String, String) -> String,
): String {
    val status = rawStatus?.trim()?.lowercase().orEmpty()
    val text = when {
        dictionaryInstalled(rawStatus) ->
            tr("dictStatusInstalled", "Installed (~\$SIZE\$)")

        dictionaryDownloading(rawStatus) ->
            tr("dictStatusDownloading", "Downloading (~\$SIZE\$)...")

        status.startsWith("unavailable")
            || status.startsWith("error")
            || status.startsWith("failed") ->
            tr("msgDictionaryUnavailable", "Unavailable")

        else ->
            tr("dictStatusNotInstalled", "Not Installed (~\$SIZE\$)")
    }
    return text.replace("\$SIZE\$", size)
}

private fun customLLMTestPayload(
    baseUrl: String,
    apiKey: String,
    model: String,
    thinkingFormat: String,
    thinkingEnabled: Boolean,
    thinkingEffort: String,
): String = "{" +
    "\"customLLMBaseUrl\":" + jsonString(baseUrl) + "," +
    "\"customLLMApiKey\":" + jsonString(apiKey) + "," +
    "\"customLLMModel\":" + jsonString(model) + "," +
    "\"llmThinkingFormat\":" + jsonString(thinkingFormat) + "," +
    "\"llmThinkingEnabled\":" + thinkingEnabled.toString() + "," +
    "\"llmThinkingEffort\":" + jsonString(thinkingEffort) +
    "}"

private fun jsonString(value: String): String = buildString {
    append('"')
    for (ch in value) {
        when (ch) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\b' -> append("\\b")
            '\u000C' -> append("\\f")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (ch.code < 0x20) {
                append("\\u")
                append(ch.code.toString(16).padStart(4, '0'))
            } else {
                append(ch)
            }
        }
    }
    append('"')
}

