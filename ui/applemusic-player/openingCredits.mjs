// SPDX-License-Identifier: AGPL-3.0-only AND GPL-3.0-only
// Adapted from Tcrrry-Lyrics-Plugin's OpeningCreditsPolicy.kt for YouLyPlus display data.

function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/\uFEFF/g, '')
    .replace(/\u200B/g, '')
    .trim();
}

function labelKey(text) {
  return normalize(text)
    .toLowerCase()
    .replace(/[\s()\[\]【】·・]/gu, '');
}

const ROLES = new Set([
  '作词', '作詞', '作曲', '词曲', '詞曲', '编曲', '編曲', '词', '詞', '曲',
  '制作人', '製作人', '音乐制作', '音樂製作', '制作公司', '製作公司',
  '发行', '發行', '发行公司', '發行公司', '出品', '出品人', '出品公司',
  '混音', '混音师', '混音師', '录音', '錄音', '录音师', '錄音師',
  '母带', '母帶', '母带工程师', '母帶工程師', '监制', '監製', '制作统筹', '製作統籌',
  '演唱', '歌手', '和声', '和聲', '合声', '合聲', '和音', 'Rap', '录制', '錄製', '经纪公司', '經紀公司', '和声编写', '和聲編寫', '吉他', '吉它', '贝斯', '貝斯',
  '钢琴', '鋼琴', '弦乐', '弦樂', '弦乐团', '弦樂團', '鼓', '版权', '版權', 'OP', 'SP',
  'lyrics', 'lyrics by', 'lyricist', 'composer', 'composed by', 'arranger', 'arranged by',
  'producer', 'produced by', 'mixed by', 'mastered by', 'recorded by', 'vocal', 'vocals',
  '键盘', '鍵盤', '配唱', '配唱制作人', '配唱製作人', '人声编辑', '人聲編輯',
  '人声监制', '人聲監製', '录音工程师', '錄音工程師', '混音工程师', '混音工程師',
  '录音室', '錄音室', '混音室', '母带室', '母帶室', '音乐总监', '音樂總監',
  '执行制作', '執行製作', '执行制作人', '執行製作人', '统筹', '統籌', '企划', '企劃',
  '制作', '製作', '音乐制作人', '音樂製作人', '母带处理', '母帶處理',
  '歌词提供', '歌詞提供', '作詞家', '作曲家', '編曲家',
  'music by', 'written by', 'arrangement', 'music producer', 'vocal producer', 'vocal production',
  'vocal editing', 'vocal recording', 'vocal arranger', 'backing vocal', 'backing vocals',
  'background vocals', 'harmony', 'keyboard', 'keyboards', 'guitar', 'guitars', 'drum', 'drums',
  'bass', 'piano', 'strings', 'string arrangement', 'recording engineer', 'recording studio',
  'mixing', 'mixing engineer', 'mastering', 'mastering engineer', 'executive producer',
  'programming', 'publisher', 'copyright', 'production', 'label', 'music', 'words',
  '作词人', '作詞人', '作曲人', '编曲人', '編曲人', '词作者', '詞作者', '曲作者',
  '混音母带', '混音母帶', '母带制作', '母帶製作', '配唱制作', '配唱製作', '配唱监制', '配唱監製',
  '人声处理', '人聲處理', '音频编辑', '音頻編輯', '弦乐编写', '弦樂編寫', '弦乐编配', '弦樂編配',
  '录音棚', '錄音棚', '音乐监制', '音樂監製', '总监', '總監', '版权公司', '版權公司',
  'supervisor', 'music supervisor', 'mastering producer', 'mixing mastering', 'audio editing', 'audio engineer'
].map(labelKey));

const SEPARATORS = /\s*[/／&＆、+・·]\s*/u;
const HAN_LATIN_ROLE = /^(\p{Script=Han}+)([a-z]+)$/u;
const LATIN_HAN_ROLE = /^([a-z]+)(\p{Script=Han}+)$/u;
const BYLINE = /^(?:lyrics|music|words|composed|arranged|produced|written|mixed|mastered|recorded|performed)\s+by\s+\S.*$/i;
const QUALIFIERS = [
  '后期', '後期', '前期', '联合', '聯合', '执行', '執行', '助理',
  '音乐', '音樂', '歌曲', '项目', '項目', '人声', '人聲', '乐器', '樂器', '制作', '製作', '音频', '音頻'
];
const ROLE_BOUNDARY = /\s+|[-·/()\[\]_]/gu;
const VOCAL_LABEL = /^(?:男|女|合|唱|男声|女声|男聲|女聲|合唱|齐唱|齊唱|童声|童聲|旁白|独白|獨白|对白|對白|male|female|all|dialogue|chorus|verse)(?:\s*\([^)]*\))?$/iu;
const DIALOGUE_LABEL = /(?:说|說|问|問|回答|答道|喊道|唱道|said|says|asked|replied)$/iu;
const PRONOUN_LABEL = /^(?:我|你|他|她|它|I\b|you\b|he\b|she\b|we\b|they\b)/iu;
const CHINESE_NAME = /^[\p{Script=Han}]{2,5}(?:[/、][\p{Script=Han}]{2,5})*$/u;
const LATIN_NAME = /^[A-Z][\p{L}.'-]*(?: [A-Z][\p{L}.'-]*){0,3}$/u;
const COPYRIGHT_ROLE = /^(?:词|詞|曲|词曲|詞曲)?(?:op|sp)(?:\([^()]{1,60}\))?$/i;

