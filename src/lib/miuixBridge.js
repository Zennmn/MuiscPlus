import {
    clearCache,
    defaultSettings,
    deleteDictionary,
    deleteLocalLyrics,
    downloadDictionary,
    getDictionaryStatus,
    getLocalLyricsList,
    getSettings,
    loadSettings,
    saveSettings,
    setupSettingsMessageListener,
    updateCacheSize,
    updateSettings
} from './settingsManager.js';
import { readImportedFont } from './importedPlayerFont.js';
import { normalizeFallbackLyricsOrder, FALLBACK_LYRICS_NAMES } from './appleLyricsSources.js';
import {
    MIUIX_ACTIONS,
    addFallbackLyricsProvider,
    removeFallbackLyricsProvider,
    setFallbackLyricsProviderOrder,
    addLyricsProvider,
    createSettingsExport,
    deletePlayerFontAsset,
    getLyricsSourceState,
    importPlayerFontAsset,
    importSettingsJSON,
    normalizeLyricsProviderOrder,
    performMiuixAction,
    removeLyricsProvider,
    requestCustomLLMPermission,
    resetPlayerFont,
    sanitizeImportedSettings,
    setLyricsProviderOrder,
    testCustomLLMConnection
} from '../settings/miuixActions.js';

const CACHE_TARGETS = new Set(['lyrics', 'translations', 'romanization', 'all']);
const DICTIONARIES = new Set(['japanese']);
const RESTART_REQUIRED_KEYS = new Set(['isEnabled', 'appleMusicAMLL']);
const DEBOUNCED_KEYS = new Set([
    'geminiApiKey',
    'openRouterApiKey',
    'openRouterModel',
    'customLLMBaseUrl',
    'customLLMApiKey',
    'customLLMModel',
    'deeplApiKey',
    'customGeminiPrompt',
    'customGeminiRomanizePrompt'
]);
const DEEPL_SUPPORTED_CODES = new Set([
    '', 'ace', 'af', 'sq', 'ar', 'an', 'hy', 'as', 'ay', 'az', 'ba', 'eu', 'be', 'bn', 'bho', 'bs', 'br',
    'bg', 'my', 'yue', 'ca', 'ceb', 'zh-CN', 'zh-TW', 'hr', 'cs', 'da', 'fa-AF', 'nl', 'en',
    'eo', 'et', 'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gn', 'gu', 'ht', 'ha', 'he', 'hi', 'hu', 'is', 'ig', 'id', 'ga', 'it', 'ja', 'jv', 'pam',
    'kk', 'gom', 'ko', 'ku', 'ckb', 'ky', 'la', 'lv', 'ln', 'lt', 'lmo', 'lb', 'mk', 'mai', 'mg',
    'ms', 'ml', 'mt', 'mi', 'mr', 'mn', 'ne', 'no', 'oc', 'om', 'pag', 'ps', 'fa', 'pl', 'pt',
    'pa', 'qu', 'ro', 'ru', 'sa', 'sr', 'st', 'scn', 'sk', 'sl', 'es', 'su', 'sw', 'sv', 'tl', 'tg', 'ta', 'tt', 'te', 'th', 'ts', 'tn', 'tr', 'tk', 'uk',
    'ur', 'uz', 'vi', 'cy', 'wo', 'xh', 'yi', 'zu'
]);

const subscribers = new Set();
const lastSnapshots = new WeakMap();
const statusValues = new Map();
const statusTimers = new Map();
const saveTimers = new Map();
const derived = {
    localLyrics: [],
    dictionaryStatus: { japanese: '' },
    cacheStats: {
        lyrics: '',
        translations: '',
        romanization: '',
        all: '',
        sizeMB: '0.00 MB',
        cacheCount: '0'
    }
};

let initialization;
let cacheRevision = 0;
let lyricsRevision = 0;
let settingsRevision = 0;
let restartPending = false;

function i18nMessage(key, substitutions, fallback = '') {
    const api = globalThis.chrome?.i18n || globalThis.browser?.i18n;
    try {
        const value = api?.getMessage?.(key, substitutions);
        return typeof value === 'string' && value ? value : fallback;
    } catch {
        return fallback;
    }
}

function translate(key, fallback = '') {
    return i18nMessage(key, undefined, fallback);
}

function errorText(error) {
    const message = String(error?.message || error || 'Unknown error');
    const code = String(error?.code || '');
    return code && !message.includes(code) ? code + ': ' + message : message;
}

function errorMessage(key, fallback, error) {
    const detail = errorText(error);
    const message = i18nMessage(key, [detail], fallback) || fallback;
    return message.includes(detail) ? message : message + ' ' + detail;
}

