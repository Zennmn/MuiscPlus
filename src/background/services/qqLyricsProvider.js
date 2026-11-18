import { decodeQqQrc } from '../utils/qqQrc.js';
import { tcrrryLyricBody } from '../utils/fallbackLyrics.js';

const SEARCH_ENDPOINT = 'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp';
const RICH_LYRICS_ENDPOINT = 'https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg';
const LYRICS_ENDPOINT = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const SEARCH_LIMIT = 20;
const QRC_LINE = /^\[(\d+),(\d+)\](.*)$/;

const text = value => typeof value === 'string' ? value : '';
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Lyrics request aborted', 'AbortError');
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, entity => {
    const key = entity.slice(1, -1).toLowerCase();
    if (named[key]) return named[key];
    const hexadecimal = key.startsWith('#x');
    const point = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : entity;
  });
}

function parseJsonBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('QQ lyrics response bytes are unavailable');
  const parse = encoding => {
    const content = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    return JSON.parse(content);
  };
  try {
    return parse('utf-8');
  } catch {
    return parse('gbk');
  }
}

function cleanSongText(value) {
  return decodeEntities(text(value).replace(/<[^>]*>/g, '')).trim();
}

function singerNames(value) {
  if (!Array.isArray(value)) return cleanSongText(value?.name || value);
  return value.map(singer => cleanSongText(singer?.name || singer)).filter(Boolean).join(', ');
}

function songId(value) {
  const id = typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? String(value) : text(value).trim();
  return /^\d+$/.test(id) ? id : '';
}

function songMid(value) {
  const mid = text(value).trim();
  return /^[a-z0-9_-]{1,64}$/i.test(mid) && mid !== '0' ? mid : '';
}

function formatLrcTime(milliseconds) {
  const safe = Math.max(0, Number(milliseconds) || 0);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor(safe / 1000) % 60;
  const millis = Math.floor(safe % 1000);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}]`;
}

function qrcToLineLrc(payload) {
  if (!hasText(payload)) return '';
  return text(payload).replace(/\r/g, '').split('\n').flatMap(raw => {
    const line = raw.trim();
    const match = QRC_LINE.exec(line);
    if (!match) return /^\[\d{1,3}:\d{2}(?:[.:]\d+)?\]/.test(line) ? [line] : [];
    const start = Number(match[1]);
    const lyric = match[3].replace(/\(\d+,\d+(?:,\d+)?\)/g, '').trim();
    return Number.isFinite(start) && lyric ? [`${formatLrcTime(start)}${lyric}`] : [];
  }).join('\n');
}

function qrcToWordYrc(payload) {
  if (!hasText(payload)) return '';
  return text(payload).replace(/\r/g, '').split('\n').flatMap(raw => {
    const line = QRC_LINE.exec(raw.trim());
    if (!line) return [];
    const body = line[3];
    const markers = [...body.matchAll(/\((\d+),(\d+)(?:,\d+)?\)/g)];
    if (!markers.length) return [];
    let cursor = 0;
    let words = '';
    for (const marker of markers) {
      words += `(${marker[1]},${marker[2]})${body.slice(cursor, marker.index)}`;
      cursor = marker.index + marker[0].length;
    }
    words += body.slice(cursor);
    return [`[${line[1]},${line[2]}]${words}`];
  }).join('\n');
}

function hasQrcWordTiming(payload) {
  return /^\[\d+,\d+\]/m.test(payload) && /\(\d+,\d+(?:,\d+)?\)/.test(payload);
}

function extractQqTrack(response, tag) {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?><!\\[CDATA\\[([\\s\\S]*?)]]></${tag}>`, 'i');
  return expression.exec(text(response))?.[1]?.trim() || '';
}

async function decodeQqTrack(payload) {
  const normalized = text(payload).trim();
  if (normalized.length >= 16 && normalized.length % 2 === 0 && /^[0-9a-f]+$/i.test(normalized)) {
    return decodeQqQrc(normalized);
  }
  return normalized;
}

function extractQqLyricContent(payload) {
  const match = /LyricContent="([\s\S]*?)"/i.exec(text(payload));
  return decodeEntities(match?.[1] || payload).replace(/&#10;/g, '\n').replace(/&#13;/g, '');
}

function cleanQqTranslation(lyrics) {
  return text(lyrics).split('\n').filter(line => {
    const body = line.replace(/^(\[[^\]]+\])+/, '').trim();
    return body !== '//' && !body.includes('QQ音乐享有本翻译作品的著作权')
      && !body.includes('TME享有本翻译作品的著作权');
  }).join('\n');
}

