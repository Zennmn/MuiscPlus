// Apple Music content-script adapter. AMLL renders in a separate extension document.
let currentSongInfo = {};
let amllPlayer = null;
let amllHost = null;
let amllModal = null;
let closingHost = null;
let miniCoverOrigin = null;
let coverFlight = null;
let openingArtwork = null;
let nativeOpeningTimer = null;
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
const openingCoverAttribute = 'data-lyplus-amll-opening-cover';

function artworkAsset(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !/(^|\.)mzstatic\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith('/image/')) return '';
        return parsed.pathname.replace(/\/\d+x\d+[^/]*$/, '');
    } catch (_) { return ''; }
}

function canMoveCover() {
    return currentSettings.isEnabled && currentSettings.appleMusicAMLL !== false && !currentSettings.lightweight
        && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches
        && typeof HTMLElement.prototype.showPopover === 'function' && typeof Element.prototype.animate === 'function';
}

function preloadOpeningArtwork() {
    const url = currentSongInfo.artwork;
    if (openingArtwork?.url === url) return;
    openingArtwork = null;
    if (!canMoveCover() || !currentSongInfo.appleId || !artworkAsset(url)) return;
    const image = new Image();
    image.src = url;
    const prepared = openingArtwork = { url, image, ready: false };
    // Reuse this decoded image for opening instead of scaling the page thumbnail.
    image.decode().then(() => {
        prepared.ready = Math.min(image.naturalWidth, image.naturalHeight) >= 512;
    }, () => {});
}