function parseArgument(argument) {
    if (typeof argument !== 'string') return argument;
    const value = argument.trim();
    if (!value) return '';
    try {
        return JSON.parse(value);
    } catch {
        return argument;
    }
}

function emitSnapshot() {
    if (!subscribers.size) return;
    let snapshotJson;
    try {
        snapshotJson = JSON.stringify(createSnapshot());
    } catch (error) {
        console.warn('Muisc+: could not create Miuix snapshot', error);
        return;
    }
    for (const callback of subscribers) {
        if (lastSnapshots.get(callback) === snapshotJson) continue;
        try {
            callback(snapshotJson);
            lastSnapshots.set(callback, snapshotJson);
        } catch (error) {
            console.warn('Muisc+: Miuix snapshot subscriber failed', error);
        }
    }
}

function reportStatus(areas, message, options = {}) {
    const list = (Array.isArray(areas) ? areas : [areas]).filter(Boolean);
    for (const area of list) {
        statusValues.set(area, message || '');
        clearTimeout(statusTimers.get(area));
        statusTimers.delete(area);
        if (message && !options.persistent) {
            statusTimers.set(area, setTimeout(() => {
                if (statusValues.get(area) !== message) return;
                statusValues.delete(area);
                statusTimers.delete(area);
                emitSnapshot();
            }, options.error ? 8000 : 4000));
        }
    }
    emitSnapshot();
}

function clearStatus(area) {
    clearTimeout(statusTimers.get(area));
    statusTimers.delete(area);
    if (statusValues.delete(area)) emitSnapshot();
}

function settingsValueString(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return '';
        }
    }
    return String(value);
}

function versionString() {
    try {
        return String(globalThis.chrome?.runtime?.getManifest?.().version || '');
    } catch {
        return '';
    }
}

function createSnapshot() {
    const settings = getSettings();
    const values = {};
    for (const key of Object.keys(defaultSettings)) {
        values[key] = settingsValueString(settings[key] ?? defaultSettings[key]);
    }
    values.__version = versionString();
    values.appleMusicLyricsFallbackOrder = normalizeFallbackLyricsOrder(settings.appleMusicLyricsFallbackOrder).join(',');
    values.__fontId = String(settings.appleMusicPlayerFontFile?.id || '');

    let sourceOrder = [];
    try {
        sourceOrder = getLyricsSourceState(settings.appleMusicLyricsProviderOrder)
            .order
            .map(String);
    } catch {
        sourceOrder = [];
    }

    const fontFile = settings.appleMusicPlayerFontFile;
    return {
        values,
        sourceOrder,
        localLyrics: derived.localLyrics.map(item => ({
            songId: String(item.songId || ''),
            title: String(item.title || ''),
            artist: String(item.artist || '')
        })),
        dictionaryStatus: { ...derived.dictionaryStatus },
        fontName: String(fontFile?.name || settings.appleMusicPlayerFont || ''),
        cacheStats: { ...derived.cacheStats },
        status: Object.fromEntries(
            Array.from(statusValues.entries()).filter(([, value]) => Boolean(value))
        )
    };
}

function ensureStarted() {
    if (initialization) return initialization;
    setupSettingsMessageListener(emitSnapshot);
    initialization = loadSettings()
        .then(async () => {
            emitSnapshot();
            await Promise.allSettled([
                refreshLocalLyrics({ announce: false }),
                refreshDictionaries({ announce: false }),
                refreshCache({ announce: false })
            ]);
            emitSnapshot();
        })
        .catch(error => {
            reportStatus(
                ['popup'],
                errorMessage('msgSettingsSaveFailed', 'Could not load settings.', error),
                { error: true }
            );
        });
    return initialization;
}

function subscribe(callback) {
    if (typeof callback !== 'function') {
        reportStatus(['popup'], 'Miuix snapshot callback must be a function.', { error: true });
        return;
    }
    subscribers.add(callback);
    ensureStarted().then(emitSnapshot);
}

function displayMB(value) {
    const text = String(value ?? '0.00');
    return /mb/i.test(text) ? text : text + ' MB';
}

function cacheSize(section, fallback = '0.00') {
    if (section?.sizeMB !== undefined && section?.sizeMB !== null && section?.sizeMB !== '') {
        return String(section.sizeMB);
    }
    const sizeKB = Number(section?.sizeKB);
    return Number.isFinite(sizeKB) ? (sizeKB / 1024).toFixed(2) : fallback;
}

