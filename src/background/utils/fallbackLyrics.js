/**
 * Browser-only fallback parsing and conservative matching.
 * References: music-lib/lyrics/lyrics.go (AGPL-3.0) and LDDC
 * core/parser/{krc,yrc,lrc}.py, core/{auto_fetch,algorithm}.py
 * (GPL-3.0-only; Copyright (C) 2024-2025 沉默の金).
 * Keep reference attribution in THIRD_PARTY_NOTICES.md when integrating.
 */
const MAX_CONTENT = 2 * 1024 * 1024;
const MAX_LINES = 10000;
const MAX_WORDS = 100000;
const MAX_TIME = 24 * 60 * 60 * 1000;
const AUX_WINDOW = 1200;
const BRIDGE_WINDOW = 12000;
const KRC_KEY = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const timed = value => finite(value) && value >= 0 && value <= MAX_TIME;
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');

/** A type label alone or one full-line placeholder does not establish word timing. */
export function lyricsPrecision(lyrics) {
  const lines = Array.isArray(lyrics?.data) ? lyrics.data.filter(line => hasText(line?.text)) : [];
  if (!lines.length) return 0;
  if (lyrics.type === 'None') return 1;
  const trustedWords = lyrics.metadata?.wordTiming === true
    || (lyrics.type === 'Word' && lyrics.metadata?.ttmlParser === 'amll-1');
  for (const line of lines) {
    const words = Array.isArray(line.syllabus) ? line.syllabus.filter(word => hasText(word?.text)
      && timed(word.time) && finite(word.duration) && word.duration > 0
      && timed(word.time + word.duration)) : [];
    if (!words.length) continue;
    if (trustedWords) return 3;
    if (words.length > 1 && words.some(word => word.time !== words[0].time)) return 3;
    const word = words[0];
    if (words.length === 1 && finite(line.startTime) && finite(line.endTime)
      && normalized(word.text) === normalized(line.text)
      && (word.time > line.startTime * 1000 + 20 || word.time + word.duration < line.endTime * 1000 - 20)) return 3;
  }
  return lines.some(line => finite(line.startTime) && line.startTime >= 0
    && (line.startTime > 0 || line.endTime > 0 || lyrics.type === 'Line' || lyrics.metadata?.lineTiming === true)) ? 2 : 1;
}

function similarity(first, second) {
  if (!first || !second) return 0;
  if (first === second) return 1;
  if (Math.min(first.length, second.length) / Math.max(first.length, second.length) < 0.9) return 0;
  const a = Array.from(first), b = Array.from(second);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) current[j + 1] = Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + (a[i] === b[j] ? 0 : 1));
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function artistString(value) {
  return Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : item?.name || '').join(' / ')
    : typeof value === 'string' ? value : '';
}

function artistScore(first, second) {
  const a = normalized(first), b = normalized(second);
  const unknown = /^(unknown|unknownartist|variousartists|佚名|未知歌手|群星)$/;
  if (!a || !b || unknown.test(a) || unknown.test(b)) return 0;
  if (a === b) return 1;
  const split = value => [...new Set(value.normalize('NFKC').split(/\s+(?:feat\.?|ft\.?|featuring|with|x)\s+|[、,;\/&\\]/i).map(normalized).filter(Boolean))];
  const left = split(first), right = split(second);
  if (left.length !== right.length || !left.length) return 0;
  const used = new Set();
  let total = 0;
  for (const name of left) {
    let best = -1, score = 0;
    right.forEach((other, index) => {
      const match = used.has(index) ? 0 : similarity(name, other);
      if (match > score) { score = match; best = index; }
    });
    if (score < 0.94) return 0;
    used.add(best);
    total += score;
  }
  return total / left.length;
}

function versions(title) {
  const value = String(title || '').normalize('NFKC').toLowerCase();
  return [
    /\blive\b|现场|現場|演唱会|演唱會/,
    /\bremix\b|\b(?:re|club|dance)[ -]?mix\b|混音/,
    /\b(?:instrumental|karaoke|off[ -]?vocal|accompaniment)\b|伴奏|纯音乐|純音樂/,
    /\bcover\b|翻唱|翻奏/,
    /\bsped[ -]?up\b|\bspeed[ -]?up\b|加速/,
    /\bslowed\b|\bslow[ -]?down\b|减速|減速|慢速/,
    /\bacoustic\b|不插电|不插電/,
  ].map(pattern => pattern.test(value)).join(',');
}

