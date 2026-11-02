import {
    defaultSettings,
    getSettings,
    pickSettings,
    saveSettings,
    updateSettings
} from '../lib/settingsManager.js';
import {
    APPLE_LYRICS_ORDER,
    APPLE_LYRICS_NAMES,
    normalizeAppleLyricsOrder
} from '../lib/appleLyricsSources.js';
import {
    CustomLLMProvider,
    customLLMEndpoint
} from '../background/services/translation/providers/CustomLLMProvider.js';
import {
    deleteImportedFont,
    importPlayerFont
} from '../lib/importedPlayerFont.js';

const APPLE_TAB_QUERY = { url: '*://music.apple.com/*' };
const LEGACY_CACHE_STRATEGIES = new Set(['aggressive', 'moderate']);
const LLM_THINKING_FORMATS = new Set(['auto', 'deepseek', 'openrouter', 'none']);
const LLM_THINKING_EFFORTS = new Set(['low', 'high', 'max']);

const ENUM_SETTINGS = {
    appleMusicDisplayMode: new Set(['none', 'translate', 'romanize', 'both']),
    appleMusicTitleCorrection: new Set(['off', 'original', 'cn', 'jp']),
    largerTextMode: new Set(['lyrics', 'romanization']),
    translationProvider: new Set(['google', 'gemini', 'openrouter', 'customllm', 'deepl', 'deepl-keyless']),
    llmThinkingFormat: LLM_THINKING_FORMATS,
    llmThinkingEffort: LLM_THINKING_EFFORTS,
    romanizationProvider: new Set(['offline', 'google', 'gemini', 'openrouter']),
    transliterationTargetScript: new Set(['latin', 'japanese', 'korean', 'cyrillic', 'devanagari', 'arabic', 'hebrew', 'greek', 'thai'])
};

export const MIUIX_ACTIONS = Object.freeze({
    EXPORT_SETTINGS: 'settings.export',
    IMPORT_SETTINGS: 'settings.import',
    LYRICS_SOURCES_STATE: 'lyricsSources.state',
    REORDER_LYRICS_SOURCES: 'lyricsSources.reorder',
    ADD_LYRICS_SOURCE: 'lyricsSources.add',
    REMOVE_LYRICS_SOURCE: 'lyricsSources.remove',
    IMPORT_PLAYER_FONT: 'playerFont.import',
    RESET_PLAYER_FONT: 'playerFont.reset',
    DELETE_PLAYER_FONT_ASSET: 'playerFont.delete',
    REQUEST_CUSTOM_LLM_PERMISSION: 'customLLM.permission',
    TEST_CUSTOM_LLM: 'customLLM.test',
    QUERY_APPLE_TABS: 'appleMusicTabs.query',
    RELOAD_APPLE_TABS: 'appleMusicTabs.reload'
});

export class MiuixActionError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'MiuixActionError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function normalizeCacheStrategy(value) {
    return value === 'none' ? 'none' : 'bounded';
}

function validFontMetadata(value) {
    return value === null || (
        value && typeof value === 'object' && !Array.isArray(value)
        && typeof value.id === 'string' && value.id.length > 0
        && typeof value.name === 'string'
        && Number.isFinite(value.size)
    );
}

/**
 * Apply the same field filtering as the original settings importer. This is
 * intentionally synchronous because it has no browser side effects.
 */
export function sanitizeImportedSettings(values) {
    const source = values && typeof values === 'object' ? values : {};
    const picked = pickSettings(source);
    const result = {};

    for (const [key, value] of Object.entries(picked)) {
        if (key === 'cacheStrategy') {
            if (value === 'bounded' || value === 'none' || LEGACY_CACHE_STRATEGIES.has(value)) {
                result[key] = normalizeCacheStrategy(value);
            }
            continue;
        }
        if (key === 'llmThinkingEnabled') {
            if (typeof value === 'boolean') result[key] = value;
            continue;
        }
        if (key === 'appleMusicPlayerFontFile') {
            if (validFontMetadata(value)) {
                result[key] = value === null ? null : {
                    id: value.id,
                    name: value.name,
                    size: value.size
                };
            }
            continue;
        }

        const expected = defaultSettings[key];
        if (expected === null || typeof expected === 'object') continue;
        if (typeof value !== typeof expected) continue;
        if (ENUM_SETTINGS[key] && !ENUM_SETTINGS[key].has(value)) continue;
        result[key] = value;
    }

    return result;
}