function cacheStatsFromResult(result) {
    const lyrics = result.lyrics || {};
    const translations = result.translations || {};
    const romanizations = result.romanizations || {};
    const lyricSize = cacheSize(lyrics);
    const lyricCount = String(lyrics.count ?? result.cacheCount ?? 0);
    const translationSize = cacheSize(translations);
    const translationCount = String(translations.count ?? 0);
    const romanizationSize = cacheSize(romanizations);
    const romanizationCount = String(romanizations.count ?? 0);
    const totalSize = cacheSize(result);
    const totalCount = String(result.cacheCount ?? 0);

    return {
        lyrics: i18nMessage(
            'labelLyricsCacheFormat',
            [lyricSize, lyricCount],
            lyricSize + ' MB used (' + lyricCount + ' songs cached)'
        ),
        translations: i18nMessage(
            'labelTranslationCacheFormat',
            [translationSize, translationCount],
            translationSize + ' MB used (' + translationCount + ' translations cached)'
        ),
        romanization: i18nMessage(
            'labelRomanizationCacheFormat',
            [romanizationSize, romanizationCount],
            romanizationSize + ' MB used (' + romanizationCount + ' transliterations cached)'
        ),
        all: i18nMessage(
            'labelTotalCacheFormat',
            [totalSize, totalCount],
            totalSize + ' MB used (' + totalCount + ' items cached)'
        ),
        sizeMB: displayMB(totalSize),
        cacheCount: totalCount
    };
}

async function refreshCache({ announce = false } = {}) {
    const revision = ++cacheRevision;
    try {
        const result = await updateCacheSize();
        if (revision !== cacheRevision) return;
        if (!result?.success) throw new Error(result?.error || 'Cache info unavailable.');
        derived.cacheStats = cacheStatsFromResult(result);
        if (announce) {
            reportStatus(['advanced', 'popup'], translate('msgCacheRefreshed', 'Cache info refreshed.'));
        } else {
            emitSnapshot();
        }
    } catch (error) {
        if (revision !== cacheRevision) return;
        const unavailable = translate('msgCacheUnavailable', 'Cache info unavailable.');
        derived.cacheStats = {
            lyrics: unavailable,
            translations: unavailable,
            romanization: unavailable,
            all: unavailable,
            sizeMB: '0.00 MB',
            cacheCount: '0'
        };
        reportStatus(
            ['advanced', 'popup'],
            errorMessage('msgErrorLoadingCache', 'Error loading cache size.', error),
            { error: true }
        );
    }
}

async function refreshDictionary(dictionary, { announce = false } = {}) {
    try {
        const state = await getDictionaryStatus(dictionary);
        derived.dictionaryStatus[dictionary] = state?.installed ? 'installed' : 'notInstalled';
        emitSnapshot();
        return state;
    } catch (error) {
        derived.dictionaryStatus[dictionary] = 'unavailable';
        reportStatus(
            ['translation'],
            errorMessage('msgDictionaryUnavailable', 'Offline dictionary unavailable.', error),
            { error: true }
        );
        if (announce) emitSnapshot();
        return null;
    }
}

async function refreshDictionaries({ announce = false } = {}) {
    await refreshDictionary('japanese', { announce });
}

function normalizeLocalLyrics(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map(entry => {
        const info = entry?.songInfo && typeof entry.songInfo === 'object' ? entry.songInfo : {};
        const songId = String(entry?.songId || info.appleId || '');
        return {
            songId,
            title: String(info.title || info.name || songId),
            artist: String(info.artist || '')
        };
    }).filter(item => item.songId);
}

async function refreshLocalLyrics({ announce = false } = {}) {
    const revision = ++lyricsRevision;
    try {
        const entries = await getLocalLyricsList();
        if (revision !== lyricsRevision) return;
        derived.localLyrics = normalizeLocalLyrics(entries);
        if (announce) {
            reportStatus(['localLyrics'], translate('msgLocalLyricsRefreshed', 'Local TTML library refreshed.'));
        } else {
            emitSnapshot();
        }
    } catch (error) {
        if (revision !== lyricsRevision) return;
        reportStatus(
            ['localLyrics'],
            errorMessage('msgErrorLoadingLocalLyrics', 'Could not load local lyrics.', error),
            { error: true }
        );
    }
}