/** Durations are seconds. Album evidence cannot rescue an artist mismatch. */
export function rankFallbackCandidates(songInfo = {}, candidates = []) {
  const title = String(songInfo?.title || ''), artist = artistString(songInfo?.artist);
  if (!hasText(title) || !hasText(artist) || title.length > 512 || artist.length > 512 || !Array.isArray(candidates)) return [];
  const targetTitle = normalized(title), targetVersion = versions(title);
  const targetDuration = Number(songInfo.duration);
  return candidates.flatMap((candidate, index) => {
    if (!candidate || !hasText(candidate.title)) return [];
    const otherArtist = artistString(candidate.artist);
    if (!hasText(otherArtist) || candidate.title.length > 512 || otherArtist.length > 512 || versions(candidate.title) !== targetVersion) return [];
    const duration = Number(candidate.duration);
    const knownDuration = finite(targetDuration) && targetDuration > 0 && finite(duration) && duration > 0;
    const difference = knownDuration ? Math.abs(targetDuration - duration) : 0;
    if (difference > 4) return [];
    const titleMatch = similarity(targetTitle, normalized(candidate.title));
    const artistMatch = artistScore(artist, otherArtist);
    if (titleMatch < 0.94 || artistMatch < 0.94 || titleMatch * 0.6 + artistMatch * 0.4 < 0.965) return [];
    if (!knownDuration && (titleMatch !== 1 || artistMatch < 0.97)) return [];
    const albumMatch = songInfo.album && candidate.album
      ? similarity(normalized(String(songInfo.album).slice(0, 512)), normalized(String(candidate.album).slice(0, 512))) : null;
    const score = (albumMatch == null ? titleMatch * 0.6 + artistMatch * 0.4
      : Math.max(titleMatch * 0.6 + artistMatch * 0.4, titleMatch * 0.55 + artistMatch * 0.35 + albumMatch * 0.1)) * 100 - difference * 0.25;
    return [{ candidate: { ...candidate, matchScore: Math.round(score * 100) / 100 }, difference, albumMatch: albumMatch || 0, index }];
  }).sort((a, b) => b.candidate.matchScore - a.candidate.matchScore || b.albumMatch - a.albumMatch
    || a.difference - b.difference || a.index - b.index).map(item => item.candidate);
}

function sourceLines(content) {
  if (typeof content !== 'string' || content.length > MAX_CONTENT) throw new Error('Lyrics content limit');
  const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  if (lines.length > MAX_LINES) throw new Error('Lyrics line limit');
  return lines;
}

function tagOf(line) {
  const match = /^\s*\[([a-z][\w-]*):([^\]]*)\]\s*$/i.exec(line);
  return match ? [match[1].toLowerCase(), match[2]] : null;
}

function timestamp(value, compact = false) {
  const match = /^(\d{1,4}):(\d{1,2})(?:[.:](\d{1,9}))?$/.exec(value);
  if (match && Number(match[2]) < 60) {
    const result = Number(match[1]) * 60000 + Number(match[2]) * 1000 + Math.floor(Number('0.' + (match[3] || '0')) * 1000 + 0.00001);
    return timed(result) ? result : null;
  }
  // Qishui translation may concatenate seconds and centiseconds: 1094 = 10.94s.
  const packed = compact && /^(\d{1,4}):(\d{3,4})$/.exec(value);
  if (packed && Number(packed[2]) < 6000) {
    const result = Number(packed[1]) * 60000 + Number(packed[2]) * 10;
    return timed(result) ? result : null;
  }
  return null;
}