function parseImportedSettings(value) {
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch (error) {
            throw new MiuixActionError('IMPORT_INVALID_JSON', 'The settings file is not valid JSON.', {
                cause: String(error?.message || error)
            });
        }
    }

    const source = parsed && typeof parsed === 'object'
        && parsed.settings && typeof parsed.settings === 'object'
        ? parsed.settings
        : parsed;
    const settings = sanitizeImportedSettings(source || {});
    if (!Object.keys(settings).length) {
        throw new MiuixActionError('IMPORT_NO_VALID_SETTINGS', 'This file contains no supported Muisc+ settings.');
    }
    return settings;
}

/** Return a bridge-safe settings backup without touching the filesystem. */
export function createSettingsExport(now = new Date()) {
    const settings = pickSettings(getSettings());
    const date = now instanceof Date ? now : new Date(now);
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    return {
        filename: `muiscplus-settings-${safeDate.toISOString().slice(0, 10)}.json`,
        mediaType: 'application/json',
        content: JSON.stringify(settings, null, 2)
    };
}

/** Parse, sanitize, persist and return an imported settings backup. */
export async function importSettingsJSON(value) {
    const settings = parseImportedSettings(value);
    updateSettings(settings);
    try {
        await saveSettings();
    } catch (error) {
        throw new MiuixActionError('SETTINGS_SAVE_FAILED', 'Could not save imported settings.', {
            cause: String(error?.message || error)
        });
    }
    return {
        importedKeys: Object.keys(settings),
        settings: pickSettings(getSettings()),
        reloadRequired: true
    };
}

function normalizeProviderInput(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)
        && Object.hasOwn(value, 'order')) {
        return value.order;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)
        && Object.hasOwn(value, 'appleMusicLyricsProviderOrder')) {
        return value.appleMusicLyricsProviderOrder;
    }
    return value;
}

export function normalizeLyricsProviderOrder(value = getSettings().appleMusicLyricsProviderOrder) {
    return normalizeAppleLyricsOrder(normalizeProviderInput(value));
}

/** Return the current order plus the sources available for add/remove controls. */
export function getLyricsSourceState(value = getSettings().appleMusicLyricsProviderOrder) {
    const order = normalizeLyricsProviderOrder(value);
    return {
        order,
        sources: order.map((id, index) => ({
            id,
            name: APPLE_LYRICS_NAMES[id] || id,
            position: index,
            pinned: id === 'applemusic'
        })),
        available: APPLE_LYRICS_ORDER
            .filter(id => !order.includes(id))
            .map(id => ({ id, name: APPLE_LYRICS_NAMES[id] || id })),
        value: order.join(',')
    };
}

async function persistLyricsSourceOrder(value) {
    const state = getLyricsSourceState(value);
    updateSettings({ appleMusicLyricsProviderOrder: state.value });
    try {
        await saveSettings();
    } catch (error) {
        throw new MiuixActionError('LYRICS_SOURCE_SAVE_FAILED', 'Could not save the lyrics source order.', {
            cause: String(error?.message || error)
        });
    }
    return state;
}

export function setLyricsProviderOrder(value) {
    return persistLyricsSourceOrder(value);
}

export async function addLyricsProvider(provider) {
    if (provider === 'applemusic') return getLyricsSourceState();
    if (!APPLE_LYRICS_ORDER.includes(provider)) {
        throw new MiuixActionError('LYRICS_SOURCE_UNKNOWN', 'Unknown lyrics source.', { provider });
    }
    const current = normalizeAppleLyricsOrder(getSettings().appleMusicLyricsProviderOrder);
    if (current.includes(provider)) return getLyricsSourceState(current);
    return persistLyricsSourceOrder([
        ...current.filter(item => item !== 'applemusic'),
        provider,
        'applemusic'
    ]);
}

export async function removeLyricsProvider(provider) {
    if (provider === 'applemusic') return getLyricsSourceState();
    if (!APPLE_LYRICS_ORDER.includes(provider)) {
        throw new MiuixActionError('LYRICS_SOURCE_UNKNOWN', 'Unknown lyrics source.', { provider });
    }
    const next = normalizeAppleLyricsOrder(getSettings().appleMusicLyricsProviderOrder)
        .filter(item => item !== provider && item !== 'applemusic');
    next.push('applemusic');
    return persistLyricsSourceOrder(next);
}