function convertRawValue(key, rawValue) {
    const expected = defaultSettings[key];
    const raw = String(rawValue ?? '');

    if (expected === null) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new TypeError('Setting ' + key + ' only accepts null.');
        }
        if (parsed !== null) throw new TypeError('Setting ' + key + ' only accepts null.');
        return parsed;
    }

    if (typeof expected === 'object') {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new TypeError('Setting ' + key + ' must be valid JSON.');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new TypeError('Setting ' + key + ' must be a JSON object.');
        }
        return parsed;
    }

    if (typeof expected === 'boolean') {
        const value = raw.trim().toLowerCase();
        if (value !== 'true' && value !== 'false') {
            throw new TypeError('Setting ' + key + ' must be true or false.');
        }
        return value === 'true';
    }

    if (typeof expected === 'number') {
        if (!raw.trim()) throw new TypeError('Setting ' + key + ' must be a number.');
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new TypeError('Setting ' + key + ' must be a finite number.');
        return value;
    }

    if (typeof expected === 'string') return raw;
    throw new TypeError('Setting ' + key + ' has an unsupported type.');
}

function applySettingDependencies(values) {
    const result = { ...values };
    if (Object.hasOwn(result, 'appleMusicLyricsFallbackOrder')) {
        result.appleMusicLyricsFallbackOrder = normalizeFallbackLyricsOrder(result.appleMusicLyricsFallbackOrder).join(',');
    }
    if (Object.hasOwn(result, 'appleMusicLyricsProviderOrder')) {
        result.appleMusicLyricsProviderOrder = normalizeLyricsProviderOrder(
            result.appleMusicLyricsProviderOrder
        ).join(',');
    }

    const next = { ...getSettings(), ...result };
    if (
        (next.translationProvider === 'deepl' || next.translationProvider === 'deepl-keyless')
        && next.customTranslateTarget
        && !DEEPL_SUPPORTED_CODES.has(next.customTranslateTarget)
    ) {
        result.customTranslateTarget = '';
    }

    if (
        !['gemini', 'openrouter'].includes(next.romanizationProvider)
        && next.transliterationTargetScript
        && next.transliterationTargetScript !== 'latin'
    ) {
        result.transliterationTargetScript = 'latin';
    }

    return result;
}

function settingStatusAreas(key) {
    const areas = ['popup'];
    if (
        /^(translationProvider|romanizationProvider|transliterationTargetScript|gemini|openRouter|customLLM|llmThinking|deepl|overrideGemini|customGemini|customTranslateTarget)/.test(key)
    ) {
        areas.push('translation');
        if (/^(customLLM|llmThinking|openRouter|gemini|overrideGemini|customGemini)/.test(key)) {
            areas.push('customLLM');
        }
    } else if (key === 'cacheStrategy') {
        areas.push('advanced');
    } else if (key === 'appleMusicPlayerFont' || key === 'appleMusicPlayerFontFile') {
        areas.push('playerFont');
    } else if (key === 'appleMusicLyricsFallbackOrder') {
        areas.push('fallbackSources');
    } else if (key === 'appleMusicLyricsProviderOrder') {
        areas.push('sources');
    } else {
        areas.push('playback');
    }
    return Array.from(new Set(areas));
}

function savedSettingMessage(key) {
    if (key === 'appleMusicLyricsProviderOrder' || key === 'appleMusicLyricsFallbackOrder') {
        return translate('msgSourceOrderSaved', 'Lyrics source order saved.');
    }
    if (settingStatusAreas(key).includes('translation')) {
        return translate(
            'msgTranslationSettingsSaved',
            'Translation settings saved and applied to the Apple Music player.'
        );
    }
    if (settingStatusAreas(key).includes('advanced')) {
        return translate('msgAdvancedSettingsSaved', 'Settings saved.');
    }
    return translate(
        'msgPlaybackSettingsSaved',
        'Playback settings saved and applied to Apple Music.'
    );
}

async function persistSettings(revision, key) {
    try {
        await saveSettings();
        emitSnapshot();
        if (revision !== settingsRevision) return;
        const areas = settingStatusAreas(key);
        reportStatus(['popup'], translate('msgSettingsSaved', 'Settings saved.'));
        reportStatus(areas, savedSettingMessage(key));
        if (restartPending) {
            restartPending = false;
            reportStatus(
                ['reload'],
                translate('msgAppleRestart', 'Reload Apple Music to apply this change.'),
                { persistent: true }
            );
        }
    } catch (error) {
        reportStatus(
            settingStatusAreas(key),
            errorMessage('msgSettingsSaveFailed', 'Could not save settings.', error),
            { error: true }
        );
    }
}

function scheduleSettingsSave(key, revision) {
    if (!DEBOUNCED_KEYS.has(key)) {
        void persistSettings(revision, key);
        return;
    }
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(() => {
        saveTimers.delete(key);
        void persistSettings(revision, key);
    }, 500));
}

