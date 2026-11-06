// Apple Music content-script adapter. AMLL renders in a separate extension document.
let currentSongInfo = {};
let amllPlayer = null;
let amllHost = null;
let amllLayers = null;
let presentationRevision = 0;
let presentation = null;
let playerExpanded = false;
let frameReady = false;
let activeArtwork = null;
let nativeMode = false;
let trackerInjected = false;
let platformStarted = false;
let mountQueued = false;
let cachedLyricsArguments = null;
let cachedPlaybackState = null;
let cachedLyricStatus = 'loading';
let cachedProviders = [];
let cachedOffset = 0;
let manualLyricsProvider = null;
let pendingLyricsProviderSwitch = null;
let commandSequence = 0;
let libraryRefreshTimer;
const handledLibraryChanges = { local: 0, cache: 0 };
const pendingCommands = new Map();
const TITLE_FIX_TTL = 6 * 60 * 60 * 1000;
const TITLE_FIX_MISS_TTL = 30 * 60 * 1000;
const TITLE_FIX_MEMORY_LIMIT = 80;
const TITLE_FIX_BUCKET_LIMIT = 150;
// Bump when the original-region pick rule changes so cached picks are dropped.
const TITLE_FIX_RULE = 7;
const titleFixMemory = new Map();
let titleFix = null;
let titleFixRequest = 0;
const songIdentity = (song) => song?.appleId || `${song?.title || ''}-${song?.artist || ''}-${song?.album || ''}`;

function getAppleMusicLyricsLanguage() {
    const target = currentSettings.customTranslateTarget;
    for (const value of [target && target !== 'auto' ? target : '', navigator.language, document.documentElement.lang, 'en-US']) {
        if (!value) continue;
        try {
            const locale = new Intl.Locale(value.replaceAll('_', '-'));
            // Match AMDL's explicit simplified/traditional Chinese language tags.
            return locale.language === 'zh' ? locale.maximize().toString() : locale.toString();
        } catch (_) { }
    }
    return 'en-US';
}

function rememberTitleFix(key, entry) {
    titleFixMemory.set(key, entry);
    if (titleFixMemory.size > TITLE_FIX_MEMORY_LIMIT) titleFixMemory.delete(titleFixMemory.keys().next().value);
}

function titleFixStorageKey(mode) {
    return 'lyplusAppleTitleFix:' + mode;
}

function frameSongInfo(song) {
    if (!titleFix || !song || String(song.appleId) !== String(titleFix.appleId)) return song;
    return {
        ...song,
        title: titleFix.name || song.title,
        artist: titleFix.artistName || song.artist,
        album: titleFix.albumName || song.album,
    };
}

function applyTitleFix() {
    amllPlayer?.updateSong(frameSongInfo(currentSongInfo));
    if (cachedLyricsArguments) cachedLyricsArguments[1] = frameSongInfo(cachedLyricsArguments[1]);
}

// Restore the page-provided metadata as soon as the correction stops applying.
function clearTitleFix() {
    if (!titleFix) return;
    titleFix = null;
    applyTitleFix();
}

async function readStoredTitleFix(mode, appleId) {
    if (!pBrowser?.storage?.local) return undefined;
    const key = titleFixStorageKey(mode);
    try {
        const bucket = (await storageLocalGet({ [key]: null }))?.[key];
        const entry = bucket?.[appleId];
        if (entry?.value && entry.rule === TITLE_FIX_RULE && entry.expires > Date.now()) return entry.value;
    } catch (_) { }
    return undefined;
}

function storeTitleFix(mode, appleId, value) {
    if (!value || !pBrowser?.storage?.local) return;
    const key = titleFixStorageKey(mode);
    const now = Date.now();
    (async () => {
        let bucket = {};
        try { bucket = (await storageLocalGet({ [key]: null }))?.[key] || {}; } catch (_) { }
        const entries = Object.entries(bucket).filter(entry => entry[1]?.expires > now && entry[1]?.rule === TITLE_FIX_RULE);
        entries.push([appleId, { value, rule: TITLE_FIX_RULE, expires: now + TITLE_FIX_TTL }]);
        entries.sort((first, second) => first[1].expires - second[1].expires);
        try { await storageLocalSet({ [key]: Object.fromEntries(entries.slice(-TITLE_FIX_BUCKET_LIMIT)) }); } catch (_) { }
    })();
}

