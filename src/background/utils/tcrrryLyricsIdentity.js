/*
 * Localized recording identity lookup adapted from Tcrrry-Lyrics-Plugin,
 * DirectLyricsRepository.resolveLocalizedIdentity. The reference project is
 * GPL-3.0; retain its attribution when distributing this adaptation.
 */

import { coreTitle, normalize, textSimilarity, versionTags } from './tcrrryLyricsMatch.js';

const SEARCH_ENDPOINT = 'https://itunes.apple.com/search';
const CACHE_LIMIT = 128;
const IDENTITY_MIN_SCORE = 50;
const IDENTITY_STRONG_SCORE = 75;
const IDENTITY_MIN_MARGIN = 5;
const identityCache = new Map();

const text = value => typeof value === 'string' ? value : '';
const hasText = value => typeof value === 'string' && value.length <= 512 && value.trim().length > 0;
const positiveDuration = value => {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
};

function rememberIdentity(key, identity) {
  if (identityCache.size >= CACHE_LIMIT) identityCache.delete(identityCache.keys().next().value);
  identityCache.set(key, identity);
}

function candidateScore(song, candidate, index, expectedDurationMs) {
  const candidateDuration = positiveDuration(candidate?.trackTimeMillis);
  const durationDelta = Math.abs(expectedDurationMs - candidateDuration);
  const title = text(candidate?.trackName);
  const artist = text(candidate?.artistName);
  if (!hasText(title) || !hasText(artist) || durationDelta > 15000) return null;

  const inputVersions = versionTags(song.title);
  const candidateVersions = versionTags(title);
  if ([...candidateVersions].some(tag => !inputVersions.has(tag))) return null;

  const durationPoints = durationDelta <= 3000 ? 40 : durationDelta <= 8000 ? 32 : 20;
  const titlePoints = Math.trunc(textSimilarity(coreTitle(song.title), coreTitle(title)) * 35);
  const artistPoints = Math.trunc(textSimilarity(text(song.artist), artist) * 20);
  const albumPoints = Math.trunc(textSimilarity(text(song.album), text(candidate.collectionName)) * 20);
  const rankPoints = Math.max(0, 10 - index);
  return {
    title,
    artist,
    album: text(candidate.collectionName),
    score: durationPoints + titlePoints + artistPoints + albumPoints + rankPoints
  };
}

/**
 * Resolve a localized title/artist through the Japanese iTunes catalogue.
 * A result is accepted only when Tcrrry's recording score is decisive enough.
 * The shared similarity helper uses the existing offline romanizer in place
 * of Android's ICU Any-Latin transform.
 */
export async function resolveTcrrryIdentity(requestJSON, song = {}, signal) {
  const expectedDurationMs = positiveDuration(Number(song?.duration) * 1000);
  const title = text(song?.title);
  const artist = text(song?.artist);
  const album = text(song?.album);
  if (!expectedDurationMs || !hasText(title) || !hasText(artist)) return null;

  const cacheKey = [title, artist, album, String(Math.trunc(expectedDurationMs / 2000))]
    .map(normalize).join('\u0000');
  if (identityCache.has(cacheKey)) return identityCache.get(cacheKey);

  try {
    if (signal?.aborted) return null;
    const query = `${title} ${artist}`.trim();
    const url = `${SEARCH_ENDPOINT}?${new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      limit: '20',
      country: 'jp',
      lang: 'ja_jp'
    })}`;
    const root = await requestJSON(url, { signal, headers: { Accept: 'application/json' } });
    if (signal?.aborted || !Array.isArray(root?.results)) return null;

    const grouped = new Map();
    root.results.forEach((candidate, index) => {
      if (candidate?.kind !== 'song') return;
      const scored = candidateScore(song, candidate, index, expectedDurationMs);
      if (!scored) return;
      const key = `${normalize(scored.title)}\u0000${normalize(scored.artist)}`;
      const previous = grouped.get(key);
      if (!previous || scored.score > previous.score) grouped.set(key, scored);
    });
    const ranked = [...grouped.values()].sort((first, second) => second.score - first.score);
    const best = ranked[0];
    if (!best || best.score < IDENTITY_MIN_SCORE) return null;
    const secondScore = ranked[1]?.score;
    if (secondScore !== undefined && best.score < IDENTITY_STRONG_SCORE
      && best.score - secondScore < IDENTITY_MIN_MARGIN) return null;

    const identity = {};
    if (normalize(best.title) !== normalize(title)) identity.title = best.title;
    if (normalize(best.artist) !== normalize(artist)) identity.artist = best.artist;
    if (!identity.title && !identity.artist) return null;
    identity.album = best.album || album;
    rememberIdentity(cacheKey, identity);
    return identity;
  } catch {
    return null;
  }
}