function setRaw(key, rawValue) {
    try {
        ensureStarted();
        if (typeof key !== 'string' || !Object.hasOwn(defaultSettings, key)) {
            throw new Error('Unknown setting key: ' + String(key));
        }
        const converted = convertRawValue(key, rawValue);
        const sanitized = sanitizeImportedSettings({ [key]: converted });
        if (!Object.hasOwn(sanitized, key)) {
            throw new TypeError('Invalid value for setting ' + key + '.');
        }
        const values = applySettingDependencies(sanitized);
        const current = getSettings();
        const changed = Object.fromEntries(
            Object.entries(values).filter(([name, value]) =>
                JSON.stringify(current[name]) !== JSON.stringify(value)
            )
        );
        if (!Object.keys(changed).length) return;

        updateSettings(changed);
        if (RESTART_REQUIRED_KEYS.has(key)) restartPending = true;
        settingsRevision++;
        emitSnapshot();
        scheduleSettingsSave(key, settingsRevision);
    } catch (error) {
        const areas = typeof key === 'string' ? settingStatusAreas(key) : ['popup', 'playback'];
        reportStatus(
            areas,
            errorMessage('msgSettingsSaveFailed', 'Could not save settings.', error),
            { error: true }
        );
    }
}

function chooseFile(accept, onFile) {
    if (!globalThis.document?.createElement) throw new Error('File chooser is unavailable.');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    (globalThis.document.body || globalThis.document.documentElement).appendChild(input);

    let disposed = false;
    const cleanup = () => {
        if (disposed) return;
        disposed = true;
        input.remove();
    };
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        cleanup();
        if (file) void onFile(file);
    }, { once: true });
    setTimeout(cleanup, 60000);
    input.click();
}

function readFileText(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'));
        reader.readAsText(file);
    });
}