// Title correction feeds only the AMLL player: the page keeps its own metadata.
async function refreshTitleFix() {
    const request = ++titleFixRequest;
    const mode = currentSettings.appleMusicTitleCorrection;
    if (!currentSettings.isEnabled || !mode || mode === 'off' || !amllHost?.isConnected || nativeMode) { clearTitleFix(); return; }
    const song = currentSongInfo;
    if (!song?.appleId || song.isVideo) { clearTitleFix(); return; }
    const appleId = String(song.appleId);
    const key = mode + ':' + appleId;
    let entry = titleFixMemory.get(key);
    if (entry && entry.expires <= Date.now()) entry = undefined;
    if (!entry) {
        const stored = await readStoredTitleFix(mode, appleId);
        if (request !== titleFixRequest) return;
        entry = typeof stored === 'undefined' ? undefined : { value: stored, expires: Date.now() + TITLE_FIX_TTL };
        if (entry) rememberTitleFix(key, entry);
    }
    let value = entry ? entry.value : undefined;
    if (value === undefined) {
        let failed = false;
        try { value = await sendPlayerCommand('catalogMetadata', { appleId, mode }); } catch (_) { failed = true; }
        if (request !== titleFixRequest) return;
        // A failed request proves nothing about the song: keep the current display and retry later.
        if (failed) { if (titleFix && titleFix.mode !== mode) clearTitleFix(); return; }
        rememberTitleFix(key, { value: value || null, expires: Date.now() + (value ? TITLE_FIX_TTL : TITLE_FIX_MISS_TTL) });
        if (value) storeTitleFix(mode, appleId, value);
    }
    if (request !== titleFixRequest) return;
    if (!value) { clearTitleFix(); return; }
    if (!amllHost?.isConnected || nativeMode || songIdentity(currentSongInfo) !== songIdentity(song)) return;
    titleFix = { mode, appleId, name: value.name || '', artistName: value.artistName || '', albumName: value.albumName || '' };
    applyTitleFix();
}

function injectDOMScript() {
    if (trackerInjected || !pBrowser?.runtime?.getURL) return;
    trackerInjected = true;
    const script = document.createElement('script');
    script.dataset.lyricsLanguage = getAppleMusicLyricsLanguage();
    script.src = pBrowser.runtime.getURL('src/inject/applemusic/songTracker.js');
    script.onload = () => script.remove();
    script.onerror = () => { trackerInjected = false; script.remove(); console.warn('YouLy+: Apple Music bridge could not load'); };
    (document.head || document.documentElement).appendChild(script);
}

function loadPlatformStyle(path, attribute) {
    let link = document.querySelector(`link[${attribute}]`);
    if (link?.sheet) return Promise.resolve();
    if (link?._lyplusLoading) return link._lyplusLoading;
    if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = pBrowser.runtime.getURL(path);
        link.setAttribute(attribute, 'true');
    }
    link._lyplusLoading = new Promise((resolve, reject) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', () => { link.remove(); reject(new Error('Player stylesheet could not load')); }, { once: true });
    });
    if (!link.isConnected) (document.head || document.documentElement).appendChild(link);
    return link._lyplusLoading;
}

function injectPlatformCSS() {
    return loadPlatformStyle('src/modules/applemusic/style.css', 'data-lyrics-plus-platform-style');
}

function sendPlayerCommand(command, value) {
    return new Promise((resolve, reject) => {
        const requestId = `lyplus-${Date.now()}-${++commandSequence}`;
        const timer = setTimeout(() => { pendingCommands.delete(requestId); reject(new Error('Apple Music did not respond. Try the native player.')); }, ['nativeTTML', 'lyricsLanguage'].includes(command) ? 16000 : ['queuePlay', 'favorite', 'favoriteState'].includes(command) ? 12000 : command === 'catalogMetadata' ? 10000 : 6000);
        pendingCommands.set(requestId, { resolve, reject, timer });
        window.postMessage({ type: 'LYPLUS_PLAYER_COMMAND', command, value, requestId }, window.location.origin);
    });
}

const applePlayerBar = '[data-testid="player-bar"]';
const appleMiniArtwork = '[data-testid="now-playing-artwork-button"], [data-testid="player-lcd-artwork"]';
const appleLyricsModal = 'article[data-testid="lyrics-fullscreen-modal"]';