async function deleteFontQuietly(fontId) {
    if (!fontId) return null;
    try {
        await deleteImportedFont(fontId);
        return null;
    } catch (error) {
        return String(error?.message || error);
    }
}

/** Delete one imported font record from IndexedDB without changing settings. */
export async function deletePlayerFontAsset(fontId) {
    if (!fontId || typeof fontId !== 'string') {
        throw new MiuixActionError('FONT_ID_REQUIRED', 'A font record ID is required.');
    }
    try {
        await deleteImportedFont(fontId);
        return { deletedFontId: fontId };
    } catch (error) {
        throw new MiuixActionError('FONT_DELETE_FAILED', 'Could not delete the imported font.', {
            cause: String(error?.message || error)
        });
    }
}

/**
 * Import a File/Blob from the caller's file-picker bridge. The previous font
 * remains active until decoding and IndexedDB storage both succeed.
 */
export async function importPlayerFontAsset(file) {
    if (!file) throw new MiuixActionError('FONT_FILE_REQUIRED', 'Choose a font file to import.');
    const previous = {
        appleMusicPlayerFont: getSettings().appleMusicPlayerFont,
        appleMusicPlayerFontFile: getSettings().appleMusicPlayerFontFile
    };
    let imported = null;

    try {
        imported = await importPlayerFont(file);
        updateSettings({
            appleMusicPlayerFont: '',
            appleMusicPlayerFontFile: imported
        });
        await saveSettings();
    } catch (error) {
        if (imported) {
            updateSettings(previous);
            try {
                await saveSettings();
            } catch {}
            await deleteFontQuietly(imported.id);
        }
        const rawMessage = String(error?.message || error);
        const code = rawMessage === 'FONT_FORMAT'
            ? 'FONT_FORMAT'
            : rawMessage === 'FONT_SIZE'
                ? 'FONT_SIZE'
                : 'FONT_IMPORT_FAILED';
        throw new MiuixActionError(code, 'Unable to import this font.', { cause: rawMessage });
    }

    const cleanupWarning = await deleteFontQuietly(previous.appleMusicPlayerFontFile?.id);
    return {
        font: imported,
        previousFontId: previous.appleMusicPlayerFontFile?.id || null,
        cleanupWarning
    };
}

/** Restore the default font and remove its stored binary when possible. */
export async function resetPlayerFont() {
    const previous = {
        appleMusicPlayerFont: getSettings().appleMusicPlayerFont,
        appleMusicPlayerFontFile: getSettings().appleMusicPlayerFontFile
    };
    updateSettings({ appleMusicPlayerFont: '', appleMusicPlayerFontFile: null });
    try {
        await saveSettings();
    } catch (error) {
        updateSettings(previous);
        throw new MiuixActionError('SETTINGS_SAVE_FAILED', 'Could not restore the default font.', {
            cause: String(error?.message || error)
        });
    }

    const removedFontId = previous.appleMusicPlayerFontFile?.id || null;
    return {
        font: null,
        removedFontId,
        cleanupWarning: await deleteFontQuietly(removedFontId)
    };
}

function runtimeErrorMessage() {
    return globalThis.chrome?.runtime?.lastError?.message || '';
}

function normalizeLLMTestValues(input = {}) {
    const current = getSettings();
    const trim = value => String(value ?? '').trim();
    const thinkingFormat = input.llmThinkingFormat ?? current.llmThinkingFormat ?? 'auto';
    const thinkingEffort = input.llmThinkingEffort ?? current.llmThinkingEffort ?? 'high';
    return {
        customLLMBaseUrl: trim(input.customLLMBaseUrl ?? current.customLLMBaseUrl),
        customLLMApiKey: trim(input.customLLMApiKey ?? current.customLLMApiKey),
        customLLMModel: trim(input.customLLMModel ?? current.customLLMModel),
        llmThinkingFormat: LLM_THINKING_FORMATS.has(thinkingFormat) ? thinkingFormat : 'auto',
        llmThinkingEnabled: typeof input.llmThinkingEnabled === 'boolean'
            ? input.llmThinkingEnabled
            : current.llmThinkingEnabled === true,
        llmThinkingEffort: LLM_THINKING_EFFORTS.has(thinkingEffort) ? thinkingEffort : 'high'
    };
}