function downloadSettingsExport() {
    try {
        const exported = createSettingsExport();
        const blob = new Blob([exported.content], { type: exported.mediaType || 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = exported.filename;
        (document.body || document.documentElement).appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        reportStatus(['config'], translate('msgExportSuccess', 'Settings exported successfully!'));
    } catch (error) {
        reportStatus(
            ['config'],
            errorMessage('msgExportError', 'Error exporting settings.', error),
            { error: true }
        );
    }
}

async function importSettingsValue(value) {
    try {
        await importSettingsJSON(value);
        emitSnapshot();
        reportStatus(['config'], translate('msgImportSuccess', 'Settings imported successfully. Reload the page to apply them.'));
        reportStatus(
            ['reload'],
            translate('msgAppleRestart', 'Reload Apple Music to apply this change.'),
            { persistent: true }
        );
    } catch (error) {
        reportStatus(
            ['config'],
            errorMessage('msgImportError', 'Error importing settings.', error),
            { error: true }
        );
    }
}

function chooseSettingsFile() {
    chooseFile('application/json,.json', async file => {
        try {
            await importSettingsValue(await readFileText(file));
        } catch (error) {
            reportStatus(
                ['config'],
                errorMessage('msgFileReadError', 'Could not read the file.', error),
                { error: true }
            );
        }
    });
}

function readFontBase64(id, callback) {
    if (typeof callback !== 'function') throw new TypeError('Font callback must be a function.');
    Promise.resolve().then(async () => {
        if (typeof id !== 'string' || !id) throw new Error('Font ID is required.');
        const record = await readImportedFont(id);
        if (!record) throw new Error('Font not found: ' + id);
        if (!(record.buffer instanceof ArrayBuffer) || !record.buffer.byteLength) {
            throw new Error('Font data is missing or invalid.');
        }
        const bytes = new Uint8Array(record.buffer);
        const chunkSize = 3 * 8192;
        const chunks = [];
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
        }
        return chunks.join('');
    }).then(
        encoded => callback(encoded, ''),
        error => callback('', errorText(error))
    ).catch(error => console.warn('Muisc+: font callback failed', error));
}

function chooseFontFile() {
    chooseFile('.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2', async file => {
        reportStatus(['playerFont'], translate('msgPlayerFontImporting', 'Importing font...'));
        try {
            await importPlayerFontAsset(file);
            emitSnapshot();
            reportStatus(
                ['playerFont'],
                translate('msgPlayerFontImported', 'Font imported and applied to the Apple Music player.')
            );
        } catch (error) {
            reportStatus(
                ['playerFont'],
                errorMessage('msgPlayerFontImportFailed', 'Unable to import this font.', error),
                { error: true }
            );
        }
    });
}

function finishTask(task, onSuccess, onError) {
    Promise.resolve(task)
        .then(async value => {
            await onSuccess?.(value);
            emitSnapshot();
        })
        .catch(error => {
            if (onError) onError(error);
            else reportStatus(['popup'], errorText(error), { error: true });
        });
}

function runLyricsSourceAction(action, payload) {
    const fallback = action.startsWith('fallbackLyricsSources.');
    const area = fallback ? 'fallbackSources' : 'sources';
    const operation = action.split('.').pop();
    const provider = typeof payload === 'string' ? payload : payload?.provider;
    const nameKeys = { netease: 'lyricsSourceNetease', kugou: 'lyricsSourceKugou', soda: 'lyricsSourceSoda' };
    const providerName = fallback
        ? translate(nameKeys[provider], FALLBACK_LYRICS_NAMES[provider] || String(provider || ''))
        : String(provider || '');
    let task;
    let success;
    if (operation === 'reorder') {
        task = fallback ? setFallbackLyricsProviderOrder(payload) : setLyricsProviderOrder(payload?.order ?? payload);
        success = translate('msgSourceOrderSaved', 'Lyrics source order saved.');
    } else if (operation === 'add') {
        task = fallback ? addFallbackLyricsProvider(provider) : addLyricsProvider(provider);
        success = i18nMessage(
            'msgSourceAdded',
            [providerName],
            'Lyrics source added.'
        );
    } else {
        task = fallback ? removeFallbackLyricsProvider(provider) : removeLyricsProvider(provider);
        success = i18nMessage(
            'msgSourceRemoved',
            [providerName],
            'Lyrics source removed.'
        );
    }
    finishTask(
        task,
        () => reportStatus([area], success),
        error => reportStatus(
            [area],
            errorMessage('msgSourceOrderSaveFailed', 'Could not save the lyrics source order.', error),
            { error: true }
        )
    );
}

function runFontAction(action, payload) {
    let task;
    let success;
    if (action === MIUIX_ACTIONS.RESET_PLAYER_FONT) {
        task = resetPlayerFont();
        success = translate('msgPlayerFontReset', 'Default player font restored.');
    } else {
        const fontId = typeof payload === 'string' ? payload : payload?.fontId;
        task = deletePlayerFontAsset(fontId);
        success = 'Player font record deleted.';
    }
    finishTask(
        task,
        () => reportStatus(['playerFont'], success),
        error => reportStatus(
            ['playerFont'],
            errorMessage('msgPlayerFontImportFailed', 'Unable to update the player font.', error),
            { error: true }
        )
    );
}

function runDictionaryAction(action, payload) {
    const dictionary = String(
        typeof payload === 'object' ? payload?.dictionary : payload || 'japanese'
    ).toLowerCase();
    if (!DICTIONARIES.has(dictionary)) {
        reportStatus(
            ['translation'],
            'Unknown offline dictionary: ' + dictionary,
            { error: true }
        );
        return;
    }

    if (action === 'dictionary.status') {
        void refreshDictionary(dictionary, { announce: true });
        return;
    }

    const fallbackSize = '17 MB';
    if (action === 'dictionary.download') {
        derived.dictionaryStatus[dictionary] = 'downloading';
        reportStatus(
            ['translation'],
            i18nMessage('dictStatusDownloading', [fallbackSize], 'Downloading (~' + fallbackSize + ')...')
        );
        finishTask(
            downloadDictionary(dictionary),
            async result => {
                await refreshDictionary(dictionary);
                const size = displayMB(result?.sizeMB || fallbackSize.replace(' MB', ''));
                reportStatus(
                    ['translation'],
                    i18nMessage('dictStatusInstalled', [size], 'Installed (~' + size + ')')
                );
            },
            error => {
                derived.dictionaryStatus[dictionary] = 'unavailable';
                reportStatus(
                    ['translation'],
                    errorMessage('msgDictionaryDownloadFailed', 'Download failed.', error),
                    { error: true }
                );
            }
        );
        return;
    }

    if (action === 'dictionary.delete') {
        finishTask(
            deleteDictionary(dictionary),
            () => {
                derived.dictionaryStatus[dictionary] = 'notInstalled';
                reportStatus(
                    ['translation'],
                    i18nMessage(
                        'dictStatusNotInstalled',
                        [fallbackSize],
                        'Not installed (~' + fallbackSize + ')'
                    )
                );
            },
            error => {
                derived.dictionaryStatus[dictionary] = 'unavailable';
                reportStatus(
                    ['translation'],
                    errorMessage('msgDictionaryDeleteFailed', 'Could not delete the offline dictionary.', error),
                    { error: true }
                );
            }
        );
        return;
    }

    reportStatus(['translation'], 'Unsupported dictionary action: ' + action, { error: true });
}

function runCustomLLMAction(action, payload) {
    const values = payload && typeof payload === 'object' ? payload : {};
    if (action === MIUIX_ACTIONS.REQUEST_CUSTOM_LLM_PERMISSION) {
        finishTask(
            requestCustomLLMPermission(values),
            data => {
                if (!data?.granted) {
                    throw new Error(translate('msgCustomLLMPermissionDenied', 'Access was not granted.'));
                }
                reportStatus(
                    ['customLLM', 'translation'],
                    translate('msgCustomLLMPermissionGranted', 'Permission granted.')
                );
            },
            error => reportStatus(
                ['customLLM', 'translation'],
                errorMessage('msgCustomLLMTestFailed', 'Permission request failed:', error),
                { error: true }
            )
        );
        return;
    }

    finishTask(
        testCustomLLMConnection(values),
        data => {
            const prefix = translate('msgCustomLLMTestSuccess', 'Connection successful:');
            reportStatus(
                ['customLLM', 'translation'],
                prefix + ' ' + String(data?.translatedText || '')
            );
        },
        error => reportStatus(
            ['customLLM', 'translation'],
            errorMessage('msgCustomLLMTestFailed', 'Connection failed:', error),
            { error: true }
        )
    );
}

function openTabNow(url) {
    const browserTabs = globalThis.browser?.tabs;
    if (browserTabs?.create) return browserTabs.create({ url });

    const chromeTabs = globalThis.chrome?.tabs;
    if (chromeTabs?.create) {
        return new Promise((resolve, reject) => {
            chromeTabs.create({ url }, () => {
                const error = globalThis.chrome?.runtime?.lastError?.message;
                if (error) reject(new Error(error));
                else resolve();
            });
        });
    }

    const opened = globalThis.open?.(url, '_blank', 'noopener');
    if (opened) return Promise.resolve();
    return Promise.reject(new Error('Tabs API unavailable.'));
}

function openExternal(argument) {
    let url;
    try {
        const parsed = new URL(String(argument || ''));
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new Error('Only HTTP and HTTPS links are supported.');
        }
        url = parsed.href;
    } catch (error) {
        reportStatus(
            ['config'],
            errorMessage('msgSettingsSaveFailed', 'Could not open the link.', error),
            { error: true }
        );
        return;
    }
    finishTask(
        openTabNow(url),
        () => {},
        error => reportStatus(
            ['config'],
            errorMessage('msgSettingsSaveFailed', 'Could not open the link.', error),
            { error: true }
        )
    );
}