function nativeBarCandidate() {
    if (!currentSettings.isEnabled || currentSettings.appleMusicAMLL === false || !currentSongInfo.appleId
        || !currentSongInfo.title || document.querySelector(appleLyricsModal)) return null;
    let usable = null;
    for (const bar of document.querySelectorAll(applePlayerBar)) {
        if (!bar.isConnected || bar.closest(appleLyricsModal)) continue;
        const rect = bar.getBoundingClientRect();
        const style = getComputedStyle(bar);
        if (rect.width < 120 || rect.height < 32 || style.visibility !== 'visible' || style.opacity === '0'
            || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) continue;
        if (!usable) usable = bar;
    }
    return usable;
}

function measuredCapsule(bar) {
    const root = bar.getBoundingClientRect();
    const nodes = [bar];
    let best = null;
    for (let i = 0; i < nodes.length && i < 300; i++) {
        const element = nodes[i];
        nodes.push(...(element.shadowRoot?.children || []), ...element.children);
        const rect = element.getBoundingClientRect();
        if (rect.width < 320 || rect.height < 40 || rect.height > 88 || rect.width > root.width + 1
            || rect.left < root.left - 1 || rect.right > root.right + 1 || rect.top < root.top - 1 || rect.bottom > root.bottom + 1) continue;
        const style = getComputedStyle(element);
        if (style.visibility !== 'visible' || style.opacity === '0') continue;
        const radius = parseFloat(style.borderTopLeftRadius) || 0;
        const background = style.backgroundColor;
        const tinted = background && background !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(background);
        const material = (style.backdropFilter && style.backdropFilter !== 'none') || style.boxShadow !== 'none';
        if (radius < 8 || (!tinted && !material)) continue;
        const score = rect.width * rect.height + radius * 1000;
        if (!best || score > best.score) best = { element, score };
    }
    return best?.element;
}

function readPresentationOrigin(bar, artwork) {
    if (!bar?.isConnected || bar.closest(appleLyricsModal)) return null;
    const measured = measuredCapsule(bar);
    const rect = (measured || bar).getBoundingClientRect();
    const preferred = artwork?.closest(appleMiniArtwork);
    const button = preferred && bar.contains(preferred) ? preferred : bar.querySelector(appleMiniArtwork);
    const cover = button?.getBoundingClientRect();
    // If the bar only gives us a large wrapper, anchor to the actual artwork button.
    const anchor = measured || (rect.width > 0 && rect.width <= 900 && rect.height > 0 && rect.height <= 88)
        ? rect : cover;
    if (!anchor || anchor.width <= 0 || anchor.height <= 0 || anchor.top >= innerHeight || anchor.bottom <= 0) return null;
    const radiusStyle = measured ? getComputedStyle(measured).borderTopLeftRadius : '';
    const radius = radiusStyle.endsWith('%') ? parseFloat(radiusStyle) * rect.height / 100 : parseFloat(radiusStyle);
    return { left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height,
        radius: radius || rect.height / 2, capsule: Boolean(measured), cover };
}

function applyPresentation() {
    if (!amllHost) return;
    const shown = presentation ? presentation.shown : playerExpanded;
    const interactive = shown && !presentation;
    amllHost.toggleAttribute('data-shown', shown);
    amllHost.toggleAttribute('data-interactive', interactive);
    amllHost.toggleAttribute('inert', !shown);
    amllLayers.frame.tabIndex = interactive ? 0 : -1;
    if (shown) {
        amllHost.removeAttribute('aria-hidden');
    } else {
        amllHost.setAttribute('aria-hidden', 'true');
    }
}

function watchPresentation(run) {
    clearTimeout(run.timer);
    const preparing = run.phase === 'preparing';
    run.timer = setTimeout(() => {
        if (presentation !== run || document.hidden) return;
        if (preparing) commitPresentation(run, true);
        else showNativePlayer();
    }, preparing ? 350 : 2500);
}

function clearPresentation() {
    const run = presentation;
    presentation = null;
    if (!run) return;
    clearTimeout(run.timer);
    run.motion?.dispose();
}

function unmountAMLL() {
    clearPresentation();
    amllPlayer?.dispose();
    amllPlayer = null;
    amllHost?.remove();
    amllHost = null;
    amllLayers = null;
    playerExpanded = false;
    frameReady = false;
    activeArtwork = null;
}

function showNativePlayer() {
    nativeMode = true;
    unmountAMLL();
}

