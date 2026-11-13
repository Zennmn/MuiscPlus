import { Utilities } from '../utils/utilities.js';

// The skill contract reserves one zero-width space for a standalone non-Latin
// punctuation unit: an empty string or a self-closing span would be merged into
// the previous unit by the Apple TTML importer.
export const ZERO_WIDTH = '\u200B';

/** A unit carrying no letters or digits is a standalone punctuation mark. */
export const isPunctuationUnit = text => !/[\p{L}\p{N}]/u.test(text || '');

/**
 * Units already written in Latin script are copy slots, never readings.
 * isPurelyLatinScript also accepts \p{P}, so a bare CJK mark would qualify; a
 * punctuation slot is therefore handled before this check everywhere.
 */
export const isVerbatimUnit = text => !isPunctuationUnit(text) && Utilities.isPurelyLatinScript(text || '');

/**
 * Punctuation belongs to the text it follows or precedes: a mark next to Latin
 * units is part of that Latin phrase and is copied, while a mark inside
 * non-Latin text is decoration and is hidden.
 */
function isLatinContext(units, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (!isPunctuationUnit(units[i])) return isVerbatimUnit(units[i]);
  }
  for (let i = index + 1; i < units.length; i++) {
    if (!isPunctuationUnit(units[i])) return isVerbatimUnit(units[i]);
  }
  return false;
}

/**
 * Builds the one-reading-per-timed-unit input described by the skill. Lines that
 * are already Latin stay untouched, and repeated lines share a single slot.
 */
export function prepareUnitLines(structuredInput, targetScript = 'latin') {
  const lines = [];
  const chunked = [];
  const plan = [];
  const seen = new Map();

  structuredInput.forEach((line, originalIndex) => {
    if (Utilities.isInTargetScript(line.text, targetScript)) {
      plan.push({ type: 'verbatim', data: line, originalIndex });
      return;
    }

    // Blank and punctuation-only lines have nothing to read: the empty string
    // and the zero-width placeholder already satisfy the contract.
    if (!/[\p{L}\p{N}]/u.test(line.text || '')) {
      plan.push({ type: 'verbatim', data: line, originalIndex });
      return;
    }

    const hasChunks = Array.isArray(line.chunk) && line.chunk.length > 0;
    const units = hasChunks ? line.chunk.map(chunk => chunk.text || '') : [line.text || ''];
    const key = JSON.stringify(units);

    if (seen.has(key)) {
      plan.push({ type: 'api', apiIndex: seen.get(key), originalIndex });
      return;
    }

    const apiIndex = lines.length;
    lines.push(units);
    chunked.push(hasChunks);
    seen.set(key, apiIndex);
    plan.push({ type: 'api', apiIndex, originalIndex });
  });

  return { lines, chunked, plan };
}

export function createUnitSchema() {
  return {
    type: 'OBJECT',
    properties: {
      lines: {
        type: 'ARRAY',
        description: 'One entry per input line, in input order.',
        items: {
          type: 'OBJECT',
          properties: {
            i: { type: 'INTEGER', description: 'The line index from the input.' },
            readings: {
              type: 'ARRAY',
              description: 'Exactly one reading string per input unit, in the same order.',
              items: { type: 'STRING' },
            },
          },
          required: ['i', 'readings'],
        },
      },
    },
    required: ['lines'],
  };
}

