// Runs in the page world; MusicKit and its tokens stay in this world.
(function () {
  if (window.__lyplusAppleMusicTracker) return;
  window.__lyplusAppleMusicTracker = true;
  let music;
  let songKey;
  let songInfo = null;
  let lyricRequest = 0;
  let frame;
  let poll;
  let lastState = '';
  let pendingLyrics;
  let nativeLyricsRequest;
  let accountStorefront;
  let pendingStorefront;
  let pendingMetadata;
  let pendingCoverVideo;
  const subscriptions = [];
  let lyricsLanguage = document.currentScript?.dataset?.lyricsLanguage;
  let queueRevision = 0;
  let favoriteState = null;
  let favoriteStateSongId = null;
  let favoriteRead;
  let favoriteWrite;
  let favoriteGeneration = 0;
  let favoriteReadError = null;
  let timelineElement = null;
  let timelineListeners = [];
  let timelineBuffering = false;
  let timelineBaseline = null;
  let timelineBoundary = '';
  let timelineRevision = 0;
  let sampleSequence = 0;
  let pendingSeeks = 0;
  const emit = (type, payload) => window.postMessage({ type, ...payload }, window.location.origin);
  const player = () => music?.player || music;
  const read = (key, fallback) => music?.[key] ?? player()?.[key] ?? fallback;
  const method = (name) => typeof music?.[name] === 'function' ? music : typeof player()?.[name] === 'function' ? player() : null;
  const settingTarget = (name) => music && name in music ? music : player() && name in player() ? player() : null;
  const queueItemId = (item) => {
    const params = item?.attributes?.playParams || item?.playParams || {};
    return String(item?.id || params.catalogId || params.id || '');
  };
  const playerError = (code, message) => Object.assign(new Error(message), { code });

  function musicApiHeaders() {
    const developerToken = music?.developerToken || music?.configuration?.developerToken || music?.configuration?.app?.developerToken;
    const userToken = music?.musicUserToken;
    if (!developerToken || !userToken) return null;
    return { Authorization: `Bearer ${developerToken}`, 'Music-User-Token': userToken, Accept: 'application/json' };
  }

  function favoriteSnapshot() {
    const id = songInfo?.appleId || null;
    const known = typeof id === 'string' && /^\d+$/.test(id) && favoriteStateSongId === id && typeof favoriteState === 'boolean';
    return {
      favoriteSongId: id,
      isFavorited: known ? favoriteState : null,
      canFavorite: !!(known && !songInfo.isVideo && !favoriteWrite && !favoriteReadError && favoriteRead?.id !== id && musicApiHeaders()),
    };
  }

  function resetFavoriteState() {
    favoriteGeneration++;
    favoriteReadError = null;
    favoriteRead?.controller?.abort();
    favoriteRead = null;
    favoriteState = null;
    favoriteStateSongId = null;
  }

  async function readFavoriteState(songId = songInfo?.appleId) {
    if (typeof songId !== 'string' || !/^\d+$/.test(songId) || songInfo?.appleId !== songId || songInfo.isVideo || favoriteWrite) return null;
    if (favoriteRead?.id === songId) return favoriteRead.promise;
    favoriteRead?.controller?.abort();
    favoriteRead = null;
    const generation = favoriteGeneration;
    const headers = musicApiHeaders();
    if (!headers) {
      if (generation === favoriteGeneration && songInfo?.appleId === songId) {
        favoriteStateSongId = songId;
        favoriteState = null;
        favoriteReadError = 'playerFavoriteSignIn';
        publishState(true);
      }
      return null;
    }

    const controller = new AbortController();
    const entry = { id: songId, generation, controller, promise: null };
    favoriteRead = entry;
    favoriteReadError = null;
    const timeout = setTimeout(() => controller.abort(), 8000);
    entry.promise = (async () => {
      let value = null;
      let errorCode = 'playerFavoriteLoadFailed';
      try {
        const storefront = await getAccountStorefront(headers) || validStorefront(music?.storefrontId) || 'us';
        // Match Apple Music Web's personalized library-relationship request.
        // Its Favorites UI maps the explicitly requested personalRating to a star.
        const query = new URLSearchParams({
          'ids[songs]': songId, 'fields[songs]': 'inLibrary,personalRating',
          relate: 'library', 'omit[resource]': 'autos', platform: 'web', 'format[resources]': 'map',
        });
        const response = await fetch(`https://amp-api.music.apple.com/v1/catalog/${storefront}?${query}`, {
          headers, credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) errorCode = 'playerFavoriteSignIn';
        if (response.ok) {
          const body = await response.json();
          const song = body?.resources?.songs?.[songId] || (Array.isArray(body?.data)
            ? body.data.find(item => item?.type === 'songs' && String(item.id) === songId) : null);
          if (song?.attributes && typeof song.attributes === 'object') {
            value = typeof song.attributes.inFavorites === 'boolean'
              ? song.attributes.inFavorites : song.attributes.personalRating === 1;
          }
        }
      } catch (_) { /* Keep the state unknown when the account request fails. */ }
      finally {
        clearTimeout(timeout);
        if (favoriteRead === entry) favoriteRead = null;
      }
      if (generation === favoriteGeneration && songInfo?.appleId === songId && !favoriteWrite) {
        syncSong();
        if (generation !== favoriteGeneration || songInfo?.appleId !== songId || favoriteWrite) return value;
        favoriteStateSongId = songId;
        favoriteReadError = value === null ? errorCode : null;
        // Keep the last confirmed state through a transient refresh failure.
        if (value !== null) favoriteState = value;
        else if (errorCode === 'playerFavoriteSignIn') favoriteState = null;
        publishState(true);
      }
      return value;
    })();
    return entry.promise;
  }

  async function writeFavoriteState(songId, favorited) {
    const headers = musicApiHeaders();
    if (!headers) throw playerError('playerFavoriteSignIn', 'Apple Music account authorization is unavailable');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const query = new URLSearchParams({ 'ids[songs]': songId });
      const response = await fetch(`https://amp-api.music.apple.com/v1/me/favorites?${query}`, {
        method: favorited ? 'POST' : 'DELETE',
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw playerError('playerFavoriteSignIn', 'Apple Music account authorization was rejected');
      }
      if (!response.ok) throw playerError('playerFavoriteFailed', `Apple Music rejected the favorites update (${response.status})`);
    } catch (error) {
      if (error?.code) throw error;
      throw playerError('playerFavoriteFailed', controller.signal.aborted ? 'Apple Music favorites update timed out' : 'Unable to update Apple Music favorites');
    } finally { clearTimeout(timeout); }
  }

  function getQueueState() {
    const queue = read('queue', null);
    const items = Array.isArray(queue?.items) ? queue.items : [];
    return {
      position: Number(queue?.position) || 0,
      revision: queueRevision,
      songId: songInfo?.appleId || null,
      canSelect: !!method('changeToMediaAtIndex') && !!method('play'),
      items: items.slice(0, 100).map((item, index) => ({
        index,
        id: queueItemId(item),
        title: item?.attributes?.name || item?.title || '',
        artist: item?.attributes?.artistName || item?.artistName || '',
        artwork: String(item?.attributes?.artwork?.url || item?.artwork?.url || '').replaceAll('{w}', '96').replaceAll('{h}', '96'),
      })),
    };
  }

  function resetTimeline() {
    timelineRevision++;
    timelineBaseline = null;
  }

  function bindTimelineElement(element) {
    if (element === timelineElement) return;
    for (const [name, listener] of timelineListeners) timelineElement?.removeEventListener(name, listener);
    timelineListeners = [];
    timelineElement = element;
    timelineBuffering = false;
    resetTimeline();
    if (!element?.addEventListener) return;
    for (const name of ['waiting', 'stalled', 'emptied', 'error', 'playing', 'canplay', 'play', 'pause', 'ended', 'seeking', 'seeked', 'ratechange', 'loadedmetadata']) {
      const listener = () => {
        if (['waiting', 'emptied', 'error'].includes(name) || (name === 'stalled' && element.readyState < 3)) timelineBuffering = true;
        else if (['playing', 'canplay', 'seeked', 'loadedmetadata'].includes(name)) timelineBuffering = false;
        resetTimeline();
        if (read('nowPlayingItem', null)?.attributes) syncSong();
        publishState(true);
      };
      element.addEventListener(name, listener);
      timelineListeners.push([name, listener]);
    }
  }

  function getTimeSample() {
    let element = null, currentTime, timestampOffset = 0;
    try {
      const active = music?.services?.mediaItemPlayback?._currentPlayer;
      const target = active?._targetElement;
      const offset = Number(active?._buffer?.currentTimestampOffset ?? 0);
      if (target && Number.isFinite(target.currentTime) && Number.isFinite(offset)) {
        element = target;
        timestampOffset = offset;
        currentTime = Math.max(0, target.currentTime - offset);
      }
    } catch (_) { /* Fall back to the public timeline if MusicKit internals change. */ }
    if (!Number.isFinite(currentTime)) {
      const publicTime = Number(read('currentPlaybackTime', 0));
      currentTime = Number.isFinite(publicTime) ? Math.max(0, publicTime) : 0;
    }
    const sampledAt = performance.timeOrigin + performance.now();
    bindTimelineElement(element);
    const isPlaying = !!read('isPlaying', false);
    const isSeeking = pendingSeeks > 0 || !!element?.seeking;
    const isBuffering = !!element && (timelineBuffering || element.readyState < 3 || !!element.error);
    const rate = Number(element?.playbackRate);
    const playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    const timeSource = element ? 'media' : 'musickit';
    const songId = songInfo?.appleId || null;
    const boundary = JSON.stringify([songId, timeSource, timestampOffset, isPlaying, !!element?.paused, !!element?.ended, isSeeking, isBuffering, playbackRate, document.hidden]);
    if (boundary !== timelineBoundary) { timelineBoundary = boundary; resetTimeline(); }
    const previous = timelineBaseline;
    const elapsed = previous ? sampledAt - previous.sampledAt : 0;
    const delta = previous ? currentTime - previous.currentTime : 0;
    const expected = elapsed * playbackRate / 1000;
    const canAdvance = !!element && isPlaying && !element.paused && !element.ended && !isSeeking && !isBuffering && !document.hidden && rate > 0;
    const discontinuity = !!previous && (elapsed < 0 || elapsed > 250 || delta < -0.001 || delta - expected > 0.15);
    if (discontinuity) resetTimeline();
    // An unpaused element is not sufficient evidence: confirm its clock actually moved.
    // Briefly retain that evidence through repeated browser-rounded currentTime reads.
    const moved = !!previous && !discontinuity && elapsed > 0 && delta > 0.000001
      && Math.abs(delta - expected) <= Math.max(0.05, expected * 0.5);
    const lastAdvanceAt = canAdvance && moved ? sampledAt
      : canAdvance && !discontinuity ? previous?.lastAdvanceAt || 0 : 0;
    const isAdvancing = canAdvance && lastAdvanceAt > 0 && sampledAt - lastAdvanceAt <= 50;
    timelineBaseline = { currentTime, sampledAt, lastAdvanceAt };
    return { songId, currentTime, sampledAt, sampleSequence: ++sampleSequence, timelineRevision,
      isPlaying, isAdvancing, playbackRate, isSeeking, isBuffering, timeSource };
  }

  function getState() {
    const repeatValue = read('repeatMode', 0);
    const repeatEnums = window.MusicKit?.PlayerRepeatMode || { none: 0, one: 1, all: 2 };
    const shuffleValue = read('shuffleMode', false);
    const shuffleEnums = window.MusicKit?.PlayerShuffleMode || { off: 0, songs: 1 };
    return {
      ...getTimeSample(), queueRevision,
      duration: Number(read('currentPlaybackDuration', songInfo?.duration || 0)) || songInfo?.duration || 0,
      volume: Math.max(0, Math.min(1, Number(read('volume', 1)) || 0)),
      shuffle: shuffleValue === true || shuffleValue === 'songs' || shuffleValue === shuffleEnums.songs,
      repeat: repeatValue === 'one' || repeatValue === repeatEnums.one ? 'one' : repeatValue === 'all' || repeatValue === repeatEnums.all ? 'all' : 'off',
      capabilities: { shuffle: !!settingTarget('shuffleMode'), repeat: !!settingTarget('repeatMode') },
      ...favoriteSnapshot(),
    };
  }

  function publishState(force = false) {
    if (!music) return;
    const state = getState();
    // While playing, the per-frame timeline already sends the precise time.
    // Do not broadcast a duplicate full control snapshot for a time-only event.
    const { currentTime, sampledAt, sampleSequence, ...controls } = state;
    const serialized = JSON.stringify(state.isPlaying ? controls : { ...controls, currentTime });
    if (force || document.hidden || serialized !== lastState) { lastState = serialized; emit('LYPLUS_PLAYBACK_STATE', { state }); }
    updateFrame();
  }

  function updateFrame() {
    if (!read('isPlaying', false) || document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      return;
    }
    if (frame) return;
    const loop = () => {
      frame = null;
      if (!read('isPlaying', false) || document.hidden) return;
      if (read('nowPlayingItem', null)?.attributes) syncSong();
      emit('LYPLUS_TIME_UPDATE', getTimeSample());
      if (!frame) frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
  }

  const validStorefront = value => typeof value === 'string' && /^[a-z]{2}$/i.test(value) ? value.toLowerCase() : null;

  async function getAccountStorefront(headers) {
    // Keep credentials and this account-scoped cache inside the page world.
    const userToken = headers['Music-User-Token'] || '';
    if (!userToken && !music.isAuthorized && !/(?:^|;\s*)media-user-token=/.test(document.cookie || '')) return null;
    const key = `${headers.Authorization}\n${userToken}`;
    if (accountStorefront?.key === key && accountStorefront.expires > Date.now()) return accountStorefront.promise;
    const controller = new AbortController();
    pendingStorefront?.abort();
    pendingStorefront = controller;
    const entry = { key, expires: Infinity, promise: null };
    entry.promise = (async () => {
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch('https://amp-api.music.apple.com/v1/me/storefront', { headers, credentials: 'include', signal: controller.signal });
        if (!response.ok) return null;
        return validStorefront((await response.json())?.data?.[0]?.id);
      } catch (_) { return null; }
      finally { clearTimeout(timeout); if (pendingStorefront === controller) pendingStorefront = null; }
    })().then(value => { entry.expires = Date.now() + (value ? 30 * 60 * 1000 : 60000); return value; });
    accountStorefront = entry;
    return entry.promise;
  }

  function fetchNativeLyrics(id) {
    if (nativeLyricsRequest?.id === id && nativeLyricsRequest.language === lyricsLanguage && !pendingLyrics?.signal.aborted) return nativeLyricsRequest.promise;
    const entry = { id, language: lyricsLanguage };
    entry.promise = requestNativeLyrics(id).finally(() => {
      if (nativeLyricsRequest === entry) nativeLyricsRequest = null;
    });
    nativeLyricsRequest = entry;
    return entry.promise;
  }

  async function requestNativeLyrics(id) {
    if (!id || !music) return null;
    const developerToken = music.developerToken || music.configuration?.app?.developerToken;
    if (!developerToken) return null;
    pendingLyrics?.abort();
    const controller = new AbortController();
    pendingLyrics = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const requestedLanguage = lyricsLanguage || navigator.language || document.documentElement.lang || 'en-US';
      let locale = 'en-US';
      try {
        const tag = new Intl.Locale(requestedLanguage.replaceAll('_', '-'));
        locale = tag.language === 'zh' ? tag.maximize().toString() : tag.toString();
      } catch (_) { }
      // AMDL requests both lyric relationships from the catalog song resource.
      const query = new URLSearchParams({ l: locale, include: 'lyrics,syllable-lyrics', extend: 'ttmlLocalizations' });
      const headers = { Authorization: `Bearer ${developerToken}`, Accept: 'application/json' };
      if (music.musicUserToken) headers['Music-User-Token'] = music.musicUserToken;
      const account = await getAccountStorefront(headers);
      const storefronts = [...new Set([account, validStorefront(music.storefrontId) || 'us'].filter(Boolean))];
      for (const storefront of storefronts) {
        if (controller.signal.aborted) return null;
        try {
          const response = await fetch(`https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${encodeURIComponent(id)}?${query}`, { headers, credentials: 'include', signal: controller.signal });
          if (!response.ok) continue;
          const result = await response.json();
          const relationships = result?.data?.[0]?.relationships;
          const syllable = relationships?.['syllable-lyrics']?.data?.[0]?.attributes;
          const line = relationships?.lyrics?.data?.[0]?.attributes;
          const ttml = [syllable?.ttmlLocalizations, syllable?.ttml, line?.ttml]
            .find(value => typeof value === 'string' && value.trim());
          if (ttml) return ttml;
        } catch (_) { if (controller.signal.aborted) return null; }
      }
      return null;
    } catch (_) { return null; }
    finally { clearTimeout(timeout); if (pendingLyrics === controller) pendingLyrics = null; }
  }

  const metadataCache = new Map();
  const METADATA_TTL = 6 * 60 * 60 * 1000;
  const METADATA_MISS_TTL = 30 * 60 * 1000;

  const coverVideoCache = new Map();
  const COVER_VIDEO_TTL = 6 * 60 * 60 * 1000;
  const COVER_VIDEO_MISS_TTL = 10 * 60 * 1000;
  const coverVideoKey = (storefront, id) => storefront + ':' + id;
  const albumVideoKey = (storefront, id) => storefront + ':album:' + id;
  const coverVideoUrl = value => {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'mvod.itunes.apple.com' || url.port || url.username || url.password) return null;
      return url.pathname.toLowerCase().endsWith('.m3u8') ? url.href : null;
    } catch (_) { return null; }
  };

  function rememberCoverVideo(key, value) {
    coverVideoCache.set(key, { value, expires: Date.now() + (value ? COVER_VIDEO_TTL : COVER_VIDEO_MISS_TTL) });
    if (coverVideoCache.size > 24) coverVideoCache.delete(coverVideoCache.keys().next().value);
  }

  function parseCoverPage(text) {
    try { return text ? JSON.parse(text) : null; }
    catch (_) { return null; }
  }

  async function coverPageHeader(storefront, kind, id, signal, currentPage) {
    if (signal.aborted) return null;
    const headerFrom = data => {
      try {
        const page = data?.data?.find(page => {
          const item = page?.intent?.contentDescriptor;
          return item?.kind === kind && String(item.identifiers?.storeAdamID) === id
            && validStorefront(item.locale?.storefront) === storefront;
        });
        return page?.data?.sections?.flatMap(section => section?.items || []).find(item => {
          if (kind === 'album' && item?.id === `album-detail-header - ${id}`) return true;
          const descriptor = item?.contentDescriptor;
          return descriptor?.kind === kind && String(descriptor.identifiers?.storeAdamID) === id;
        }) || null;
      } catch (_) { return null; }
    };
    // Apple includes the motion artwork in its public album page. The initial
    // document data may belong to a previous SPA route, so match the resource ID.
    const current = headerFrom(currentPage);
    if (current) return current;
    const response = await fetch(`/${storefront}/${kind}/${id}`, {
      credentials: 'omit', headers: { Accept: 'text/html' }, signal,
    });
    if (!response.ok) return null;
    const state = (await response.text()).match(/<script\b[^>]*\sid=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
    return headerFrom(parseCoverPage(state?.[1]));
  }

  async function requestCoverVideo(id, signal) {
    const storefront = validStorefront(location.pathname.split('/')[1]) || validStorefront(music.storefrontId) || 'us';
    const cached = coverVideoCache.get(coverVideoKey(storefront, id));
    if (cached && cached.expires > Date.now()) return cached.value;
    if (signal.aborted) return null;
    const currentPage = parseCoverPage(document.getElementById('serialized-server-data')?.textContent);
    const song = await coverPageHeader(storefront, 'song', id, signal, currentPage);
    if (!song) return null;
    const albumId = String(song.contentDescriptor?.albumID || '');
    if (!/^\d+$/.test(albumId)) { rememberCoverVideo(coverVideoKey(storefront, id), null); return null; }
    const albumCached = coverVideoCache.get(albumVideoKey(storefront, albumId));
    if (albumCached && albumCached.expires > Date.now()) {
      rememberCoverVideo(coverVideoKey(storefront, id), albumCached.value);
      return albumCached.value;
    }
    const album = await coverPageHeader(storefront, 'album', albumId, signal, currentPage);
    if (!album) return null;
    const value = coverVideoUrl(album.videoArtwork?.dictionary?.motionDetailSquare?.video);
    rememberCoverVideo(albumVideoKey(storefront, albumId), value);
    rememberCoverVideo(coverVideoKey(storefront, id), value);
    return value;
  }

  const hasCjkText = value => /[\u3041-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff66-\uff9d]/.test(value || '');
  const hasHangulText = value => /[\uac00-\ud7af]/.test(value || '');
  const JAPANESE_METADATA = /j-pop|j-rock|japanese|anime|日本流行|日语流行|日語流行|动画|動畫/;
  const KOREAN_METADATA = /k-pop|korean|韩国流行|韓國流行|韩语流行|韓語流行/;
  const CHINESE_METADATA = /mandopop|cantopop|mandarin|chinese|hong kong|taiwan|国语流行|國語流行|华语流行|華語流行|中文流行|粤语流行|粵語流行/;

  // The original region comes from the recording itself, the way AM++ resolves it:
  // the ISRC country prefix names the release country (JP, KR, CN/HK/MO/TW) and the
  // genre covers what the ISRC does not. Scripts only corroborate a found entry, so
  // the JP storefront rewriting a foreign song in katakana can no longer win.
  function originalLanguageFor(base, pageText) {
    // Genres first, then the ISRC country prefix: the same order the module uses.
    for (const genreName of base?.genreNames || []) {
      const genre = String(genreName).toLowerCase();
      if (JAPANESE_METADATA.test(genre)) return 'ja-JP';
      if (KOREAN_METADATA.test(genre)) return 'ko-KR';
      if (CHINESE_METADATA.test(genre)) return 'zh-Hans-CN';
    }
    const country = String(base?.isrc || '').trim().slice(0, 2).toUpperCase();
    if (country === 'JP') return 'ja-JP';
    if (country === 'KR') return 'ko-KR';
    if (['CN', 'HK', 'MO', 'TW'].includes(country)) return 'zh-Hans-CN';
    // With neither signal, only a song the page itself shows in CJK is retried.
    return hasCjkText(pageText) ? 'unknown-cjk' : null;
  }

  function pickOriginalMetadata(results, pageText) {
    const base = results.get('us') || results.get('jp') || results.get('cn') || results.get('hk') || results.get('tw');
    const language = originalLanguageFor(base, pageText);
    if (!language) return null;
    if (language === 'ja-JP') return results.get('jp') || null;
    if (language === 'ko-KR') {
      const korean = results.get('kr');
      return korean && hasHangulText(korean.name) ? korean : null;
    }
    if (language === 'unknown-cjk') {
      const japanese = results.get('jp');
      if (japanese && hasCjkText(japanese.name)) return japanese;
    }
    // Simplified first (cn, then the zh-Hans localization other storefronts carry),
    // then the traditional Hong Kong/Taiwan spelling.
    for (const storefront of ['cn', 'us', 'hk', 'tw']) {
      const candidate = results.get(storefront);
      if (candidate && hasCjkText(candidate.name)) return candidate;
    }
    return null;
  }

  async function fetchCatalogSongAttributes(storefront, language, id, headers, signal) {
    const query = new URLSearchParams({ l: language });
    const url = 'https://amp-api.music.apple.com/v1/catalog/' + storefront + '/songs/' + encodeURIComponent(id) + '?' + query.toString();
    const response = await fetch(url, { headers, credentials: 'include', signal });
    if (!response.ok) return null;
    const attributes = (await response.json())?.data?.[0]?.attributes;
    return attributes ? {
      name: attributes.name || '',
      artistName: attributes.artistName || '',
      albumName: attributes.albumName || '',
      isrc: attributes.isrc || '',
      genreNames: attributes.genreNames || [],
    } : null;
  }

  // Title correction for the AMLL player only: fetch the song resource with the
  // storefront/language of the selected region and return its title/artist/album.
  // The page keeps its own Apple Music metadata; only the extension player shows this.
  async function requestCatalogMetadata(id, mode) {
    if (!id || !music || !['original', 'cn', 'jp'].includes(mode)) return null;
    const cacheKey = mode + ':' + id;
    const cached = metadataCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
    const developerToken = music.developerToken || music.configuration?.app?.developerToken;
    if (!developerToken) return null;
    pendingMetadata?.abort();
    const controller = new AbortController();
    pendingMetadata = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const headers = { Authorization: 'Bearer ' + developerToken, Accept: 'application/json' };
      if (music.musicUserToken) headers['Music-User-Token'] = music.musicUserToken;
      const account = await getAccountStorefront(headers);
      const fallback = account || validStorefront(music.storefrontId) || 'us';
      const language = mode === 'jp' ? 'ja-JP' : 'zh-CN';
      // The storefront decides whether a track exists there, the language decides
      // the script it comes back in: mainland titles are often missing from the cn
      // storefront while another storefront still serves their zh-Hans name, and
      // Hong Kong/Taiwan carry the traditional one. Every probe runs at once.
      const targets = mode === 'original'
        ? [['jp', 'ja-JP'], ['cn', 'zh-Hans-CN'], ['us', 'zh-Hans-CN'], ['hk', 'zh-Hant-HK'], ['tw', 'zh-Hant-TW'], ['kr', 'ko-KR']]
        : [[mode, language], [fallback, language]];
      const uniqueTargets = [...new Map(targets.map(target => [target[0], target])).values()];
      const results = new Map();
      // Probe in parallel: this runs while the player is already on screen.
      await Promise.all(uniqueTargets.map(async target => {
        try { results.set(target[0], await fetchCatalogSongAttributes(target[0], target[1], id, headers, controller.signal)); }
        catch (_) { results.set(target[0], null); }
      }));
      if (controller.signal.aborted) return null;
      const picked = mode === 'original'
        ? pickOriginalMetadata(results, `${songInfo?.title || ''} ${songInfo?.artist || ''}`)
        : (results.get(mode) || results.get(fallback) || null);
      const value = picked && (picked.name || picked.artistName) ? picked : null;
      metadataCache.set(cacheKey, { value, expires: Date.now() + (value ? METADATA_TTL : METADATA_MISS_TTL) });
      if (metadataCache.size > 80) metadataCache.delete(metadataCache.keys().next().value);
      return value;
    } catch (_) { return null; }
    finally { clearTimeout(timeout); if (pendingMetadata === controller) pendingMetadata = null; }
  }

  function syncSong(force = false) {
    const item = read('nowPlayingItem', null);
    const key = item?.id || null;
    if (!force && key === songKey) return;
    const changed = key !== songKey;
    songKey = key;
    if (!changed && songInfo) { emit('LYPLUS_SONG_SNAPSHOT', { songInfo }); return; }
    if (changed) { pendingCoverVideo?.abort(); resetFavoriteState(); resetTimeline(); }
    const request = ++lyricRequest;
    pendingLyrics?.abort();
    const attrs = item?.attributes;
    if (!attrs) { songInfo = null; emit('LYPLUS_SONG_CHANGED', { songInfo: null }); publishState(true); return; }
    const params = attrs.playParams || {};
    songInfo = {
      title: attrs.name || '', artist: attrs.artistName || '', album: attrs.albumName || '',
      appleMusicLyricsPending: params.kind !== 'music-videos',
      duration: (Number(attrs.durationInMillis) || 0) / 1000,
      artwork: (attrs.artwork?.url || '').replaceAll('{w}', '800').replaceAll('{h}', '800'),
      appleId: String(params.catalogId || params.id || item.id), isVideo: params.kind === 'music-videos', appleMusicLyricsLanguage: lyricsLanguage,
    };
    emit('LYPLUS_SONG_CHANGED', { songInfo }); // Do not hold up the cover/UI on a lyrics request.
    publishState(true);
    // hasLyrics describes the browsing storefront, not necessarily the account's.
    if (!songInfo.isVideo) {
      const id = songInfo.appleId;
      readFavoriteState(id);
      fetchNativeLyrics(id).then(ttml => {
        if (request !== lyricRequest || songInfo?.appleId !== id) return;
        songInfo = { ...songInfo, appleMusicTTML: ttml || undefined, appleMusicLyricsPending: false, appleMusicLyricsLanguage: lyricsLanguage };
        emit('LYPLUS_NATIVE_LYRICS', { songInfo });
      });
    }
  }

  async function execute(command, value) {
    if (command === 'coverVideo') {
      if (!music) return null;
      syncSong();
      const id = typeof value === 'string' ? value : '';
      if (!/^\d+$/.test(id) || songInfo?.isVideo || songInfo?.appleId !== id) return null;
      pendingCoverVideo?.abort();
      const controller = new AbortController();
      pendingCoverVideo = controller;
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const result = await requestCoverVideo(id, controller.signal);
        syncSong();
        if (controller.signal.aborted || songInfo?.isVideo || songInfo?.appleId !== id) return null;
        return result;
      } catch (_) { return null; }
      finally { clearTimeout(timeout); if (pendingCoverVideo === controller) pendingCoverVideo = null; }
    }
    if (!music && command !== 'lyricsLanguage') throw new Error('Apple Music is not ready yet');
    if (command === 'snapshot') {
      syncSong(true);
      readFavoriteState();
      publishState(true);
      return;
    }
    if (command === 'lyricsLanguage') {
      if (typeof value !== 'string' || value.length > 64) throw new Error('Invalid lyrics language');
      try { lyricsLanguage = new Intl.Locale(value).toString(); } catch (_) { throw new Error('Invalid lyrics language'); }
      pendingLyrics?.abort();
      nativeLyricsRequest = null;
      const request = ++lyricRequest;
      const id = songInfo?.appleId;
      if (songInfo) songInfo = { ...songInfo, appleMusicTTML: undefined, appleMusicLyricsPending: !songInfo.isVideo, appleMusicLyricsLanguage: lyricsLanguage };
      if (!id || songInfo.isVideo) return;
      const ttml = await fetchNativeLyrics(id);
      if (request !== lyricRequest || songInfo?.appleId !== id) return;
      songInfo = { ...songInfo, appleMusicTTML: ttml || undefined, appleMusicLyricsPending: false, appleMusicLyricsLanguage: lyricsLanguage };
      emit('LYPLUS_NATIVE_LYRICS', { songInfo });
      return;
    }
    if (command === 'nativeTTML') {
      syncSong();
      if (!songInfo?.appleId || songInfo.isVideo) throw new Error('nativeTTMLUnavailable');
      if (value !== songInfo.appleId) throw new Error('nativeTTMLSongChanged');
      const current = songInfo;
      const request = lyricRequest;
      const ttml = current.appleMusicTTML || await fetchNativeLyrics(current.appleId);
      if (request !== lyricRequest || songInfo?.appleId !== current.appleId) throw new Error('nativeTTMLSongChanged');
      if (typeof ttml !== 'string' || !/<(?:\w+:)?tt[\s>]/.test(ttml)) throw new Error('nativeTTMLUnavailable');
      songInfo = { ...songInfo, appleMusicTTML: ttml, appleMusicLyricsPending: false, appleMusicLyricsLanguage: lyricsLanguage };
      return { ttml, appleId: current.appleId, title: current.title, artist: current.artist };
    }
    if (command === 'catalogMetadata') {
      const id = String(value?.appleId || '');
      const mode = value?.mode;
      if (!/^\d+$/.test(id) || !['original', 'cn', 'jp'].includes(mode)) throw new Error('Invalid metadata request');
      return requestCatalogMetadata(id, mode);
    }
    if (command === 'queue') {
      syncSong();
      return getQueueState();
    }
    if (command === 'queuePlay') {
      syncSong();
      const queue = read('queue', null);
      const items = Array.isArray(queue?.items) ? queue.items : [];
      const index = value?.index;
      if (!Number.isInteger(index) || index < 0 || index >= items.length) throw playerError('playerQueueChanged', 'The selected queue item is no longer available');
      if (!Number.isInteger(value?.revision) || value.revision !== queueRevision || value?.songId == null || songInfo?.appleId == null || String(value.songId) !== String(songInfo.appleId)) {
        throw playerError('playerQueueChanged', 'The playback queue has changed');
      }
      const id = queueItemId(items[index]);
      if (!id || value?.id == null || String(value.id) !== id) throw playerError('playerQueueChanged', 'The selected queue item has changed');
      const changeToMediaAtIndex = method('changeToMediaAtIndex');
      if (!changeToMediaAtIndex) throw playerError('playerQueueControlUnavailable', 'Selecting queue items is unavailable');
      try {
        if (index === Number(queue.position)) {
          const playTarget = method('play');
          if (!playTarget) throw playerError('playerQueuePlayFailed', 'Unable to resume playback');
          await playTarget.play();
          syncSong();
        } else {
          await changeToMediaAtIndex.changeToMediaAtIndex(index);
          const playTarget = method('play');
          if (!playTarget) throw playerError('playerQueuePlayFailed', 'Unable to start playback');
          await playTarget.play();
          syncSong(true);
        }
        publishState(true);
        return { ...getQueueState(), selectedIndex: index, selectedId: id };
      } catch (error) {
        syncSong();
        publishState(true);
        if (error?.code === 'playerQueuePlayFailed') throw error;
        throw playerError('playerQueuePlayFailed', error?.message || 'Unable to play the selected queue item');
      }
    }
    if (command === 'airplay') {
      const element = document.querySelector('audio, video');
      if (typeof element?.webkitShowPlaybackTargetPicker !== 'function') throw new Error('AirPlay is unavailable in this browser');
      element.webkitShowPlaybackTargetPicker();
      return;
    }
    if (command === 'favoriteState') {
      syncSong();
      const id = songInfo?.appleId;
      if (!id || songInfo.isVideo || !/^\d+$/.test(id)) throw playerError('playerFavoriteUnavailable', 'Favorites are unavailable for this song');
      if (value?.songId !== id) throw playerError('playerFavoriteSongChanged', 'The current song changed');
      if (!musicApiHeaders()) throw playerError('playerFavoriteSignIn', 'Apple Music account authorization is unavailable');
      const cached = favoriteSnapshot();
      if (cached.canFavorite) return cached;
      const generation = favoriteGeneration;
      const result = await readFavoriteState(id);
      syncSong();
      if (generation !== favoriteGeneration || songInfo?.appleId !== id) throw playerError('playerFavoriteSongChanged', 'The current song changed');
      if (typeof result !== 'boolean') throw playerError(favoriteReadError || 'playerFavoriteLoadFailed', 'Unable to read Apple Music favorite status');
      return favoriteSnapshot();
    }
    if (command === 'favorite') {
      syncSong();
      const id = songInfo?.appleId || null;
      const requestedId = typeof value?.songId === 'string' ? value.songId : '';
      if (requestedId && id && requestedId !== id) throw playerError('playerFavoriteSongChanged', 'The current song changed before the favorites update');
      if (!id || songInfo.isVideo || !/^\d+$/.test(id)) {
        throw playerError('playerFavoriteUnavailable', 'Apple Music favorites are unavailable for this song');
      }
      if (!musicApiHeaders()) throw playerError('playerFavoriteSignIn', 'Apple Music account authorization is unavailable');
      if (requestedId !== id) throw playerError('playerFavoriteSongChanged', 'The favorite request does not match the current song');
      if (typeof value?.favorited !== 'boolean') throw playerError('playerFavoriteUnavailable', 'Invalid favorite state');
      if (favoriteWrite) throw playerError('playerFavoriteFailed', 'An Apple Music favorites update is already in progress');
      if (favoriteRead?.id === id || favoriteStateSongId !== id || typeof favoriteState !== 'boolean') {
        throw playerError('playerFavoriteUnavailable', 'The Apple Music favorite state is not available yet');
      }
      if (favoriteState === value.favorited) return favoriteSnapshot();

      const generation = ++favoriteGeneration;
      favoriteRead?.controller?.abort();
      favoriteRead = null;
      favoriteWrite = { id, generation };
      publishState(true);
      try { await writeFavoriteState(id, value.favorited); }
      catch (error) {
        favoriteWrite = null;
        syncSong();
        if (generation !== favoriteGeneration || songInfo?.appleId !== id) {
          readFavoriteState();
          throw playerError('playerFavoriteSongChanged', 'The current song changed during the favorites update');
        }
        if (error?.code === 'playerFavoriteSignIn') { favoriteState = null; favoriteReadError = error.code; }
        publishState(true);
        if (error?.code) throw error;
        throw playerError('playerFavoriteFailed', error?.message || 'Unable to update the Apple Music favorite');
      }
      syncSong();
      favoriteWrite = null;
      if (generation !== favoriteGeneration || songInfo?.appleId !== id) {
        readFavoriteState();
        throw playerError('playerFavoriteSongChanged', 'The current song changed during the favorites update');
      }
      favoriteStateSongId = id;
      favoriteState = value.favorited;
      favoriteReadError = null;
      publishState(true);
      return favoriteSnapshot();
    }
    const calls = { playPause: read('isPlaying', false) ? 'pause' : 'play', previous: 'skipToPreviousItem', next: 'skipToNextItem', seek: 'seekToTime' };
    if (Object.hasOwn(calls, command)) {
      const name = calls[command];
      const target = method(name);
      if (!target) throw new Error('This playback control is unavailable');
      if (command === 'seek') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid playback position');
        pendingSeeks++;
        resetTimeline();
        publishState(true);
        try { await target[name](Math.min(value, getState().duration || value)); }
        finally { pendingSeeks--; resetTimeline(); syncSong(); publishState(true); }
      } else { await target[name](); }
    } else if (command === 'volume') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid volume');
      const target = settingTarget('volume');
      if (!target) throw new Error('Volume control is unavailable');
      target.volume = Math.max(0, Math.min(1, value));
    } else if (command === 'shuffle') {
      if (typeof value !== 'boolean') throw new Error('Invalid shuffle mode');
      const target = settingTarget('shuffleMode');
      if (!target) throw new Error('Shuffle control is unavailable');
      const enums = window.MusicKit?.PlayerShuffleMode || { off: 0, songs: 1 };
      target.shuffleMode = value ? enums.songs : enums.off;
    } else if (command === 'repeat') {
      if (!['off', 'one', 'all'].includes(value)) throw new Error('Invalid repeat mode');
      const target = settingTarget('repeatMode');
      if (!target) throw new Error('Repeat control is unavailable');
      const enums = window.MusicKit?.PlayerRepeatMode || { none: 0, one: 1, all: 2 };
      target.repeatMode = value === 'off' ? enums.none : enums[value];
    } else { throw new Error('Unknown playback control'); }
    syncSong();
    publishState(true); // Include seek updates while paused.
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message.type === 'LYPLUS_SEEK_TO') { try { await execute('seek', message.time); } catch (_) { } return; }
    if (message.type !== 'LYPLUS_PLAYER_COMMAND' || typeof message.requestId !== 'string') return;
    try {
      const result = await execute(message.command, message.value);
      emit('LYPLUS_PLAYER_RESULT', { requestId: message.requestId, ok: true, result });
    } catch (error) { emit('LYPLUS_PLAYER_RESULT', { requestId: message.requestId, ok: false, error: error?.message || 'Playback failed', code: error?.code || null }); }
  });

  function attach(instance) {
    music = instance;
    for (const name of ['nowPlayingItemDidChange', 'playbackStateDidChange', 'playbackTimeDidChange', 'playbackDurationDidChange', 'playbackVolumeDidChange', 'volumeDidChange', 'shuffleModeDidChange', 'repeatModeDidChange', 'queueItemsDidChange']) {
      const listener = () => { if (name === 'queueItemsDidChange') queueRevision++; syncSong(); publishState(); };
      try { instance.addEventListener(name, listener); subscriptions.push([name, listener]); } catch (_) { }
    }
    syncSong();
    publishState(true);
    poll = setInterval(() => { syncSong(); publishState(); }, 500);
  }

  function waitForMusicKit() {
    try { const instance = window.MusicKit?.getInstance(); if (instance) { attach(instance); return; } } catch (_) { }
    setTimeout(waitForMusicKit, 500);
  }
  document.addEventListener('visibilitychange', () => {
    resetTimeline();
    publishState(true);
    if (!document.hidden) readFavoriteState();
  });
  window.addEventListener('focus', () => {
    if (!document.hidden) readFavoriteState();
  });
  window.addEventListener('pagehide', () => {
    clearInterval(poll);
    if (frame) cancelAnimationFrame(frame);
    pendingLyrics?.abort();
    pendingStorefront?.abort();
    pendingMetadata?.abort();
    pendingCoverVideo?.abort();
    favoriteRead?.controller?.abort();
    for (const [name, listener] of timelineListeners) timelineElement?.removeEventListener(name, listener);
    timelineListeners = [];
    for (const [name, listener] of subscriptions) music?.removeEventListener?.(name, listener);
  }, { once: true });
  waitForMusicKit();
})();