function startPresentation(expanded, bar, artwork) {
    if (!amllHost?.isConnected || !amllPlayer || !frameReady || nativeMode || presentation || expanded === playerExpanded) return false;
    const revision = ++presentationRevision;
    const animate = Boolean(globalThis.LyPlusAMLLPresentation?.create && !document.hidden
        && !currentSettings.lightweight && !matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (expanded && cachedPlaybackState) amllPlayer.updatePlayback(cachedPlaybackState);
    const sent = animate ? amllPlayer.preparePresentation(expanded, revision) : amllPlayer.settlePresentation(expanded, revision);
    if (!sent) return false;
    const run = presentation = {
        revision, expanded, bar, artwork, shown: playerExpanded, phase: animate ? 'preparing' : 'settling',
        restoreFocus: document.activeElement === amllLayers.frame, pass: 0,
    };
    applyPresentation();
    watchPresentation(run);
    return true;
}

function commitPresentation(run, cut = false) {
    if (!run || presentation !== run) return;
    if (cut && run.motion) {
        // Cancelling the slide leaves the frame at its expanded pose. Only
        // hide it when closing, so an interrupted opening cannot expose the page.
        if (!run.expanded) {
            run.shown = false;
            applyPresentation();
        }
        run.motion.dispose();
        run.motion = null;
    }
    if (run.phase === 'settling') return;
    run.phase = 'settling';
    if (amllPlayer?.settlePresentation(run.expanded, run.revision)) watchPresentation(run);
    else showNativePlayer();
}

function presentationBackground(bar) {
    const content = document.querySelector('[data-testid="app-container"] #scrollable-page');
    if (!content || content.contains(bar)
        || content.querySelector(`${applePlayerBar}, ${appleLyricsModal}, dialog[open], [aria-modal="true"]`)) return null;
    const rect = content.getBoundingClientRect();
    const style = getComputedStyle(content);
    return rect.width >= innerWidth * .5 && rect.height >= innerHeight * .5
        && [style.transform, style.scale, style.rotate, style.translate].every(value => !value || value === 'none') ? content : null;
}

function presentationPrepared(revision, cover) {
    const run = presentation;
    if (run?.revision !== revision || run.phase !== 'preparing') return;
    if (document.hidden) {
        commitPresentation(run);
        return;
    }
    const origin = readPresentationOrigin(run.bar, run.artwork);
    run.motion = globalThis.LyPlusAMLLPresentation.create({
        stage: amllHost, ...amllLayers, origin, cover, expanded: playerExpanded,
        background: origin ? presentationBackground(run.bar) : null,
    });
    if (!run.motion) { commitPresentation(run); return; }
    playPresentation(run, run.expanded);
}

function playPresentation(run, expanded) {
    const animations = run.motion.animations;
    const primary = animations[0];
    const time = Number(primary.currentTime) || 0;
    const rate = expanded === playerExpanded ? -1 : 1;
    const pass = ++run.pass;
    run.expanded = expanded;
    if (rate === -1 && time <= 0) { commitPresentation(run); return; }
    const firstReveal = !run.shown;
    run.phase = 'moving';
    run.shown = true;
    applyPresentation();
    watchPresentation(run);
    if (firstReveal) amllLayers.frame.focus({ preventScroll: true });
    try {
        // Share a single timeline instant. Reversing uses the position already
        // on screen, without asking the child to lay out or start a new motion.
        const now = document.timeline.currentTime;
        for (const animation of animations) {
            animation.playbackRate = rate;
            animation.currentTime = time;
            if (Number.isFinite(now)) animation.startTime = now - time / rate;
            else animation.play();
        }
        primary.finished.then(() => {
            if (run.phase === 'moving' && run.pass === pass) commitPresentation(run);
        }, () => {});
    } catch (_) {
        commitPresentation(run, true);
    }
}

function presentationSettled(expanded, revision) {
    const run = presentation;
    if (run?.revision !== revision || run.phase !== 'settling' || run.expanded !== expanded) return;
    const focusedInside = run.restoreFocus || document.activeElement === amllLayers.frame;
    playerExpanded = expanded;
    clearPresentation();
    applyPresentation();
    if (expanded) {
        if (!focusedInside) amllLayers.frame.focus({ preventScroll: true });
        return;
    }
    const reopenBar = run.reopen && !document.hidden ? nativeBarCandidate() : null;
    const artwork = activeArtwork?.isConnected ? activeArtwork
        : (reopenBar || (focusedInside ? nativeBarCandidate() : null))?.querySelector(appleMiniArtwork);
    activeArtwork = null;
    if (reopenBar && startPresentation(true, reopenBar, artwork)) {
        activeArtwork = artwork;
        return;
    }
    if (focusedInside) artwork?.focus({ preventScroll: true });
}

function closePlayer() {
    const run = presentation;
    if (run) {
        if (!run.expanded) { run.reopen = false; return; }
        if (run.phase === 'settling') return;
        if (run.phase === 'moving') playPresentation(run, false);
        else { run.expanded = false; commitPresentation(run, true); }
        return;
    }
    if (!playerExpanded) return;
    startPresentation(false, nativeBarCandidate(), activeArtwork);
}

function closeOnEscape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || (!presentation && !playerExpanded)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closePlayer();
}