function isRoleKey(key, depth) {
  if (ROLES.has(key)) return true;
  if (depth >= 4) return false;

  // Check after each qualifier. For example, “音乐制作公司” must not collapse to “公司”.
  if (QUALIFIERS.some(qualifier => key.startsWith(qualifier)
    && isRoleKey(key.slice(qualifier.length), depth + 1))) return true;

  const suffixes = [
    '制作人', '製作人', '工程师', '工程師', '助理', 'producer', 'engineer',
    '演唱', '监制', '監製', '录音', '錄音', '录音师', '錄音師', '录音室', '錄音室',
    '录音棚', '錄音棚', '编写', '編寫', '编配', '編配'
  ];
  if (suffixes.some(suffix => key.endsWith(suffix) && key.length > suffix.length
    && ROLES.has(key.slice(0, -suffix.length)))) return true;

  const match = HAN_LATIN_ROLE.exec(key) || LATIN_HAN_ROLE.exec(key);
  if (!match) return false;
  const parts = match.slice(1).filter(Boolean);
  if (parts.every(part => isRoleKey(part, depth + 1))) return true;
  return parts.some(part => [...part].length >= 2
    && [...part].every(character => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 0x4e00 && codePoint <= 0x9fff;
    })
    && isRoleKey(part, depth + 1));
}

function isRole(label) {
  return COPYRIGHT_ROLE.test(normalize(label).replace(/\s/gu, ''))
    || isRoleKey(labelKey(label), 0);
}

function titleKey(text) {
  let title = normalize(text);
  // Providers append OST/version annotations to short catalog titles.
  while (title.endsWith(')')) {
    let depth = 0;
    let opening = -1;
    for (let index = title.length - 1; index >= 0; index -= 1) {
      if (title[index] === ')') depth += 1;
      if (title[index] === '(') depth -= 1;
      if (depth === 0) {
        opening = index;
        break;
      }
    }
    if (opening <= 0) break;
    title = title.slice(0, opening).trimEnd();
  }
  return labelKey(title);
}

function unwrapped(text) {
  let value = normalize(text);
  const wrappers = [['(', ')'], ['[', ']'], ['【', '】']];
  for (let pass = 0; pass < 3; pass += 1) {
    if (value.length > 2 && wrappers.some(([open, close]) => value.startsWith(open) && value.endsWith(close))) {
      value = value.slice(1, -1).trim();
    }
  }
  return value;
}

function protectedLabel(label) {
  return VOCAL_LABEL.test(label) || DIALOGUE_LABEL.test(label) || PRONOUN_LABEL.test(label);
}

function roleLabel(label) {
  return isRole(label) || label.split(SEPARATORS).every(part => isRole(part));
}

function field(text) {
  const colon = text.indexOf(':');
  if (colon < 1 || colon > 128) return null;
  const label = text.slice(0, colon).trim();
  const value = text.slice(colon + 1).trim();
  if (!value || !/\p{L}/u.test(label)
    || [...label].some(character => '，。？！!?;；…'.includes(character))
    || protectedLabel(label)) return null;
  return [label, value];
}

function isCredit(text) {
  const normalized = unwrapped(text);
  if (BYLINE.test(normalized)) return true;
  if (normalized.includes(':')) {
    const parsedField = field(normalized);
    return !!parsedField && roleLabel(parsedField[0]);
  }
  ROLE_BOUNDARY.lastIndex = 0;
  for (const boundary of normalized.matchAll(ROLE_BOUNDARY)) {
    if (boundary.index > 128) break;
    const label = normalized.slice(0, boundary.index).trim();
    const value = normalized.slice(boundary.index + boundary[0].length)
      .replace(/^[ \])/]+|[ \])/]+$/gu, '');
    if (label.length >= 2 && value.trim() && !protectedLabel(label) && roleLabel(label)) return true;
  }
  return false;
}

function isFiller(text) {
  return text.trim() === '' || (text.length <= 8 && !/[\p{L}\p{N}]/u.test(text));
}

function isName(text) {
  if (text.trim() === '' || protectedLabel(text)) return false;
  return CHINESE_NAME.test(text) || LATIN_NAME.test(text)
    || text.includes('@') || text.endsWith('公司') || text.endsWith('工作室');
}