function readMiniCover() {
    const songId = String(currentSongInfo.appleId || '');
    const asset = artworkAsset(currentSongInfo.artwork);
    if (!songId || !asset) return null;
    for (const bar of document.querySelectorAll(applePlayerBar)) {
        for (const artwork of bar.querySelectorAll(appleMiniArtwork)) {
            if (artwork.closest(appleLyricsModal)) continue;
            const roots = [artwork];
            for (const root of roots) {
                for (const img of root.querySelectorAll('img')) {
                    const src = img.currentSrc || img.src;
                    if (!img.complete || img.naturalWidth < 2 || artworkAsset(src) !== asset) continue;
                    const { left, top, width, height } = img.getBoundingClientRect();
                    const style = getComputedStyle(img);
                    if (style.visibility !== 'visible' || style.opacity === '0' || width < 12 || height < 12
                        || left < 0 || top < 0 || left + width > innerWidth + 1 || top + height > innerHeight + 1) continue;
                    const radius = parseFloat(style.borderTopLeftRadius)
                        || parseFloat(getComputedStyle(artwork).borderTopLeftRadius) || Math.min(width, height) * 0.08;
                    return { src, asset, songId, left, top, width, height, radius, viewportWidth: innerWidth,
                        viewportHeight: innerHeight };
                }
                for (const element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
            }
        }
    }
    return null;
}

function miniCoverMatches(cover) {
    return cover && cover.songId === String(currentSongInfo.appleId || '') && cover.asset === artworkAsset(currentSongInfo.artwork)
        && cover.viewportWidth === innerWidth && cover.viewportHeight === innerHeight;
}

function clearNativeOpening() {
    if (nativeOpeningTimer === null) return;
    clearTimeout(nativeOpeningTimer);
    nativeOpeningTimer = null;
    document.documentElement.removeAttribute(openingCoverAttribute);
}

function captureMiniCover(event) {
    if (!event.isTrusted || nativeMode || amllHost?.isConnected || !canMoveCover()
        || !globalThis.LyPlusAMLLFrame?.createPlayer) return;
    if (event.type === 'keydown' ? event.repeat || !['Enter', ' '].includes(event.key) : event.button !== 0) return;
    if (!event.composedPath().some(node => node instanceof Element && node.matches(appleMiniArtwork) && node.closest(applePlayerBar))
        || document.querySelector(appleLyricsModal)) return;
    if (event.type === 'click' && nativeOpeningTimer !== null && miniCoverMatches(miniCoverOrigin)) {
        clearTimeout(nativeOpeningTimer);
    } else {
        clearNativeOpening();
        miniCoverOrigin = readMiniCover();
        if (!miniCoverOrigin) return;
        preloadOpeningArtwork();
        if (!openingArtwork?.ready || openingArtwork.url !== currentSongInfo.artwork
            || !document.querySelector('link[data-lyrics-plus-platform-style]')?.sheet) return;
        // Arm before Apple's handler can insert or paint the native large cover.
        document.documentElement.setAttribute(openingCoverAttribute, 'true');
    }
    nativeOpeningTimer = setTimeout(() => {
        clearNativeOpening();
        if (coverFlight?.opening) clearCoverFlight();
    }, 450);
}

function coverInPage(target, host, source) {
    if (target?.songId !== source.songId || !['left', 'top', 'width', 'height', 'radius', 'viewportWidth', 'viewportHeight']
        .every(key => Number.isFinite(target[key])) || target.width < 12 || target.height < 12
        || target.viewportWidth < 12 || target.viewportHeight < 12 || target.radius < 0
        || target.left < -1 || target.top < -1 || target.left + target.width > target.viewportWidth + 1
        || target.top + target.height > target.viewportHeight + 1) return null;
    const frame = host.getBoundingClientRect();
    if (!frame.width || !frame.height) return null;
    const x = frame.width / target.viewportWidth, y = frame.height / target.viewportHeight;
    return { left: frame.left + target.left * x, top: frame.top + target.top * y,
        width: target.width * x, height: target.height * y, radius: target.radius * Math.min(x, y) };
}

function clearCoverFlight(flight = coverFlight) {
    if (!flight || flight !== coverFlight) return;
    coverFlight = null;
    flight.animation?.cancel();
    flight.image.remove();
    if (flight.opening) {
        clearNativeOpening();
        flight.player.cancelCoverOpening();
    }
    if (flight.hidden) void flight.player.setCoverTransitionHidden(false);
}

function beginCoverFlight(player, host, source, decodedImage) {
    clearCoverFlight();
    const image = decodedImage || new Image();
    image.className = 'lyplus-amll-cover-flight';
    image.setAttribute('popover', 'manual');
    image.setAttribute('aria-hidden', 'true');
    image.alt = '';
    if (!decodedImage) {
        image.decoding = 'sync';
        image.src = source.src;
    }
    coverFlight = { image, player, host, source };
    return coverFlight;
}

function flightIsCurrent(flight) {
    return coverFlight === flight && amllHost === flight.host && flight.host.isConnected && !nativeMode
        && canMoveCover() && miniCoverMatches(flight.source);
}

async function waitForCover(flight) {
    const until = performance.now() + 180;
    while (flightIsCurrent(flight)) {
        if (flight.image.complete) {
            if (!flight.image.naturalWidth) return null;
            const target = await flight.player.getCoverTransitionTarget();
            if (!flightIsCurrent(flight)) return null;
            if (target) return target;
        }
        if (performance.now() >= until) return null;
        await new Promise(resolve => setTimeout(resolve, 32));
    }
    return null;
}

function placeCoverImage(image, rect) {
    Object.assign(image.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px',
        height: rect.height + 'px', borderRadius: rect.radius + 'px' });
}

function showCoverImage(flight, from) {
    placeCoverImage(flight.image, from);
    document.body.appendChild(flight.image);
    flight.image.showPopover();
}

