import { CONFIG } from '../constants.js';
import { Utilities } from '../utils/utilities.js';
import { createRomanizationPrompt } from '../services/translation/prompts.js';
import { SchemaBuilder } from './schemaBuilder.js';
import { GoogleService } from '../services/googleService.js';
import {
  prepareUnitLines,
  createUnitSchema,
  createUnitPrompt,
  createUnitRepairPrompt,
  parseUnitAnswer,
  isUnitAnswerValid,
  applyUnitReadings,
} from './unitRomanization.js';

export class GeminiRomanizer {
  constructor(settings, { requestContent, providerName = 'Gemini' } = {}) {
    this.settings = settings;
    this.requestContent = requestContent;
    this.providerName = providerName;
    this.modelName = settings.geminiRomanizationModel;
    this.url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${settings.geminiApiKey}`;
  }

  async romanize(structuredInput, songInfo = {}, targetLang, targetScript = 'latin') {
    // Latin output follows the per-unit contract: one reading string per timed
    // unit, so no free-text alignment step is needed.
    if (targetScript === 'latin') {
      return this.romanizeUnits(structuredInput, songInfo, targetScript);
    }

    const { lyricsForApi, reconstructionPlan } = this.prepareLyrics(structuredInput, targetScript);
    const hasAnyChunks = lyricsForApi.some(line => line.chunk && line.chunk.length > 0);

    if (lyricsForApi.length === 0) {
      return this.reconstructLyrics([], reconstructionPlan, hasAnyChunks);
    }

    const initialPrompt = this.createInitialPrompt(lyricsForApi, hasAnyChunks, songInfo, targetLang, targetScript);
    const schema = SchemaBuilder.buildRomanizationSchema(hasAnyChunks);

    const contents = [{ role: 'user', parts: [{ text: initialPrompt }] }];
    const validResultsMap = new Map();

    let responseText;
    let lastError = null;
    const maxAttempts = 3;

    let lastBrokenIndices = [];

    // Ask the provider up to 3 times to repair missing/unromanized lines.
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        responseText = await this.callGeminiAPI(contents, schema);
        const cleanedText = this.cleanJsonOutput(responseText);
        let parsedJson;

        try {
          parsedJson = JSON.parse(cleanedText);
        } catch (jsonErr) {
          if (attempt < maxAttempts) {
            contents.push({ role: 'model', parts: [{ text: responseText || '' }] });
            contents.push({
              role: 'user',
              parts: [{ text: `Your previous response was not valid JSON. Please provide valid JSON adhering to the schema. Error: ${jsonErr.message}` }]
            });
            continue;
          } else {
            throw jsonErr;
          }
        }

        const returnedLines = Array.isArray(parsedJson)
          ? parsedJson
          : (parsedJson?.romanized_lyrics || parsedJson?.fixed_lines || []);

        if (Array.isArray(returnedLines)) {
          returnedLines.forEach((retLine, i) => {
            if (!retLine) return;
            let lineIndex = -1;
            if (typeof retLine.original_line_index === 'number') {
              lineIndex = retLine.original_line_index;
            } else if (returnedLines.length === lyricsForApi.length) {
              lineIndex = i;
            } else if (lastBrokenIndices.length > 0 && returnedLines.length === lastBrokenIndices.length) {
              lineIndex = lastBrokenIndices[i];
            }

            if (lineIndex >= 0 && lineIndex < lyricsForApi.length) {
              const origLine = lyricsForApi[lineIndex];
              if (this.isLineValid(origLine, retLine, targetScript)) {
                validResultsMap.set(lineIndex, {
                  ...retLine,
                  original_line_index: lineIndex
                });
              }
            }
          });
        }

        const brokenLineIndices = [];
        lyricsForApi.forEach((origLine, index) => {
          if (!validResultsMap.has(index)) {
            brokenLineIndices.push(index);
          }
        });
        lastBrokenIndices = brokenLineIndices;

        if (brokenLineIndices.length === 0) {
          console.log(`${this.providerName} romanization completed successfully on attempt ${attempt}`);
          break;
        }

        if (attempt < maxAttempts) {
          console.warn(`${this.providerName} romanization attempt ${attempt}: ${brokenLineIndices.length} broken/missing line(s) [indices: ${brokenLineIndices.join(', ')}]. Sending targeted repair user prompt.`);

          const brokenLinesForApi = brokenLineIndices.map(idx => lyricsForApi[idx]);

          contents.push({ role: 'model', parts: [{ text: responseText || '' }] });
          contents.push({
            role: 'user',
            parts: [{
              text: `Your previous response was missing, incomplete, or contained text that was not fully transliterated into the target script for line index(es): [${brokenLineIndices.join(', ')}].

Please fix and return ONLY the transliteration for these broken line(s) below as {"romanized_lyrics": [the corrected line objects]}:

${JSON.stringify(brokenLinesForApi, null, 2)}

Requirements:
1. Include ONLY the broken line(s) requested above. Do NOT include previously valid lines.
2. Every item MUST include its correct "original_line_index" matching the input (${brokenLineIndices.join(', ')}).
3. The "text" field (and "chunk" text fields if chunks were provided) MUST be fully transliterated into the target script ("${targetScript}"). Do NOT leave source-script text.`
            }]
          });
        } else {
          console.warn(`${this.providerName} romanization reached max attempts (${maxAttempts}). Proceeding with best-effort results for remaining ${brokenLineIndices.length} line(s).`);
        }

      } catch (e) {
        console.warn(`${this.providerName} API call attempt ${attempt} failed:`, e.message);
        lastError = e;
        if (attempt === maxAttempts && validResultsMap.size === 0) {
          throw e;
        }
      }
    }

    if (validResultsMap.size === 0) {
      throw new Error(`${this.providerName} romanization failed: ${lastError?.message || 'No valid transliterated lines were returned.'}`);
    }

    // Align each line using GoogleService.alignRomanizationAnchors directly
    const alignedApiLyrics = lyricsForApi.map((origLine, index) => {
      const retLine = validResultsMap.get(index);

      let chunkTexts = [];
      if (retLine && Array.isArray(retLine.chunk)) {
        chunkTexts = retLine.chunk.map(c => (c && typeof c.text === 'string') ? c.text.trim() : '').filter(Boolean);
      }

      let fullLineRom = '';
      if (retLine && retLine.text) {
        fullLineRom = retLine.text;
      } else if (chunkTexts.length > 0) {
        fullLineRom = chunkTexts.join('');
      } else {
        fullLineRom = origLine.text;
      }

      if (!origLine.chunk || origLine.chunk.length === 0) {
        return {
          text: fullLineRom,
          original_line_index: index
        };
      }

      const originalSyllables = origLine.chunk;
      const M = originalSyllables.length;

      let romanizedGuides = chunkTexts;
      if (romanizedGuides.length !== M) {
        romanizedGuides = originalSyllables.map(s => s.text || '');
      }

      // Direct call to GoogleService's DP Anchor Alignment algorithm
      const alignedChunks = GoogleService.alignRomanizationAnchors(fullLineRom, romanizedGuides, originalSyllables);

      const formattedChunks = originalSyllables.map((s, i) => ({
        text: alignedChunks[i] || ""
      }));

      return {
        text: formattedChunks.map(c => c.text).join(""),
        chunk: formattedChunks,
        original_line_index: index
      };
    });

    return this.reconstructLyrics(alignedApiLyrics, reconstructionPlan, hasAnyChunks);
  }

  /**
   * Per-unit romanization following the ttml-transliterate contract: the model
   * returns exactly one reading per timed unit, so no free-text alignment runs.
   * Latin units are copied verbatim and standalone non-Latin punctuation becomes
   * a single U+200B, both filled locally.
   */
  async romanizeUnits(structuredInput, songInfo = {}, targetScript = 'latin') {
    const { lines, chunked, plan } = prepareUnitLines(structuredInput, targetScript);
    const results = new Map();

    if (lines.length > 0) {
      const schema = createUnitSchema();
      const customPrompt = this.settings.overrideGeminiRomanizePrompt
        ? this.settings.customGeminiRomanizePrompt : '';
      const contents = [{ role: 'user', parts: [{ text: createUnitPrompt(lines, songInfo, customPrompt) }] }];
      const maxAttempts = 3;
      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let parsed = null;
        try {
          const responseText = await this.callGeminiAPI(contents, schema);
          parsed = JSON.parse(this.cleanJsonOutput(responseText));
        } catch (error) {
          lastError = error;
          if (attempt === maxAttempts && results.size === 0) throw error;
          console.warn(this.providerName + ' unit romanization attempt ' + attempt + ' failed:', error.message);
          continue;
        }

        for (const { index, readings } of parseUnitAnswer(parsed, lines.length)) {
          if (!results.has(index) && isUnitAnswerValid(lines[index], readings)) {
            results.set(index, readings);
          }
        }

        const broken = lines.map((_, index) => index).filter(index => !results.has(index));
        if (broken.length === 0) {
          console.log(this.providerName + ' unit romanization completed on attempt ' + attempt);
          break;
        }
        if (attempt === maxAttempts) {
          console.warn(this.providerName + ' unit romanization left ' + broken.length + ' line(s) unread.');
          break;
        }

        console.warn(this.providerName + ' unit romanization attempt ' + attempt + ': repairing ' + broken.length + ' line(s).');
        contents.push({ role: 'model', parts: [{ text: JSON.stringify(parsed) }] });
        contents.push({ role: 'user', parts: [{ text: createUnitRepairPrompt(lines, broken) }] });
      }

      if (results.size === 0) {
        throw new Error(this.providerName + ' romanization failed: '
          + (lastError?.message || 'No valid unit readings were returned.'));
      }
    }

    return plan.map(({ type, data, apiIndex, originalIndex }) => {
      if (type === 'verbatim') {
        return {
          text: data.text,
          ...(data.chunk ? { chunk: data.chunk.map(chunk => ({ text: chunk.text })) } : {}),
          original_line_index: originalIndex,
        };
      }

      const units = lines[apiIndex];
      const readings = applyUnitReadings(units, results.get(apiIndex) || []);
      const result = {
        text: readings.join(''),
        original_line_index: originalIndex,
      };
      if (chunked[apiIndex]) result.chunk = readings.map(text => ({ text }));
      return result;
    });
  }

  isLineValid(origLine, retLine, targetScript = 'latin') {
    if (!retLine || typeof retLine !== 'object') return false;

    if (!retLine.text || typeof retLine.text !== 'string' || retLine.text.trim() === '') {
      return false;
    }

    if (targetScript === 'latin') {
      if (!Utilities.isPurelyLatinScript(retLine.text)) {
        return false;
      }
      if (retLine.text.trim() === origLine.text.trim()) {
        return false;
      }
    } else {
      if (!Utilities.containsScript(retLine.text, targetScript)) {
        return false;
      }
      if (retLine.text.trim() === origLine.text.trim()) {
        return false;
      }
    }

    if (origLine.chunk && Array.isArray(origLine.chunk) && origLine.chunk.length > 0) {
      if (!Array.isArray(retLine.chunk) || retLine.chunk.length === 0) {
        return false;
      }
      for (const c of retLine.chunk) {
        if (!c || typeof c.text !== 'string' || c.text.trim() === '') return false;
        if (targetScript === 'latin') {
          if (!Utilities.isPurelyLatinScript(c.text)) return false;
        } else {
          if (!Utilities.containsScript(c.text, targetScript)) return false;
        }
      }
    }

    return true;
  }

  async callGeminiAPI(contents, schema) {
    if (this.requestContent) return this.requestContent(contents, schema);

    const isGemma = this.modelName.toLowerCase().includes("gemma");

    const generationConfig = {
      temperature: 0.0
    };

    if (!isGemma) {
      generationConfig.response_mime_type = "application/json";
      generationConfig.responseSchema = schema;
    }

    const requestBody = {
      contents,
      generation_config: generationConfig
    };

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: { message: response.statusText }
      }));
      throw new Error(`Gemini API call failed with status ${response.status}: ${errorData.error.message}`);
    }

    const data = await response.json();

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
    }

    return data.candidates[0].content.parts[0].text;
  }

  cleanJsonOutput(text) {
    if (!text) return "";
    return text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "");
  }

  prepareLyrics(structuredInput, targetScript = 'latin') {
    const lyricsForApi = [];
    const reconstructionPlan = [];
    const contentToApiIndexMap = new Map();

    structuredInput.forEach((line, originalIndex) => {
      // Lines already written in the requested target script are passed through unchanged.
      if (Utilities.isInTargetScript(line.text, targetScript)) {
        reconstructionPlan.push({ type: 'latin', data: line, originalIndex });
        return;
      }

      const contentKey = JSON.stringify({ text: line.text, chunk: line.chunk });

      if (contentToApiIndexMap.has(contentKey)) {
        reconstructionPlan.push({
          type: 'api',
          apiIndex: contentToApiIndexMap.get(contentKey),
          originalIndex
        });
      } else {
        const newApiIndex = lyricsForApi.length;
        const apiLine = { text: line.text, original_line_index: newApiIndex };

        if (line.chunk && line.chunk.length > 0) {
          apiLine.chunk = line.chunk;
        }

        lyricsForApi.push(apiLine);
        contentToApiIndexMap.set(contentKey, newApiIndex);
        reconstructionPlan.push({ type: 'api', apiIndex: newApiIndex, originalIndex });
      }
    });

    return { lyricsForApi, reconstructionPlan };
  }

  reconstructLyrics(romanizedApiLyrics, reconstructionPlan, hasAnyChunks) {
    const fullList = [];

    reconstructionPlan.forEach(planItem => {
      let reconstructedLine;

      if (planItem.type === 'latin') {
        reconstructedLine = {
          ...planItem.data,
          text: planItem.data.text,
          chunk: hasAnyChunks && planItem.data.chunk
            ? planItem.data.chunk.map(c => ({ ...c, text: c.text }))
            : undefined,
          original_line_index: planItem.originalIndex
        };
      } else {
        const apiResult = romanizedApiLyrics[planItem.apiIndex];
        reconstructedLine = {
          ...apiResult,
          original_line_index: planItem.originalIndex
        };
      }

      fullList[planItem.originalIndex] = reconstructedLine;
    });

    return fullList;
  }

  createInitialPrompt(lyricsForApi, hasAnyChunks, songInfo = {}, targetLang, targetScript = 'latin') {
    const { overrideGeminiRomanizePrompt, customGeminiRomanizePrompt } = this.settings;

    if (overrideGeminiRomanizePrompt && customGeminiRomanizePrompt) {
      const songContext = (songInfo.title && songInfo.artist)
        ? `\n# SONG CONTEXT\n- Title: ${songInfo.title}\n- Artist: ${songInfo.artist}\n`
        : '';
      return songContext + customGeminiRomanizePrompt
        + `\n\n# TARGET SCRIPT\n${targetScript}\n\n# INPUT DATA TO TRANSLITERATE\n${JSON.stringify(lyricsForApi, null, 2)}`;
    }

    return createRomanizationPrompt(lyricsForApi, hasAnyChunks, songInfo, targetLang, targetScript);
  }
}