function textOf(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function artistText(value) {
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(', ');
  return textOf(value);
}

function openingCreditCount(provider, lines, title, artist, starts) {
  const texts = lines.map(unwrapped);
  const fillers = texts.map(isFiller);
  const fields = texts.map(field);
  const labelOnly = texts.map(text => text.length >= 2 && roleLabel(text));
  const explicitCredit = texts.map((text, index) => !labelOnly[index] && isCredit(text));
  const pairedLabel = texts.map((text, index) => labelOnly[index] && isName(texts[index + 1] ?? ''));
  const names = texts.map((text, index) => index > 0 && pairedLabel[index - 1]);
  const credit = texts.map((text, index) => explicitCredit[index] || pairedLabel[index]);
  const repeated = new Map();
  for (const text of texts) {
    const key = labelKey(text);
    repeated.set(key, (repeated.get(key) || 0) + 1);
  }
  const structural = texts.map((text, index) => fields[index] !== null
    && repeated.get(labelKey(text)) === 1);

  function isHeader(index) {
    if (index > 8 || (starts[index] != null && starts[index] > 5000)) return false;
    const text = labelKey(lines[index]);
    const song = titleKey(title);
    const singer = labelKey(artist);
    const matches = (song && titleKey(lines[index]) === song)
      || (singer && song && ['-', '–', '—', '·', '/']
        .some(separator => text === labelKey(`${title}${separator}${artist}`)));

    const following = [];
    for (let cursor = index + 1; cursor < lines.length && following.length < 6; cursor += 1) {
      if (!(credit[cursor] || structural[cursor] || names[cursor] || fillers[cursor])) break;
      following.push(cursor);
    }
    const count = following.filter(cursor => credit[cursor]).length;
    if (count < 2 && !following.some(cursor => explicitCredit[cursor])) return false;

    const densityEnd = following.length ? following[following.length - 1] : index;
    const dense = starts[index] != null && starts[densityEnd] != null
      && starts[densityEnd] >= starts[index] && starts[densityEnd] - starts[index] <= 10000;

    const headerMatch = /^(.*?)\s+[-–—]\s+(.+)$/u.exec(normalize(lines[index]));
    const matchingTitleHeader = !!headerMatch && headerMatch[2].trim() !== ''
      && ((song && titleKey(headerMatch[1]) === song)
        || (!song && provider === 'qq' && dense && count >= 3));
    return (matches && count >= (dense ? 1 : 2))
      || (matchingTitleHeader && count >= 2);
  }

  const headers = texts.map((text, index) => isHeader(index));
  let candidateLength = 0;
  while (candidateLength < texts.length) {
    const index = candidateLength;
    if (!(fillers[index] || headers[index] || credit[index] || names[index] || structural[index])) break;
    candidateLength += 1;
  }

  const candidateCreditCount = credit.slice(0, candidateLength).filter(Boolean).length;
  let end = candidateLength;
  if (candidateCreditCount < 2) {
    end = 0;
    while (end < candidateLength
      && (fillers[end] || headers[end] || explicitCredit[end])) end += 1;
  }

  if (end < texts.length) {
    const next = texts[end];
    const nextLabel = next.includes(':') ? next.slice(0, next.indexOf(':')).trim() : '';
    if ((next.includes(':') && protectedLabel(nextLabel))
      || (repeated.get(labelKey(next)) || 0) > 1) {
      // Unknown rows directly before dialogue or a repeated verse may be sung text too.
      while (end > 0 && (fillers[end - 1] || (structural[end - 1] && !credit[end - 1]))) end -= 1;
    }
  }

  // Keep the supplied lines when the filter would leave an empty lyric view.
  return end === texts.length ? 0 : end;
}

export function filterOpeningCredits(lyrics, enabled, songInfo = {}) {
  if (enabled !== true || !Array.isArray(lyrics?.data) || lyrics.data.length === 0) return lyrics;
  const provider = textOf(lyrics.provider || lyrics.metadata?.provider).trim().toLowerCase();
  if (provider !== 'qq' && provider !== 'netease') return lyrics;

  const lines = lyrics.data.map(line => typeof line?.text === 'string' ? line.text : '');
  const starts = lyrics.data.map(line => lyrics.type !== 'None' && Number.isFinite(line?.startTime)
    ? Math.max(0, Math.round(line.startTime * 1000))
    : null);
  const matched = lyrics.metadata?.matchedSong;
  const title = textOf(matched?.title) || textOf(songInfo?.title);
  const artist = artistText(matched?.artist) || artistText(songInfo?.artist);
  const hidden = openingCreditCount(provider, lines, title, artist, starts);
  if (hidden === 0) return lyrics;
  return { ...lyrics, data: lyrics.data.slice(hidden) };
}