function moveCoverImage(flight, from, to) {
    const { image } = flight;
    placeCoverImage(image, to);
    const x = from.width / to.width, y = from.height / to.height;
    flight.animation = image.animate([
        { transform: 'translate(' + (from.left - to.left) + 'px, ' + (from.top - to.top) + 'px) scale(' + x + ', ' + y + ')',
            borderRadius: from.radius / x + 'px / ' + from.radius / y + 'px' },
        { transform: 'none', borderRadius: to.radius + 'px' },
    ], { duration: 300, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)', fill: 'both' });
    return flight.animation.finished;
}

function stageOpeningCover(host, player, source) {
    // If the native cover might already have painted, never animate back from a thumbnail.
    if (nativeOpeningTimer === null || !canMoveCover() || !miniCoverMatches(source)) return null;
    const prepared = openingArtwork;
    if (!prepared?.ready || prepared.url !== currentSongInfo.artwork) return null;
    let flight;
    try {
        flight = beginCoverFlight(player, host, source, prepared.image);
        flight.opening = true;
        showCoverImage(flight, source);
        if (!flight.image.matches(':popover-open')) { clearCoverFlight(flight); return null; }
        return flight;
    } catch (_) {
        if (flight) clearCoverFlight(flight);
        return null;
    }
}

async function revealAMLL(modal, host, player, flight) {
    const activate = (openingSettled = false) => {
        if (amllHost !== host || closingHost === host || !host.isConnected || nativeMode) return;
        if (!modal.hasAttribute('data-lyplus-amll-active')) {
            modal.setAttribute('data-lyplus-amll-active', 'true');
            host.focus({ preventScroll: true });
        }
        if (openingSettled) player.setCoverVideoEnabled(true);
    };
    if (!flight || !flightIsCurrent(flight)) {
        if (flight) clearCoverFlight(flight);
        activate(true);
        return;
    }
    const { source } = flight;
    try {
        const target = await waitForCover(flight);
        if (!target || !coverInPage(target, host, source) || !flight.image.matches(':popover-open')) return;
        const frame = host.getBoundingClientRect();
        const x = target.viewportWidth / frame.width, y = target.viewportHeight / frame.height;
        if (!await player.prepareCoverOpening({
            left: (source.left - frame.left) * x, top: (source.top - frame.top) * y,
            width: source.width * x, height: source.height * y, songId: source.songId,
        }) || !flightIsCurrent(flight)) return;
        activate();
        clearNativeOpening();
        const painted = coverInPage(await player.awaitCoverOpeningPaint(), host, source);
        if (!flightIsCurrent(flight) || !painted || !['left', 'top', 'width', 'height']
            .every(key => Math.abs(painted[key] - source[key]) <= 2)) return;
        // Transfer ownership while both covers are still at thumbnail size.
        // Only the real cover moves after this point, so there is no swap at the destination.
        flight.image.remove();
        await player.playCoverOpening();
    } catch (_) { /* The cover effect is optional; reveal the player normally. */ }
    finally {
        clearCoverFlight(flight);
        activate(true);
    }
}

function unmountAMLL(preserveClosingCover = false) {
    if (!preserveClosingCover || !coverFlight?.dismissed) clearCoverFlight();
    amllModal?.removeAttribute('data-lyplus-amll-active');
    amllPlayer?.dispose();
    amllPlayer = null;
    amllHost?.remove();
    amllHost = null;
    closingHost = null;
}

function showNativePlayer() {
    nativeMode = true;
    clearNativeOpening();
    unmountAMLL();
    if (!amllModal?.isConnected || amllModal.querySelector('#lyplus-amll-restore')) return;
    const button = document.createElement('button');
    button.id = 'lyplus-amll-restore';
    button.type = 'button';
    button.textContent = 'Muisc+ · AMLL';
    button.addEventListener('click', () => { nativeMode = false; button.remove(); mountAMLL(); });
    amllModal.appendChild(button);
}

function dismissAMLL(modal, host) {
    if (!modal.isConnected || amllModal !== modal || amllHost !== host) return;
    const scope = modal.closest('[data-testid="modal"]') || modal.parentElement;
    const close = modal.querySelector('[data-testid="lyrics-fullscreen-modal-close-button"]')
        || [...(scope?.querySelectorAll('[data-testid="close-button"], [data-testid="close-modal"], button[aria-label="Close"], button[aria-label="关闭"], .lyrics__close-button, .close-button') || [])]
        .find(element => !amllHost?.contains(element));
    if (close) close.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    // Let Apple's exit animation finish before restoring the native controls if dismissal failed.
    setTimeout(() => {
        if (amllHost === host && amllModal === modal && modal.isConnected) showNativePlayer();
    }, close ? 600 : 100);
}

async function closePlayer() {
    const modal = amllModal, host = amllHost, player = amllPlayer;
    if (!host?.isConnected || !modal?.isConnected || !player || closingHost === host) return;
    closingHost = host;
    player.setCoverVideoEnabled(false);
    if (coverFlight || !modal.hasAttribute('data-lyplus-amll-active') || !canMoveCover()) {
        clearCoverFlight();
        dismissAMLL(modal, host);
        return;
    }
    const source = readMiniCover() || miniCoverOrigin;
    if (!miniCoverMatches(source)) { dismissAMLL(modal, host); return; }
    const flight = beginCoverFlight(player, host, source);
    try {
        const target = await waitForCover(flight);
        const start = target && coverInPage(target, host, source);
        if (!start || !flightIsCurrent(flight)) return;
        showCoverImage(flight, start);
        flight.hidden = true;
        if (!await player.setCoverTransitionHidden(true) || !flightIsCurrent(flight)) return;
        const moving = moveCoverImage(flight, start, source);
        flight.dismissed = true;
        dismissAMLL(modal, host);
        await moving;
    } catch (_) { /* Fall through to the ordinary close path. */ }
    finally {
        clearCoverFlight(flight);
        if (!flight.dismissed) dismissAMLL(modal, host);
    }
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
    if (modal !== amllModal) {
        unmountAMLL(!modal);
        amllModal?.querySelector('#lyplus-amll-restore')?.remove();
        amllModal = modal;
        nativeMode = false;
    }
    if (!currentSettings.isEnabled || currentSettings.appleMusicAMLL === false || !modal || nativeMode) { unmountAMLL(!modal); return; }
    if (amllHost?.isConnected && amllPlayer) return;
    if (amllPlayer) unmountAMLL();
    if (!globalThis.LyPlusAMLLFrame?.createPlayer) { console.warn('YouLy+: AMLL frame bridge is unavailable'); return; }
    const recent = nativeOpeningTimer !== null && miniCoverMatches(miniCoverOrigin);
    const source = canMoveCover() ? (recent ? miniCoverOrigin : readMiniCover()) : null;
    miniCoverOrigin = miniCoverMatches(source) ? source : null;
    const host = document.createElement('iframe');
    host.id = 'lyplus-amll-root';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Muisc+ player');
    modal.appendChild(host);
    amllHost = host;
    const stylesReady = injectPlatformCSS();
    let openingCover = null;
    try {
        amllPlayer = globalThis.LyPlusAMLLFrame.createPlayer(host, {
            sendCommand: sendPlayerCommand, onClose: closePlayer, onFallback: showNativePlayer,
            holdCoverOnOpen: () => !!openingCover && openingCover === coverFlight,
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
                    return revealAMLL(modal, host, amllPlayer, openingCover);
                }
            }).catch(() => { if (amllHost === host) showNativePlayer(); }),
        });
        if (recent) openingCover = stageOpeningCover(host, amllPlayer, source);
        if (!openingCover) clearNativeOpening();
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
        amllPlayer?.updateCurrentTick(seconds, sample);
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
    for (const type of ['pointerdown', 'click', 'keydown']) window.addEventListener(type, captureMiniCover, true);
    window.addEventListener('resize', () => { miniCoverOrigin = null; clearNativeOpening(); clearCoverFlight(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { clearNativeOpening(); clearCoverFlight(); }
        amllPlayer?.setVisible(!document.hidden);
        if (!document.hidden && amllPlayer) sendPlayerCommand('snapshot').catch(() => {});
    });
    window.addEventListener('pagehide', () => {
        observer.disconnect(); clearNativeOpening(); unmountAMLL(); clearTimeout(libraryRefreshTimer);
        for (const pending of pendingCommands.values()) { clearTimeout(pending.timer); pending.reject(new Error('Player closed')); }
        pendingCommands.clear();
    }, { once: true });
    mountAMLL();
};

window.addEventListener('YOUPLUS_SETTINGS_UPDATED', (event) => {
    if (!canMoveCover()) {
        clearNativeOpening();
        if (coverFlight?.opening) clearCoverFlight();
    }
    if (!currentSettings.isEnabled) { unmountAMLL(); return; }
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
            miniCoverOrigin = null;
            clearNativeOpening();
            clearCoverFlight();
            clearTimeout(libraryRefreshTimer);
            resetLyricsSession();
            titleFixRequest++; titleFix = null;
            cachedLyricsArguments = null; cachedProviders = []; cachedOffset = 0;
            cachedLyricStatus = 'loading'; manualLyricsProvider = null; cachedPlaybackState = null;
            pendingLyricsProviderSwitch = null;
        }
        currentSongInfo = nextSong;
        preloadOpeningArtwork();
        amllPlayer?.updateSong(frameSongInfo(currentSongInfo));
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