function llmEndpointForValues(values) {
    try {
        return customLLMEndpoint(values.customLLMBaseUrl);
    } catch (error) {
        throw new MiuixActionError('INVALID_LLM_ENDPOINT', String(error?.message || error));
    }
}

/** Must be called directly from a user gesture in the page. */
function requestOriginPermission(originPattern) {
    const browserPermissions = globalThis.browser?.permissions;
    if (browserPermissions?.request) {
        return browserPermissions.request({ origins: [originPattern] });
    }

    const chromePermissions = globalThis.chrome?.permissions;
    if (!chromePermissions?.request) {
        return Promise.reject(new MiuixActionError(
            'PERMISSIONS_UNAVAILABLE',
            'This connection test requires the extension context.'
        ));
    }

    return new Promise((resolve, reject) => {
        chromePermissions.request({ origins: [originPattern] }, granted => {
            const message = runtimeErrorMessage();
            if (message) {
                reject(new MiuixActionError('PERMISSION_REQUEST_FAILED', message));
                return;
            }
            resolve(granted === true);
        });
    });
}

/**
 * Request the optional host permission. Call this only from a user gesture.
 * The Chrome callback API is invoked synchronously before returning the Promise.
 */
export function requestCustomLLMPermission(input = {}) {
    const values = normalizeLLMTestValues(input);
    const endpoint = llmEndpointForValues(values);
    return requestOriginPermission(`${endpoint.origin}/*`).then(granted => ({
        granted,
        origin: endpoint.origin
    }));
}

/** Persist the entered LLM values, request host access, then run a one-line test. */
export async function testCustomLLMConnection(input = {}) {
    const values = normalizeLLMTestValues(input);
    const endpoint = llmEndpointForValues(values);
    if (!values.customLLMModel) {
        throw new MiuixActionError('LLM_MODEL_REQUIRED', 'Enter a model name.');
    }

    updateSettings(values);

    // Keep both browser API calls inside the original user-activation task.
    const permissionTask = requestOriginPermission(`${endpoint.origin}/*`);
    const saveTask = saveSettings();
    const [permission, saved] = await Promise.allSettled([permissionTask, saveTask]);

    if (saved.status === 'rejected') {
        throw new MiuixActionError('SETTINGS_SAVE_FAILED', 'Could not save the LLM configuration.', {
            cause: String(saved.reason?.message || saved.reason)
        });
    }
    if (permission.status === 'rejected') throw permission.reason;
    if (!permission.value) {
        throw new MiuixActionError('LLM_PERMISSION_DENIED', 'Permission for this API address was not granted.');
    }

    try {
        const result = await new CustomLLMProvider(values).translate(['Hello, world.'], 'zh-CN');
        return {
            endpoint: endpoint.href,
            origin: endpoint.origin,
            translatedText: result[0]
        };
    } catch (error) {
        throw new MiuixActionError('LLM_CONNECTION_FAILED', String(error?.message || error));
    }
}

function serializeTabs(tabs) {
    if (!Array.isArray(tabs)) return [];
    return tabs
        .filter(tab => tab?.id != null)
        .map(tab => ({
            id: tab.id,
            title: typeof tab.title === 'string' ? tab.title : '',
            active: tab.active === true
        }));
}

/** Query Apple Music tabs through the Firefox Promise or Chrome callback API. */
export async function queryAppleMusicTabs() {
    const browserTabs = globalThis.browser?.tabs;
    if (browserTabs?.query) {
        try {
            return serializeTabs(await browserTabs.query(APPLE_TAB_QUERY));
        } catch {
            return [];
        }
    }

    const chromeTabs = globalThis.chrome?.tabs;
    if (!chromeTabs?.query) return [];
    return new Promise(resolve => {
        try {
            chromeTabs.query(APPLE_TAB_QUERY, tabs => {
                const message = runtimeErrorMessage();
                resolve(message ? [] : serializeTabs(tabs));
            });
        } catch {
            resolve([]);
        }
    });
}

function reloadTab(tabId) {
    const browserTabs = globalThis.browser?.tabs;
    if (browserTabs?.reload) return browserTabs.reload(tabId);

    const chromeTabs = globalThis.chrome?.tabs;
    if (!chromeTabs?.reload) return Promise.reject(new Error('Tabs API unavailable'));
    return new Promise((resolve, reject) => {
        try {
            chromeTabs.reload(tabId, () => {
                const message = runtimeErrorMessage();
                if (message) reject(new Error(message));
                else resolve();
            });
        } catch (error) {
            reject(error);
        }
    });
}