function boundaryWords(body, start, compact) {
  const matches = [...body.matchAll(/<([\d:.]+)>|\[([\d:.]+)\]/g)]
    .map(match => ({ index: match.index, length: match[0].length, time: timestamp(match[1] || match[2], compact) }));
  if (!matches.length || matches.some(match => match.time == null)) return { text: body, words: [] };
  let cursor = 0, previous = start, valid = true;
  const words = [];
  for (const match of matches) {
    const text = body.slice(cursor, match.index);
    if (match.time < previous) valid = false;
    if (text) words.push({ text, start: previous, end: match.time });
    previous = match.time;
    cursor = match.index + match.length;
  }
  if (cursor < body.length) words.push({ text: body.slice(cursor), start: previous, end: null });
  return { text: words.map(word => word.text).join(''), words: valid ? words : [] };
}

function applyOffset(parsed) {
  const offset = Number(parsed.tags.offset || 0);
  if (!finite(offset) || Math.abs(offset) > MAX_TIME) return parsed;
  for (const line of parsed.lines) {
    if (line.start == null) continue;
    line.start = Math.max(0, line.start + offset);
    if (line.end != null) line.end = Math.max(line.start, line.end + offset);
    for (const word of line.words) {
      word.start = Math.max(0, word.start + offset);
      if (word.end != null) word.end = Math.max(word.start, word.end + offset);
    }
  }
  return parsed;
}

function parseLrc(content, compact = false) {
  const lines = [], tags = {};
  let wordCount = 0;
  for (const raw of sourceLines(content)) {
    const tag = tagOf(raw);
    if (tag) { tags[tag[0]] = tag[1]; continue; }
    let body = raw.replace(/^\s*(?=\[)/, '');
    const starts = [];
    while (true) {
      const match = /^\[([\d:.]+)\]/.exec(body);
      if (!match) break;
      const value = timestamp(match[1], compact);
      if (value == null) break;
      starts.push(value);
      body = body.slice(match[0].length);
    }
    if (!starts.length) {
      if (hasText(raw) && !/^\s*\[/.test(raw)) lines.push({ text: raw, start: null, end: null, words: [] });
      continue;
    }
    const parsed = boundaryWords(body, starts[0], compact);
    for (const start of starts) {
      if (lines.length >= MAX_LINES || wordCount + parsed.words.length > MAX_WORDS) throw new Error('Lyrics timing limit');
      const shift = start - starts[0];
      const words = parsed.words.map(word => ({ ...word, start: word.start + shift, end: word.end == null ? null : word.end + shift }));
      lines.push({ text: parsed.text, start, end: null, words });
      wordCount += words.length;
    }
    if (lines.length > MAX_LINES || wordCount > MAX_WORDS) throw new Error('Lyrics timing limit');
  }
  return applyOffset({ lines, tags });
}

function parseWordFormat(content, format) {
  const lines = [], tags = {};
  let wordCount = 0;
  for (const raw of sourceLines(content)) {
    const tag = tagOf(raw);
    if (tag) { tags[tag[0]] = tag[1]; continue; }
    const match = /^\s*\[(\d+),(\d+)\](.*)$/.exec(raw);
    if (!match) continue;
    const start = Number(match[1]), end = start + Number(match[2]), body = match[3];
    if (!timed(start) || !timed(end)) continue;
    const pattern = format === 'krc' ? /(?:\[\d+,\d+\])?<([0-9]+),([0-9]+),[0-9]+>/g
      : /(?:\[\d+,\d+\])?\(([0-9]+),([0-9]+),[0-9]+\)/g;
    const tokens = [...body.matchAll(pattern)];
    const prefix = tokens.length ? body.slice(0, tokens[0].index) : body;
    let valid = tokens.length > 0 && prefix.length === 0;
    const words = tokens.map((token, index) => {
      const wordStart = Number(token[1]) + (format === 'krc' ? start : 0);
      const wordEnd = wordStart + Number(token[2]);
      if (!timed(wordStart) || !timed(wordEnd) || wordStart < start
        || (end > start && wordEnd > end + 2000)) valid = false;
      return { text: body.slice(token.index + token[0].length, tokens[index + 1]?.index ?? body.length), start: wordStart, end: wordEnd };
    });
    const text = prefix + words.map(word => word.text).join('');
    lines.push({ text, start, end, words: valid ? words : [], explicitWords: valid && words.some(word => hasText(word.text) && word.end > word.start) });
    wordCount += words.length;
    if (wordCount > MAX_WORDS) throw new Error('Lyrics word limit');
  }
  if (!lines.length && /^\s*\[\d+:\d{1,2}(?:[.:]\d+)?\]/m.test(content)) return parseLrc(content);
  return applyOffset({ lines, tags });
}

function base64Bytes(encoded) {
  if (typeof encoded !== 'string' || encoded.length > MAX_CONTENT * 1.5) throw new Error('Lyrics base64 limit');
  const decoded = atob(encoded.replace(/\s/g, ''));
  if (decoded.length > MAX_CONTENT) throw new Error('Lyrics byte limit');
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

async function decodeKrc(encoded) {
  const bytes = base64Bytes(encoded);
  if (bytes.length <= 4 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'krc1'
    || typeof DecompressionStream !== 'function') return null;
  const compressed = bytes.slice(4);
  for (let i = 0; i < compressed.length; i++) compressed[i] ^= KRC_KEY[i % KRC_KEY.length];
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true }), parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CONTENT) { await reader.cancel(); return null; }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally { reader.releaseLock(); }
}

