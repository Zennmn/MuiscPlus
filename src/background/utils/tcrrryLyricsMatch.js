/*
 * SPDX-FileCopyrightText: Tcrrry-Lyrics-Plugin contributors
 * SPDX-License-Identifier: AGPL-3.0-only AND GPL-3.0-only
 *
 * Candidate search and recording identity rules adapted from
 * Tcrrry-Lyrics-Plugin, DirectLyricsRepository.kt (GPL-3.0).
 */

import { OfflineRomanizer } from '../services/romanization/offlineRomanizer.js';

const MIN_ACCEPTABLE_SCORE = 50;

const text = value => typeof value === 'string' ? value : '';
const hasText = value => typeof value === 'string' && value.length <= 512 && value.trim().length > 0;

function artistText(value) {
  if (Array.isArray(value)) {
    return value.map(item => text(item?.name) || text(item)).filter(Boolean).join(', ');
  }
  return text(value?.name) || text(value);
}

function durationMs(item = {}) {
  const explicit = Number(item.durationMs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const seconds = Number(item.duration);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
}

function sourceIndex(candidate, fallback) {
  const value = candidate?.searchIndex;
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function equalSets(first, second) {
  return first.size === second.size && [...first].every(value => second.has(value));
}

/** NFKC identity used by Tcrrry for titles and artists. */
export function normalize(value) {
  return text(value).normalize('NFKC').toLowerCase()
    .replace(/[（(\[].*?(live|remaster|版|伴奏|纯音乐|翻唱).*?[）)\]]/giu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Preserve an alphanumeric title, or fall back to punctuation-insensitive text. */
function titleIdentityKey(value) {
  const alphanumeric = normalize(value);
  if (alphanumeric) return alphanumeric;
  return text(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/** Tcrrry's release-form exclusions. Parenthetical version labels are ignored by normalize. */
export function versionTags(value) {
  const normalized = text(value).normalize('NFKC').toLowerCase();
  const tags = new Set();
  if (/\blive\b|现场|ライヴ|ライブ/u.test(normalized)) tags.add('live');
  if (/instrumental|伴奏|纯音乐|純音楽|off\s*vocal/u.test(normalized)) tags.add('instrumental');
  if (/remix|リミックス/u.test(normalized)) tags.add('remix');
  if (/acoustic|アコースティック/u.test(normalized)) tags.add('acoustic');
  if (/karaoke|カラオケ/u.test(normalized)) tags.add('karaoke');
  return tags;
}

export function coreTitle(value) {
  return text(value)
    .replace(/\s*[（(][^）)]*[）)]\s*/gu, ' ')
    .replace(/\s*[【\[].*?[】\]]\s*/gu, ' ')
    .replace(/\s*(?:-|\/)?\s*(?:feat\.?|ft\.?|with)\s+.+$/giu, ' ')
    .trim();
}

function editDistance(first, second) {
  const left = text(first);
  const right = text(second);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j += 1) {
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + (left[i] === right[j] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/**
 * Approximate Android ICU's Any-Latin transliteration with the existing
 * offline romanizers. Diacritics are removed as in Tcrrry's ICU transform.
 */
function latinizeIfAvailable(value) {
  const source = text(value);
  if (!source) return '';
  let transliterated = source;
  try {
    transliterated = OfflineRomanizer.romanizeSyllable(source, source, 'unknown');
  } catch {}
  return (text(transliterated) || source).normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC');
}

function latinSimilarity(first, second) {
  const left = normalize(latinizeIfAvailable(first));
  const right = normalize(latinizeIfAvailable(second));
  if (!left || !right) return 0;
  if (left === right) return 1;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function commonPrefixRatio(first, second) {
  const left = text(first);
  const right = text(second);
  const limit = Math.min(left.length, right.length);
  let same = 0;
  while (same < limit && left[same] === right[same]) same += 1;
  return same / Math.max(left.length, right.length);
}

export function textSimilarity(first, second) {
  if (!hasText(first) || !hasText(second)) return 0;
  const left = normalize(first);
  const right = normalize(second);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }
  return Math.max(
    latinSimilarity(first, second),
    1 - editDistance(left, right) / Math.max(left.length, right.length)
  );
}

function containsCjk(value) {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text(value));
}

function durationScore(expectedMs, candidateMs) {
  if (expectedMs <= 0 || candidateMs <= 0) return 0;
  const delta = Math.abs(expectedMs - candidateMs);
  if (delta <= 3000) return 12;
  if (delta <= 8000) return 8;
  if (delta <= 15000) return 4;
  if (delta <= 35000) return -5;
  return -25;
}

function matchScore(track, artist, candidateTrack, candidateArtist) {
  const wantedTrack = normalize(track);
  const foundTrack = normalize(candidateTrack);
  const wantedArtist = normalize(artist);
  const foundArtist = normalize(candidateArtist);
  if (!wantedTrack || !foundTrack) return 0;
  if (wantedArtist && foundArtist
    && !foundArtist.includes(wantedArtist) && !wantedArtist.includes(foundArtist)) return 0;

  const titlePoints = wantedTrack === foundTrack ? 80
    : wantedTrack.length >= 4 && (foundTrack.includes(wantedTrack) || wantedTrack.includes(foundTrack)) ? 62
    : commonPrefixRatio(wantedTrack, foundTrack) >= 0.72 ? 50 : 0;
  const artistPoints = !wantedArtist ? 12
    : wantedArtist === foundArtist ? 20
    : wantedArtist.length >= 2 && (foundArtist.includes(wantedArtist) || wantedArtist.includes(foundArtist)) ? 17
    : 0;
  return titlePoints + artistPoints;
}

function platformMatchScore(track, artist, candidateTrack, candidateArtist, expectedMs, candidateMs) {
  const strict = matchScore(track, artist, candidateTrack, candidateArtist);
  const bonus = durationScore(expectedMs, candidateMs);
  if (strict >= MIN_ACCEPTABLE_SCORE) return strict + bonus;

  const wantedTitle = titleIdentityKey(track);
  const foundTitle = titleIdentityKey(candidateTrack);
  const titleExact = !!wantedTitle && wantedTitle === foundTitle;
  const titleLatin = latinSimilarity(track, candidateTrack);
  const artistLatin = latinSimilarity(artist, candidateArtist);
  const durationReliable = expectedMs > 0 && candidateMs > 0
    && Math.abs(expectedMs - candidateMs) <= 12000;
  if (!durationReliable) return strict;
  if (titleExact && artistLatin >= 0.58) return 88 + bonus;
  if (titleLatin >= 0.56
    && (normalize(artist) === normalize(candidateArtist) || artistLatin >= 0.58)) {
    return 84 + bonus;
  }
  return strict;
}

function rankedSearchFallbackScore(searchTitle, artist, candidateTitle, candidateArtist,
  expectedMs, candidateMs, index, blocked) {
  if (expectedMs <= 0 || candidateMs <= 0) return 0;
  if (Math.abs(expectedMs - candidateMs) > 8000) return 0;

  const wantedTitle = titleIdentityKey(searchTitle);
  const foundTitle = titleIdentityKey(candidateTitle);
  const titleExact = !!wantedTitle && wantedTitle === foundTitle;
  const wantedArtist = normalize(artist);
  const foundArtist = normalize(candidateArtist);
  const artistStrong = !!wantedArtist && !!foundArtist && (
    wantedArtist === foundArtist
    || foundArtist.includes(wantedArtist)
    || wantedArtist.includes(foundArtist)
    || latinSimilarity(artist, candidateArtist) >= 0.58
  );
  const bonus = durationScore(expectedMs, candidateMs);

  if (titleExact && index <= 8
    && (artistStrong || !(containsCjk(artist) && containsCjk(candidateArtist)))) {
    return 82 + bonus - Math.min(index, 8);
  }
  if (!blocked && artistStrong && index <= 2
    && !(containsCjk(searchTitle) && containsCjk(candidateTitle))) {
    return 84 + bonus - index;
  }
  return 0;
}

function matchesLocalizedRelease(track, artist, candidateTrack, candidateArtist, expectedMs, candidateMs) {
  if (durationScore(expectedMs, candidateMs) < 12) return false;

  const [base, localized] = [track, candidateTrack]
    .map(value => value.normalize('NFKC').trim()
      .replace(/(?:\s*\(\s*(?:feat|ft)\.?\s+[^()]+\)|\s+(?:feat|ft)\.?\s+[^()]+)$/iu, '')
      .trim().replace(/\s+/gu, ' ').toLowerCase())
    .sort((first, second) => first.length - second.length);
  if (!/\p{Script=Latin}/u.test(base) || containsCjk(base) || normalize(base).length < 6) return false;

  const subtitle = /^(.+?)[ :–—-]+(\p{Script=Han}{2,}(?: \p{Script=Han}+)*)$/u.exec(localized);
  if (!subtitle || subtitle[1] !== base
    || /版|翻唱|重录|重錄|重制|重製|改编|改編|加速|减速|減速|降速|剪辑|剪輯/u.test(subtitle[2])) return false;

  const artistNames = value => value.normalize('NFKC').split(/[,、;\/]|\s+&\s+/u).map(normalize);
  const creditedArtists = new Set(artistNames(artist));
  return artistNames(candidateArtist).some(name => name.length >= 4 && creditedArtists.has(name));
}

function searchTrackVariants(track) {
  const original = text(track).trim();
  const simplified = original
    .replace(/\s*[（(][^）)]*[）)]\s*/gu, ' ')
    .replace(/\s*[【\[].*?[】\]]\s*/gu, ' ')
    .trim();
  return [...new Set([original, simplified].filter(Boolean))];
}

/** Build Tcrrry's artist-qualified searches first, followed by title-only searches. */
export function tcrrrySearchPlans(song = {}) {
  const title = text(song.title).trim();
  const artist = artistText(song.artist).trim();
  if (!hasText(title) || artist.length > 512) return [];
  const variants = searchTrackVariants(title);
  const plans = variants.map(variant => ({
    query: `${variant} ${artist}`.trim(),
    title: variant,
    includesArtist: !!artist
  }));
  if (artist) {
    plans.push(...variants.map(variant => ({ query: variant, title: variant, includesArtist: false })));
  }
  return [...new Map(plans.map(plan => [plan.query, plan])).values()];
}

/**
 * Score candidates using the source result order for the localized-title
 * fallback. `manual` mirrors Tcrrry's exclusions set on a manual rematch.
 */
export function rankTcrrryCandidates(song = {}, candidates = [], options = {}) {
  if (!Array.isArray(candidates) || !hasText(song.title)) return [];
  const artist = artistText(song.artist);
  if (artist.length > 512) return [];
  const expectedMs = durationMs(song);
  const searchTitle = hasText(options.searchTitle) ? options.searchTitle : song.title;
  const originalKey = normalize(song.title);
  const variantChanged = normalize(searchTitle) !== originalKey;
  const allowRankFallback = options.allowRankFallback !== false;
  const blocked = options.manual === true;
  const requiredVersions = versionTags(song.title);

  const ranked = [];
  candidates.forEach((candidate, position) => {
    if (!candidate || !hasText(candidate.title)) return;
    if (!equalSets(requiredVersions, versionTags(candidate.title))) return;
    const candidateArtist = artistText(candidate.artist);
    if (candidateArtist.length > 512) return;
    const candidateMs = durationMs(candidate);
    const index = sourceIndex(candidate, position);
    const originalScore = platformMatchScore(
      song.title, artist, candidate.title, candidateArtist, expectedMs, candidateMs
    );
    const variantScore = variantChanged ? platformMatchScore(
      searchTitle, artist, candidate.title, candidateArtist, expectedMs, candidateMs
    ) : originalScore;
    const rankScore = allowRankFallback ? rankedSearchFallbackScore(
      searchTitle, artist, candidate.title, candidateArtist, expectedMs, candidateMs, index, blocked
    ) : 0;
    let score = Math.max(originalScore, variantScore, rankScore);
    // Regional releases can append a translated subtitle and reorder the same artist credits.
    if (score < MIN_ACCEPTABLE_SCORE
      && matchesLocalizedRelease(song.title, artist, candidate.title, candidateArtist, expectedMs, candidateMs)) {
      score = 88;
    }
    if (score < MIN_ACCEPTABLE_SCORE) return;
    ranked.push({ ...candidate, searchIndex: index, matchScore: score });
  });

  return ranked.sort((first, second) =>
    second.matchScore - first.matchScore || first.searchIndex - second.searchIndex);
}

/** Tcrrry's same-recording test. Object durations use seconds unless `durationMs` is set. */
export function sameTcrrryRecording(first = {}, second = {}) {
  const firstArtist = artistText(first.artist);
  const secondArtist = artistText(second.artist);
  const firstMs = durationMs(first);
  const secondMs = durationMs(second);
  return titleIdentityKey(first.title) === titleIdentityKey(second.title)
    && !!normalize(firstArtist)
    && normalize(firstArtist) === normalize(secondArtist)
    && equalSets(versionTags(first.title), versionTags(second.title))
    && firstMs > 0 && secondMs > 0 && Math.abs(firstMs - secondMs) <= 3000;
}