/** Reload every currently open Apple Music tab and report per-tab failures. */
export async function reloadAppleMusicTabs() {
    const tabs = await queryAppleMusicTabs();
    const failures = [];
    let reloaded = 0;
    for (const tab of tabs) {
        try {
            await reloadTab(tab.id);
            reloaded++;
        } catch (error) {
            failures.push({ id: tab.id, error: String(error?.message || error) });
        }
    }
    return { total: tabs.length, reloaded, failures };
}

const ACTION_HANDLERS = {
    [MIUIX_ACTIONS.EXPORT_SETTINGS]: () => createSettingsExport(),
    [MIUIX_ACTIONS.IMPORT_SETTINGS]: payload => {
        const value = payload && typeof payload === 'object' && Object.hasOwn(payload, 'json')
            ? payload.json
            : payload;
        return importSettingsJSON(value);
    },
    [MIUIX_ACTIONS.LYRICS_SOURCES_STATE]: payload => getLyricsSourceState(payload),
    [MIUIX_ACTIONS.REORDER_LYRICS_SOURCES]: payload => {
        const value = payload && typeof payload === 'object' && Object.hasOwn(payload, 'order')
            ? payload.order
            : payload;
        return setLyricsProviderOrder(value);
    },
    [MIUIX_ACTIONS.ADD_LYRICS_SOURCE]: payload => addLyricsProvider(
        typeof payload === 'string' ? payload : payload?.provider
    ),
    [MIUIX_ACTIONS.REMOVE_LYRICS_SOURCE]: payload => removeLyricsProvider(
        typeof payload === 'string' ? payload : payload?.provider
    ),
    [MIUIX_ACTIONS.IMPORT_PLAYER_FONT]: payload => importPlayerFontAsset(
        payload?.file || payload
    ),
    [MIUIX_ACTIONS.RESET_PLAYER_FONT]: () => resetPlayerFont(),
    [MIUIX_ACTIONS.DELETE_PLAYER_FONT_ASSET]: payload => deletePlayerFontAsset(
        typeof payload === 'string' ? payload : payload?.fontId
    ),
    [MIUIX_ACTIONS.REQUEST_CUSTOM_LLM_PERMISSION]: payload => requestCustomLLMPermission(payload || {}),
    [MIUIX_ACTIONS.TEST_CUSTOM_LLM]: payload => testCustomLLMConnection(payload || {}),
    [MIUIX_ACTIONS.QUERY_APPLE_TABS]: () => queryAppleMusicTabs(),
    [MIUIX_ACTIONS.RELOAD_APPLE_TABS]: () => reloadAppleMusicTabs()
};

function actionError(error) {
    const isKnown = error instanceof MiuixActionError;
    return {
        ok: false,
        error: {
            code: isKnown ? error.code : 'INTERNAL_ERROR',
            message: String(error?.message || error || 'Unknown error'),
            ...(isKnown && error.details !== undefined ? { details: error.details } : {})
        }
    };
}

function parseActionRequest(input) {
    let request = input;
    if (typeof input === 'string') {
        try {
            request = JSON.parse(input);
        } catch (error) {
            throw new MiuixActionError('INVALID_ACTION_JSON', 'The action request is not valid JSON.', {
                cause: String(error?.message || error)
            });
        }
    }
    if (!request || typeof request !== 'object') {
        throw new MiuixActionError('INVALID_ACTION', 'The action request must be an object.');
    }
    return {
        type: request.type || request.action,
        payload: request.payload
    };
}

/**
 * Single JSON endpoint for a Wasm/JS bridge. It always resolves to JSON and
 * never exposes a rejected Promise to the renderer.
 */
export function performMiuixAction(input) {
    let action;
    try {
        action = parseActionRequest(input);
        const handler = ACTION_HANDLERS[action.type];
        if (!handler) {
            throw new MiuixActionError('UNKNOWN_ACTION', 'Unknown Miuix action.', { type: action.type });
        }
        action = Promise.resolve(handler(action.payload));
    } catch (error) {
        return Promise.resolve(JSON.stringify(actionError(error)));
    }

    return action.then(
        data => JSON.stringify({ ok: true, data }),
        error => JSON.stringify(actionError(error))
    );
}