function finalize(lines, duration) {
  const ordered = lines.slice().sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  let next = null, lastStart = null;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const line = ordered[i];
    if (line.start == null) continue;
    if (lastStart != null && lastStart > line.start) next = lastStart;
    const wordEnd = Math.max(line.start, ...line.words.map(word => word.end ?? word.start));
    if (line.end == null) line.end = next ?? (timed(duration) && duration > line.start ? duration : wordEnd);
    line.end = Math.max(line.end, wordEnd);
    for (const word of line.words) if (word.end == null) word.end = Math.max(word.start, line.end);
    lastStart = line.start;
  }
  return ordered.filter(line => hasText(line.text));
}

function lowerBound(lines, time) {
  let low = 0, high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].start < time) low = middle + 1; else high = middle;
  }
  return low;
}

// Each auxiliary chooses a bounded nearest target; each target keeps its closest auxiliary.
function timeMatches(targets, auxiliary) {
  const matched = new Map();
  const timedTargets = targets.map((line, index) => ({ ...line, index })).filter(line => line.start != null);
  auxiliary.forEach((line, index) => {
    if (line.start == null) return;
    const position = lowerBound(timedTargets, line.start);
    const options = [timedTargets[position - 1], timedTargets[position]].filter(Boolean);
    options.sort((a, b) => Math.abs(a.start - line.start) - Math.abs(b.start - line.start));
    const target = options[0];
    if (!target) return;
    const difference = Math.abs(target.start - line.start);
    const previous = matched.get(target.index);
    if (difference <= AUX_WINDOW && (!previous || difference < previous.difference)) matched.set(target.index, { index, difference });
  });
  return matched;
}

function bridgeMatches(lines, bridge) {
  const buckets = new Map(), matched = new Map(), used = new Set();
  bridge.forEach((line, index) => {
    const key = normalized(line.text);
    if (key && line.start != null) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(index);
    }
  });
  let last = -1;
  lines.forEach((line, index) => {
    if (line.start == null) return;
    let best = -1, difference = BRIDGE_WINDOW + 1;
    for (const other of buckets.get(normalized(line.text)) || []) {
      const distance = Math.abs(line.start - bridge[other].start);
      if (other > last && !used.has(other) && distance < difference) { best = other; difference = distance; }
    }
    if (best >= 0 && difference <= BRIDGE_WINDOW) { matched.set(index, best); used.add(best); last = best; }
  });
  return matched;
}

function attachAxis(lines, content, field, language, bridge, compact) {
  if (!hasText(content)) return;
  const auxiliary = finalize(parseLrc(content, compact).lines, null).filter(line => line.start != null);
  if (!auxiliary.length) return;
  const direct = timeMatches(lines, auxiliary);
  const viaBridge = bridge.length ? timeMatches(bridge, auxiliary) : new Map();
  const mainToBridge = bridge.length ? bridgeMatches(lines, bridge) : new Map();
  lines.forEach((line, index) => {
    const match = mainToBridge.has(index) ? viaBridge.get(mainToBridge.get(index)) : direct.get(index);
    if (!match) return;
    const text = auxiliary[match.index].text;
    if (field === 'translation') line.translation = { text, lang: language || 'und' };
    else line.romanizedText = text;
  });
}