function interceptMiniArtwork(event) {
    if (!event.isTrusted || event.defaultPrevented || event.type !== 'click' || event.button !== 0
        || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (nativeMode || !frameReady || !amllHost?.isConnected || !amllPlayer || document.querySelector(appleLyricsModal)) return;
    const run = presentation;
    const closingAtEnd = run?.phase === 'settling' && !run.expanded;
    if ((closingAtEnd || (run?.phase === 'moving' && !run.expanded)) && amllHost.contains(event.target)
        && run.motion?.hitsCover(event.clientX, event.clientY)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (closingAtEnd) run.reopen = true;
        else playPresentation(run, true);
        return;
    }
    if (playerExpanded && !closingAtEnd) return;
    const path = event.composedPath();
    const artwork = path.find(node => node instanceof Element && node.matches(appleMiniArtwork)
        && node.closest(applePlayerBar) && !node.closest(appleLyricsModal));
    if (!artwork) return;
    const bar = artwork.closest(applePlayerBar);
    if (closingAtEnd) {
        run.reopen = true;
    } else if (!run) {
        if (!startPresentation(true, bar, artwork)) return;
        activeArtwork = path.find(node => node instanceof HTMLElement && node.matches('button, [role="button"]')
            && node.closest(applePlayerBar) === bar) || artwork;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
}

async function updateLocalTTML(appleId, lyrics, remove = false) {
    if (!appleId || String(currentSongInfo.appleId) !== String(appleId)) throw new Error('localTTMLSongChanged');
    if (!remove && (!Array.isArray(lyrics?.data) || !lyrics.data.some(line => typeof line.text === 'string' && line.text.trim()))) throw new Error('importTTMLInvalid');
    // The frame may show corrected titles. Storage always uses the original song.
    const song = { ...currentSongInfo };
    const response = await pBrowser.runtime.sendMessage(remove
        ? { type: 'DELETE_LOCAL_LYRICS', songInfo: song }
        : { type: 'UPLOAD_LOCAL_LYRICS', songInfo: song, jsonLyrics: lyrics });
    if (!response?.success) throw new Error(response?.error || 'Local lyrics could not be saved');
    if (songIdentity(currentSongInfo) !== songIdentity(song)) return;
    scheduleLibraryRefresh(response.localLyricsChange);
}

function mountAMLL() {
    const modal = document.querySelector(appleLyricsModal);
    // Apple's own lyrics modal owns the fullscreen view. Keep its native UI
    // intact and leave the compact extension frame out of the way.
    if (modal) { if (amllHost?.isConnected) unmountAMLL(); return; }
    if (!currentSettings.isEnabled || currentSettings.appleMusicAMLL === false || nativeMode) {
        if (amllHost) unmountAMLL();
        return;
    }
    if (amllHost?.isConnected && amllPlayer && amllHost.parentNode === document.body) return;
    const bar = nativeBarCandidate();
    if (!bar) { if (amllHost) unmountAMLL(); return; }
    if (amllPlayer) unmountAMLL();
    if (!globalThis.LyPlusAMLLFrame?.createPlayer) { console.warn('YouLy+: AMLL frame bridge is unavailable'); return; }
    const host = document.createElement('div');
    const plane = document.createElement('div');
    const scrim = document.createElement('div');
    const frame = document.createElement('iframe');
    host.id = 'lyplus-amll-scene';
    plane.className = 'lyplus-amll-plane';
    scrim.className = 'lyplus-amll-scrim';
    frame.id = 'lyplus-amll-root';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Muisc+ player');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('inert', '');
    frame.tabIndex = -1;
    host.hidden = true;
    plane.append(scrim, frame);
    host.append(plane);
    document.body.appendChild(host);
    amllHost = host;
    amllLayers = { plane, scrim, frame };
    playerExpanded = false;
    frameReady = false;
    applyPresentation();
    const stylesReady = injectPlatformCSS();
    try {
        amllPlayer = globalThis.LyPlusAMLLFrame.createPlayer(frame, {
            sendCommand: sendPlayerCommand, onClose: closePlayer, onFallback: showNativePlayer,
            onPresentationPrepared: presentationPrepared,
            onPresentationInvalidated: revision => {
                if (presentation?.revision === revision) commitPresentation(presentation, true);
            },
            onPresentationSettled: presentationSettled,
            getInitialSong: () => frameSongInfo(currentSongInfo),
            getInitialPlayback: () => cachedPlaybackState,
            translate: (key) => typeof t === 'function' ? t(key) : '',
            getLanguage: getUserLanguage,
            settings: currentSettings,
            onSettingsChange: (values) => storageLocalSet(values),
            saveOffset: (song, value) => {
                cachedOffset = Number(value) || 0;
                if (cachedLyricsArguments) cachedLyricsArguments[11] = cachedOffset;
                return saveLyricsOffset(song, value);
            },
            reloadLyrics: () => fetchAndDisplayLyrics(currentSongInfo, false, true),
            switchProvider: switchLyricsProvider,
            setDisplayMode: (mode) => setCurrentDisplayModeAndRender(mode, currentSongInfo),
            importTTML: (id, lyrics) => updateLocalTTML(id, lyrics),
            removeLocalTTML: (id) => updateLocalTTML(id, null, true),
            onReady: () => stylesReady.then(() => {
                if (amllHost === host && host.isConnected && !nativeMode) {
                    host.hidden = false;
                    frameReady = true;
                    applyPresentation();
                }
            }).catch(() => { if (amllHost === host) showNativePlayer(); }),
        });
        amllPlayer.updateSettings(currentSettings);
        amllPlayer.updateSong(frameSongInfo(currentSongInfo));
        if (cachedPlaybackState) amllPlayer.updatePlayback(cachedPlaybackState);
        if (cachedLyricsArguments) amllPlayer.displayLyrics(...cachedLyricsArguments);
        else if (cachedLyricStatus === 'empty') amllPlayer.displaySongNotFound();
        else if (cachedLyricStatus === 'error') amllPlayer.displaySongError();
        amllPlayer.setAvailableProviders(cachedProviders);
        amllPlayer.setUserOffset(cachedOffset);
        amllPlayer.setVisible(!document.hidden);
        refreshTitleFix();
        sendPlayerCommand('snapshot').catch(error => amllPlayer?.showToast(error.message));
    } catch (error) { console.error('YouLy+: could not mount AMLL', error); showNativePlayer(); }
}

const LyricsPlusAPI = {
    displayLyrics: (...args) => {
        if (songIdentity(args[1]) !== songIdentity(currentSongInfo)) return;
        args[1] = frameSongInfo(args[1]);
        const switchProvider = args[8];
        const saveOffset = args[9];
        manualLyricsProvider = args[0]?.playerProviderPreference && args[0].playerProviderPreference !== 'auto' ? args[0].playerProviderPreference : null;
        args[8] = async (...parameters) => {
            const pending = {};
            pendingLyricsProviderSwitch = pending;
            try {
                const result = await switchProvider?.(...parameters);
                if (result && songIdentity(args[1]) === songIdentity(currentSongInfo)) manualLyricsProvider = parameters[0] === 'auto' ? null : parameters[0];
                return result;
            } finally {
                if (pendingLyricsProviderSwitch === pending) {
                    pendingLyricsProviderSwitch = null;
                    if (pending.nativeArrived && songIdentity(args[1]) === songIdentity(currentSongInfo)
                        && (!manualLyricsProvider || manualLyricsProvider === 'applemusic')) fetchAndDisplayLyrics(currentSongInfo, false, true);
                }
            }
        };
        args[9] = (song, value) => {
            cachedOffset = Number(value) || 0;
            if (cachedLyricsArguments) cachedLyricsArguments[11] = cachedOffset;
            return saveOffset?.(song, value);
        };
        cachedLyricsArguments = args;
        cachedLyricStatus = 'ready';
        cachedOffset = Number(args[11]) || 0;
        amllPlayer?.displayLyrics(...args);
    },
    displaySongNotFound: () => { cachedLyricStatus = 'empty'; cachedLyricsArguments = null; amllPlayer?.displaySongNotFound(); },
    displaySongError: () => { cachedLyricStatus = 'error'; cachedLyricsArguments = null; amllPlayer?.displaySongError(); },
    cleanupLyrics: () => { cachedLyricStatus = 'loading'; cachedLyricsArguments = null; amllPlayer?.cleanupLyrics(); },
    updateDisplayMode: (...args) => amllPlayer?.updateDisplayMode(...args),
    updateCurrentTick: (seconds, sample) => {
        if (sample && Number.isSafeInteger(cachedPlaybackState?.sampleSequence)
            && sample.sampleSequence <= cachedPlaybackState.sampleSequence) return;
        if (cachedPlaybackState) cachedPlaybackState = { ...cachedPlaybackState, ...sample, currentTime: seconds };
        if (playerExpanded || presentation?.shown) amllPlayer?.updateCurrentTick(seconds, sample);
    },
    setTranslationLoading: (value) => amllPlayer?.setTranslationLoading(value),
    showToast: (...args) => amllPlayer?.showToast(...args),
    setUserOffset: (value) => { cachedOffset = value; if (cachedLyricsArguments) cachedLyricsArguments[11] = value; amllPlayer?.setUserOffset(value); },
    setAvailableProviders: (providers) => { cachedProviders = providers || []; amllPlayer?.setAvailableProviders(cachedProviders); },
};

function queueMount() {
    if (mountQueued) return;
    mountQueued = true;
    queueMicrotask(() => { mountQueued = false; mountAMLL(); });
}

window.initializeLyricsPlusPlatform = function () {
    if (platformStarted) { mountAMLL(); return; }
    if (!document.body) { setTimeout(window.initializeLyricsPlusPlatform, 100); return; }
    platformStarted = true;
    injectPlatformCSS().catch(error => console.warn('YouLy+:', error.message));
    const observer = new MutationObserver(records => {
        if (records.some(record => !amllHost?.contains(record.target))) queueMount();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('click', interceptMiniArtwork, true);
    window.addEventListener('keydown', closeOnEscape, true);
    const finishOnResize = () => commitPresentation(presentation, true);
    window.addEventListener('resize', finishOnResize);
    document.addEventListener('visibilitychange', () => {
        amllPlayer?.setVisible(!document.hidden);
        if (document.hidden) commitPresentation(presentation, true);
        if (!document.hidden && amllPlayer) {
            if (presentation) watchPresentation(presentation);
            if (playerExpanded || presentation?.expanded) sendPlayerCommand('snapshot').catch(() => {});
        }
    });
    window.addEventListener('pagehide', () => {
        observer.disconnect(); window.removeEventListener('click', interceptMiniArtwork, true);
        window.removeEventListener('keydown', closeOnEscape, true);
        window.removeEventListener('resize', finishOnResize);
        unmountAMLL(); clearTimeout(libraryRefreshTimer);
        for (const pending of pendingCommands.values()) { clearTimeout(pending.timer); pending.reject(new Error('Player closed')); }
        pendingCommands.clear();
    }, { once: true });
    mountAMLL();
};

window.addEventListener('YOUPLUS_SETTINGS_UPDATED', (event) => {
    if (!currentSettings.isEnabled || currentSettings.appleMusicAMLL === false) { nativeMode = false; unmountAMLL(); return; }
    injectDOMScript();
    window.initializeLyricsPlusPlatform();
    if (event.detail.changedKeys?.includes('appleMusicTitleCorrection')) refreshTitleFix();
    if (event.detail.changedKeys?.includes('customTranslateTarget')) {
        currentSongInfo = { ...currentSongInfo, appleMusicTTML: undefined, appleMusicLyricsPending: !currentSongInfo.isVideo, appleMusicLyricsLanguage: getAppleMusicLyricsLanguage() };
        sendPlayerCommand('lyricsLanguage', getAppleMusicLyricsLanguage()).catch(error => console.warn('YouLy+: native language refresh failed', error));
    }
    // Frame messages clone their arguments; keep replay state current explicitly.
    if (cachedLyricsArguments) {
        cachedLyricsArguments[3] = event.detail.settings;
        cachedLyricsArguments[6] = event.detail.settings.largerTextMode || 'lyrics';
    }
    amllPlayer?.updateSettings(event.detail.settings);
    commitPresentation(presentation, true);
    queueMount();
});

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message.type === 'LYPLUS_PLAYER_RESULT') {
        const pending = pendingCommands.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer); pendingCommands.delete(message.requestId);
        if (message.ok) pending.resolve(message.result); else pending.reject(Object.assign(new Error(message.error || 'Playback failed'), { code: message.code }));
    } else if (message.type === 'LYPLUS_SONG_CHANGED' || message.type === 'LYPLUS_SONG_SNAPSHOT') {
        const nextSong = message.songInfo || {};
        const changed = songIdentity(nextSong) !== songIdentity(currentSongInfo);
        if (changed) {
            clearTimeout(libraryRefreshTimer);
            resetLyricsSession();
            titleFixRequest++; titleFix = null;
            cachedLyricsArguments = null; cachedProviders = []; cachedOffset = 0;
            cachedLyricStatus = 'loading'; manualLyricsProvider = null; cachedPlaybackState = null;
            pendingLyricsProviderSwitch = null;
        }
        const artworkChanged = nextSong.artwork !== currentSongInfo.artwork;
        currentSongInfo = nextSong;
        amllPlayer?.updateSong(frameSongInfo(currentSongInfo));
        if (amllHost && (changed || artworkChanged)) commitPresentation(presentation, true);
        if (!amllHost) queueMount();
        if (changed) refreshTitleFix();
        if (message.type === 'LYPLUS_SONG_SNAPSHOT' && !cachedLyricsArguments && nextSong.title && currentSettings.isEnabled) fetchAndDisplayLyrics(nextSong, false);
    } else if (message.type === 'LYPLUS_NATIVE_LYRICS') {
        if (songIdentity(message.songInfo) !== songIdentity(currentSongInfo) || message.songInfo?.appleMusicLyricsLanguage !== getAppleMusicLyricsLanguage()) return;
        currentSongInfo = message.songInfo;
        // Remember late native TTML for manual source switching, even if an external source won.
        if (currentSettings.isEnabled) pBrowser.runtime.sendMessage({ type: 'FETCH_LYRICS', songInfo: currentSongInfo, rememberOnly: true }).catch(() => {});
        const activeProvider = cachedLyricsArguments?.[0]?.provider;
        if (pendingLyricsProviderSwitch) pendingLyricsProviderSwitch.nativeArrived = true;
        if (currentSettings.isEnabled && !pendingLyricsProviderSwitch && (!manualLyricsProvider || manualLyricsProvider === 'applemusic') && !['local', 'amll', 'lunabeat', 'amlyrics'].includes(activeProvider)) fetchAndDisplayLyrics(currentSongInfo, false, true);
    } else if (message.type === 'LYPLUS_PLAYBACK_STATE') {
        if (!message.state || message.state.songId !== (currentSongInfo.appleId || null)) return;
        if (Number.isSafeInteger(message.state.sampleSequence) && Number.isSafeInteger(cachedPlaybackState?.sampleSequence)
            && message.state.sampleSequence <= cachedPlaybackState.sampleSequence) return;
        cachedPlaybackState = message.state;
        amllPlayer?.updatePlayback(cachedPlaybackState);
    } else if (message.type === 'LYPLUS_TIME_UPDATE' && message.songId === (currentSongInfo.appleId || null) && Number.isFinite(message.currentTime)) {
        const { type, ...sample } = message;
        LyricsPlusAPI.updateCurrentTick(message.currentTime, sample);
    }
});