function openSettings() {
    try {
        const url = globalThis.chrome?.runtime?.getURL?.('src/settings/index.html')
            || globalThis.browser?.runtime?.getURL?.('src/settings/index.html');
        if (!url) throw new Error('Runtime API unavailable.');
        finishTask(
            openTabNow(url),
            () => {},
            error => reportStatus(
                ['popup'],
                errorMessage('msgSettingsSaveFailed', 'Could not open settings.', error),
                { error: true }
            )
        );
    } catch (error) {
        reportStatus(
            ['popup'],
            errorMessage('msgSettingsSaveFailed', 'Could not open settings.', error),
            { error: true }
        );
    }
}

function reloadAppleMusic() {
    finishTask(
        performMiuixAction({ type: MIUIX_ACTIONS.RELOAD_APPLE_TABS, payload: null }),
        raw => {
            const result = JSON.parse(raw);
            if (!result?.ok) {
                throw new Error(result?.error?.message || result?.error?.code || 'Reload failed.');
            }
            clearStatus('reload');
        },
        error => reportStatus(
            ['reload', 'popup'],
            errorText(error),
            { error: true }
        )
    );
}

function actionStatusAreas(action) {
    if (action.startsWith('fallbackLyricsSources.')) return ['fallbackSources'];
    if (action.startsWith('lyricsSources.')) return ['sources'];
    if (action.startsWith('playerFont.')) return ['playerFont'];
    if (action.startsWith('dictionary.')) return ['translation'];
    if (action.startsWith('customLLM.')) return ['customLLM', 'translation'];
    if (action.startsWith('appleMusicTabs.')) return ['reload'];
    return ['popup'];
}

function runGenericAction(action, payload) {
    const areas = actionStatusAreas(action);
    const task = performMiuixAction({ type: action, payload });
    finishTask(
        task,
        raw => {
            const result = JSON.parse(raw);
            if (!result?.ok) {
                const detail = result?.error;
                const error = new Error(detail?.message || 'Action failed.');
                error.code = detail?.code;
                throw error;
            }
            if (action.startsWith('dictionary.')) {
                void refreshDictionaries({ announce: false });
            }
        },
        error => reportStatus(
            areas,
            errorText(error),
            { error: true }
        )
    );
}