function attachKrcLanguages(parsed, language) {
  if (!parsed.tags.language) return;
  let content;
  try { content = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64Bytes(parsed.tags.language))).content; } catch { return; }
  if (!Array.isArray(content)) return;
  for (const axis of content) {
    const rows = axis?.lyricContent;
    if (!Array.isArray(rows)) continue;
    // Embedded KRC arrays explicitly refer to original line/word positions.
    const lines = axis.type === 0 ? parsed.lines.filter(line => hasText(line.text)) : parsed.lines;
    if (rows.length !== lines.length) continue;
    lines.forEach((line, index) => {
      const row = rows[index];
      if (!Array.isArray(row) || !row.every(text => typeof text === 'string')) return;
      if (axis.type === 1 && row.length === 1 && hasText(row[0])) line.translation = { text: row[0], lang: language || 'und' };
      if (axis.type === 0 && row.length === line.words.length && row.length) {
        line.romanizedText = row.join(' ');
        line.words.forEach((word, wordIndex) => { word.romanizedText = row[wordIndex]; });
      }
    });
  }
}

/** Null on unsupported, malformed or oversized input allows the next candidate. */
export async function parseFallbackLyrics(payload, songInfo = {}, candidate = {}) {
  try {
    if (!payload || typeof payload.content !== 'string' || !hasText(payload.content)) return null;
    const format = String(payload.format || '').toLowerCase();
    if (!['krc', 'krc-base64', 'yrc', 'lrc', 'text'].includes(format)) return null;
    for (const field of ['content', 'translation', 'romanization', 'lineContent']) {
      if (payload[field] != null && (typeof payload[field] !== 'string'
        || payload[field].length > MAX_CONTENT * (field === 'content' && format === 'krc-base64' ? 1.5 : 1))) return null;
    }
    const content = format === 'krc-base64' ? await decodeKrc(payload.content) : payload.content;
    if (!content) return null;
    let parsed;
    if (format === 'text') parsed = { tags: {}, lines: sourceLines(content).filter(hasText).map(text => ({ text, start: null, end: null, words: [] })) };
    else if (format === 'lrc') parsed = parseLrc(content);
    else parsed = parseWordFormat(content, format === 'yrc' ? 'yrc' : 'krc');
    if (!parsed.lines.some(line => hasText(line.text))) return null;
    if (format === 'krc' || format === 'krc-base64') attachKrcLanguages(parsed, payload.language);
    const duration = Number(songInfo?.duration || candidate?.duration) * 1000;
    const lines = finalize(parsed.lines, duration);
    const bridge = hasText(payload.lineContent) ? finalize(parseLrc(payload.lineContent).lines, duration).filter(line => line.start != null) : [];
    attachAxis(lines, payload.translation, 'translation', payload.language, bridge, format === 'krc' || format === 'krc-base64');
    attachAxis(lines, payload.romanization, 'romanizedText', '', bridge, false);
    const data = lines.map(line => ({
      text: line.text, startTime: (line.start ?? 0) / 1000, endTime: (line.end ?? 0) / 1000,
      duration: line.start == null ? 0 : Math.max(0, line.end - line.start) / 1000,
      syllabus: line.words.filter(word => word.text.length > 0).map(word => ({
        text: word.text, time: word.start, duration: Math.max(0, word.end - word.start),
        ...(word.romanizedText != null ? { romanizedText: word.romanizedText } : {}),
      })),
      ...(line.translation ? { translation: line.translation } : {}),
      ...(line.romanizedText ? { romanizedText: line.romanizedText } : {}),
    }));
    const { language: encodedLanguage, ...tags } = parsed.tags;
    const lineTiming = lines.some(line => line.start != null);
    const result = { type: lineTiming ? 'Line' : 'None', data, metadata: {
      format, tags, lineTiming,
      wordTiming: lines.some(line => line.explicitWords === true && line.words.some(word => hasText(word.text) && word.end > word.start)),
      ...(payload.language ? { language: payload.language } : {}),
    } };
    const precision = lyricsPrecision(result);
    if (!precision) return null;
    result.type = precision === 3 ? 'Word' : precision === 2 ? 'Line' : 'None';
    return result;
  } catch { return null; }
}