const CONTRACT = [
  'You convert timed lyric units into Latin-alphabet readings of how they are sung.',
  '',
  '# OUTPUT CONTRACT (hard requirements)',
  '- Return {"lines":[{"i":<line index>,"readings":[...]}]} for every input line, in input order.',
  '- "readings" has exactly one string per input unit, in the same order. Never merge, split, reorder, add or drop units.',
  '- Never return an empty string.',
  '- This is transliteration of sound. Never translate meaning.',
  '',
  '# UNIT RULES',
  '1. A unit already written in Latin script is a copy slot: repeat it character for character, including case, apostrophes, quotes, hyphens, ellipses, other punctuation, symbols and inner whitespace. Never trim it, never normalize it, never swap straight and curly quotes, and never hide it behind a space or a zero-width character.',
  '2. A non-Latin unit keeps the pronunciation only: drop the source punctuation, brackets and decoration (ne? -> ne, 「kimi da -> kimi da, (watashi) -> watashi). Keep the word boundary a removed mark separated. Keep pronunciation-bearing marks such as the apostrophe in shin\'ya.',
  '3. A non-Latin unit with no letters or digits is a standalone punctuation slot: return exactly one U+200B zero-width space.',
  '4. A unit mixing languages keeps its Latin part verbatim and romanizes the rest.',
  '',
  '# READING RULES',
  '## Japanese - Hepburn, long vowels written out (sou, nee, yuuki, too)',
  '- Read kanji from the whole sentence: 私 watashi, 君 kimi; particles は wa, へ e, を o.',
  '- Decide the whole word first, then project it onto the units: 絶|対 -> zet|tai, 思っ|て -> omot|te, ポ|ケッ|ト -> po|ket|to.',
  '- One kanji keeps its whole reading in a single string: 鏡 -> kagami, never ka ga mi. A merged unit groups by the original character boundary: 鏡よ -> kagami yo, 寂しい -> sabi shi i.',
  '- っ doubles the next consonant; ん before a vowel or y is n\'.',
  '- A unit spanning several characters is still one string; put a space where the original word boundary falls.',
  '## Chinese - Hanyu Pinyin, natural word grouping, no tone marks.',
  '## Korean - Revised Romanization with liaison, nasalization and palatalization (한국어 -> hangugeo).',
  '## Other scripts - consistent Latin transcription: Thai RTGS in plain letters without diacritics, Cyrillic practical transcription, Devanagari with schwa deletion, Arabic by the artist dialect, Greek and Hebrew by their standard romanization.',
].join('\n');

export function createUnitPrompt(lines, songInfo = {}, customPrompt = '') {
  const songContext = songInfo.title && songInfo.artist
    ? '# SONG CONTEXT\n- Title: ' + songInfo.title + '\n- Artist: ' + songInfo.artist + '\n\n'
    : '';
  const instructions = customPrompt ? customPrompt + '\n\n' : CONTRACT + '\n\n';
  const input = JSON.stringify(lines.map((units, i) => ({ i, units })));
  return songContext + instructions
    + '# INPUT\n' + input
    + '\n\n# OUTPUT\nReturn {"lines":[{"i":<index>,"readings":[...]}]} covering every line above.';
}

export function createUnitRepairPrompt(lines, brokenIndices) {
  const input = JSON.stringify(brokenIndices.map(i => ({ i, units: lines[i] })));
  return 'These lines are still missing or invalid. Return ONLY them as '
    + '{"lines":[{"i":<index>,"readings":[...]}]}, with exactly one reading per unit '
    + 'in the same order.\n\n' + input;
}

/** Accepts indexed or positional answers, mirroring the tolerant legacy parser. */
export function parseUnitAnswer(parsed, lineCount) {
  const items = Array.isArray(parsed) ? parsed : parsed?.lines;
  if (!Array.isArray(items)) return [];
  const entries = [];
  items.forEach((item, position) => {
    if (!item) return;
    const readings = Array.isArray(item.readings) ? item.readings : null;
    if (!readings) return;
    const index = Number.isInteger(item.i) ? item.i : position;
    if (index < 0 || index >= lineCount) return;
    entries.push({ index, readings });
  });
  return entries;
}

/**
 * Copy slots and punctuation slots are filled locally, so only units that truly
 * need a reading are checked here; that keeps repair rounds rare.
 */
export function isUnitAnswerValid(units, readings) {
  return units.every((unit, index) => {
    if (!unit || isPunctuationUnit(unit) || isVerbatimUnit(unit)) return true;
    const reading = readings[index];
    return typeof reading === 'string'
      && reading.trim() !== ''
      && Utilities.isPurelyLatinScript(reading)
      && /[\p{Script=Latin}]/u.test(reading);
  });
}

/**
 * Applies the contract: copy Latin units verbatim, hide non-Latin punctuation
 * behind a single U+200B, and use the returned reading for everything else.
 */
export function applyUnitReadings(units, readings = []) {
  return units.map((unit, index) => {
    if (!unit) return '';
    if (isPunctuationUnit(unit)) return isLatinContext(units, index) ? unit : ZERO_WIDTH;
    if (isVerbatimUnit(unit)) return unit;
    const reading = readings[index];
    return typeof reading === 'string' && reading.trim() ? reading : unit;
  });
}