function perform(action, argument) {
    if (typeof action !== 'string' || !action.trim()) {
        reportStatus(['popup'], 'A Miuix action name is required.', { error: true });
        return;
    }
    const name = action.trim();
    const payload = parseArgument(argument);

    try {
        if (name === 'loadLocalLyrics') {
            void refreshLocalLyrics({ announce: true });
            return;
        }
        if (name === 'deleteLocalLyrics') {
            const songId = typeof payload === 'object' ? payload?.songId : payload;
            if (!songId) throw new Error('Local lyrics songId is required.');
            finishTask(
                deleteLocalLyrics(String(songId)),
                async () => {
                    await refreshLocalLyrics({ announce: false });
                    reportStatus(['localLyrics'], translate('msgLocalLyricsDeleted', 'Local lyrics deleted.'));
                },
                error => reportStatus(
                    ['localLyrics'],
                    errorMessage('msgDeleteError', 'Could not delete local lyrics.', error),
                    { error: true }
                )
            );
            return;
        }
        if (name === 'refreshDictionaries') {
            void refreshDictionaries({ announce: true });
            return;
        }
        if (name === 'refreshCache') {
            void refreshCache({ announce: true });
            return;
        }
        if (name === 'clearCache') {
            const target = String(payload || 'all').toLowerCase();
            if (!CACHE_TARGETS.has(target)) {
                throw new Error('Unknown cache target: ' + target);
            }
            finishTask(
                clearCache(target),
                async result => {
                    if (!result?.success) throw new Error(result?.error || 'Cache clear failed.');
                    await refreshCache({ announce: false });
                    reportStatus(['advanced', 'popup'], translate('msgCacheCleared', 'Cache cleared successfully!'));
                },
                error => reportStatus(
                    ['advanced', 'popup'],
                    errorMessage('msgCacheClearFailed', 'Failed to clear cache.', error),
                    { error: true }
                )
            );
            return;
        }
        if (name === 'exportSettings' || name === MIUIX_ACTIONS.EXPORT_SETTINGS) {
            downloadSettingsExport();
            return;
        }
        if (name === 'importSettings' || name === MIUIX_ACTIONS.IMPORT_SETTINGS) {
            if (payload === '' || payload === null || payload === undefined) chooseSettingsFile();
            else void importSettingsValue(payload);
            return;
        }
        if (name === 'openExternal') {
            openExternal(payload);
            return;
        }
        if (name === 'openSettings') {
            openSettings();
            return;
        }
        if (name === 'reloadAppleMusic' || name === MIUIX_ACTIONS.RELOAD_APPLE_TABS) {
            reloadAppleMusic();
            return;
        }
        if (name.startsWith('dictionary.')) {
            runDictionaryAction(name, payload);
            return;
        }
        if (name === MIUIX_ACTIONS.IMPORT_PLAYER_FONT) {
            chooseFontFile();
            return;
        }
        if (
            name === MIUIX_ACTIONS.REORDER_LYRICS_SOURCES
            || name === MIUIX_ACTIONS.ADD_LYRICS_SOURCE
            || name === MIUIX_ACTIONS.REMOVE_LYRICS_SOURCE
            || name === MIUIX_ACTIONS.REORDER_FALLBACK_LYRICS_SOURCES
            || name === MIUIX_ACTIONS.ADD_FALLBACK_LYRICS_SOURCE
            || name === MIUIX_ACTIONS.REMOVE_FALLBACK_LYRICS_SOURCE
        ) {
            runLyricsSourceAction(name, payload);
            return;
        }
        if (name === MIUIX_ACTIONS.RESET_PLAYER_FONT || name === MIUIX_ACTIONS.DELETE_PLAYER_FONT_ASSET) {
            runFontAction(name, payload);
            return;
        }
        if (
            name === MIUIX_ACTIONS.REQUEST_CUSTOM_LLM_PERMISSION
            || name === MIUIX_ACTIONS.TEST_CUSTOM_LLM
        ) {
            runCustomLLMAction(name, payload);
            return;
        }
        runGenericAction(name, payload);
    } catch (error) {
        reportStatus(
            actionStatusAreas(name),
            errorText(error),
            { error: true }
        );
    }
}

export const miuixHost = Object.freeze({
    subscribe,
    translate,
    setRaw,
    perform,
    readFontBase64
});

export { subscribe, translate, setRaw, perform, readFontBase64 };

globalThis.MiuixHost = miuixHost;

export default miuixHost;