function normalizedIdentity(value) {
  return cleanSongText(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function isUsableQqLyrics(lyrics, title) {
  const lines = tcrrryLyricBody(text(lyrics).replace(/\r/g, '').split('\n'));
  if (!lines.length) return false;
  if (lines.length !== 1) return true;
  const candidateTitle = lines[0].split(/\s+[-–—]\s+/, 1)[0];
  return normalizedIdentity(candidateTitle) !== normalizedIdentity(title);
}

function buildLyricsPayload(lineContent, wordContent, translation, romanization, wordRomanization) {
  if (!hasText(lineContent)) return null;
  const words = hasQrcWordTiming(wordContent) ? qrcToWordYrc(wordContent) : '';
  const hasWords = hasText(words);
  const romanLine = qrcToLineLrc(romanization || wordRomanization);
  const romanWords = qrcToWordYrc(wordRomanization || romanization);
  return {
    format: hasWords ? 'yrc' : 'lrc',
    content: hasWords ? words : lineContent,
    translation: cleanQqTranslation(translation),
    romanization: romanLine,
    lineContent: hasWords ? lineContent : '',
    ...(hasText(romanWords) ? { wordRomanization: romanWords } : {}),
  };
}

async function optionalQrcTrack(xml, tag, signal) {
  const payload = extractQqTrack(xml, tag);
  if (!payload) return '';
  try {
    return extractQqLyricContent(await decodeQqTrack(payload));
  } catch {
    checkAbort(signal);
    return '';
  }
}

async function requestRichLyrics(requestJSON, candidate, signal) {
  const id = songId(candidate.extra?.songId ?? candidate.songId);
  if (!id) return null;
  checkAbort(signal);
  const response = await requestJSON(RICH_LYRICS_ENDPOINT, {
    method: 'POST',
    signal,
    responseType: 'text',
    headers: {
      Accept: 'text/plain, application/xml;q=0.9, */*;q=0.1',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: new URLSearchParams({
      version: '15', miniversion: '82', lrctype: '4', roma: '1', musicid: id,
    }).toString(),
  });
  const xml = text(response);
  if (!/<result>\s*0\s*<\/result>/.test(xml)) return null;

  const encrypted = extractQqTrack(xml, 'content');
  if (!encrypted) return null;
  checkAbort(signal);
  const original = extractQqLyricContent(await decodeQqTrack(encrypted));
  const lineContent = qrcToLineLrc(original);
  if (!isUsableQqLyrics(lineContent, candidate.title)) return null;

  const [translatedTrack, romanizationTrack] = await Promise.all([
    optionalQrcTrack(xml, 'contentts', signal),
    optionalQrcTrack(xml, 'contentroma', signal),
  ]);
  const translation = qrcToLineLrc(translatedTrack);
  return buildLyricsPayload(lineContent, original, translation, romanizationTrack, romanizationTrack);
}

async function requestPlainLyrics(requestJSON, candidate, signal) {
  const id = songMid(candidate.id);
  if (!id) return null;
  checkAbort(signal);
  const url = `${LYRICS_ENDPOINT}?${new URLSearchParams({
    songmid: id, format: 'json', nobase64: '1', trans: '1',
  })}`;
  const bytes = await requestJSON(url, {
    signal, responseType: 'bytes', headers: { Accept: 'application/json' },
  });
  const data = parseJsonBytes(bytes);
  const lineContent = decodeEntities(data?.lyric);
  if (!isUsableQqLyrics(lineContent, candidate.title)) return null;

  let romanizationTrack = '';
  const romanized = text(data?.roma);
  if (romanized) {
    try {
      romanizationTrack = extractQqLyricContent(await decodeQqTrack(romanized));
    } catch {
      romanizationTrack = romanized;
    }
  }
  return buildLyricsPayload(lineContent, '', decodeEntities(data?.trans), romanizationTrack, '');
}

export async function searchQqLyricsSongs(requestJSON, keyword, signal) {
  checkAbort(signal);
  if (!hasText(keyword) || keyword.length > 1024) return [];
  const url = `${SEARCH_ENDPOINT}?${new URLSearchParams({
    format: 'json', p: '1', n: String(SEARCH_LIMIT), w: keyword.trim(),
  })}`;
  const data = await requestJSON(url, { signal, headers: { Accept: 'application/json' } });
  const songs = data?.data?.song?.list;
  if (!Array.isArray(songs)) return [];
  checkAbort(signal);

  const seen = new Set();
  return songs.flatMap((song, searchIndex) => {
    const id = songMid(song?.songmid);
    const title = cleanSongText(song?.songname || song?.songorig);
    const artist = singerNames(song?.singer) || cleanSongText(song?.singername);
    if (!id || !title || !artist || seen.has(id)) return [];
    seen.add(id);
    const richId = songId(song?.songid);
    return [{
      id,
      title,
      artist,
      album: cleanSongText(song?.albumname),
      duration: positive(song?.interval),
      searchIndex,
      ...(richId ? { extra: { songId: richId } } : {}),
    }];
  });
}

export async function fetchQqLyrics(requestJSON, candidate, signal) {
  checkAbort(signal);
  if (!candidate || !songMid(candidate.id)) return null;

  try {
    const rich = await requestRichLyrics(requestJSON, candidate, signal);
    if (rich) return rich;
  } catch {
    checkAbort(signal);
  }
  checkAbort(signal);

  try {
    return await requestPlainLyrics(requestJSON, candidate, signal);
  } catch {
    checkAbort(signal);
    return null;
  }
}