function scheduleLibraryRefresh(local, cache) {
    if (!currentSettings.isEnabled || !currentSongInfo.appleId) return;
    const appleId = String(currentSongInfo.appleId);
    let changed = false;
    for (const [kind, notification] of [['local', local], ['cache', cache]]) {
        if (!notification || (kind === 'local' && notification.appleIds?.length && !notification.appleIds.map(String).includes(appleId))) continue;
        const timestamp = Number(notification.timestamp);
        if (!Number.isFinite(timestamp) || timestamp <= handledLibraryChanges[kind]) continue;
        handledLibraryChanges[kind] = timestamp;
        changed = true;
    }
    if (!changed) return;
    clearTimeout(libraryRefreshTimer);
    libraryRefreshTimer = setTimeout(() => {
        if (!currentSettings.isEnabled || String(currentSongInfo.appleId) !== appleId) return;
        manualLyricsProvider = null;
        resetLyricsSession();
        cachedProviders = []; amllPlayer?.setAvailableProviders([]);
        fetchAndDisplayLyrics(currentSongInfo, false, true).catch(error => console.warn('YouLy+: library refresh failed', error));
    }, 80);
}

pBrowser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    scheduleLibraryRefresh(changes.lyplusLocalLyricsChanged?.newValue, changes.lyplusLyricsCacheChanged?.newValue);
});
