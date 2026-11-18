import { FALLBACK_LYRICS_ORDER, FALLBACK_LYRICS_NAMES, normalizeFallbackLyricsOrder } from "../../lib/appleLyricsSources.js";
import { LyricsFallbackProviders } from "./lyricsFallbackProviders.js";
import { lyricsPrecision, parseFallbackLyrics, rankFallbackCandidates, tcrrryLyricBody } from "../utils/fallbackLyrics.js";
import { resolveTcrrryIdentity } from "../utils/tcrrryLyricsIdentity.js";
import { rankTcrrryCandidates, sameTcrrryRecording, tcrrrySearchPlans } from "../utils/tcrrryLyricsMatch.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 100;
const RESULT_TTL = 6 * 60 * 60 * 1000;
const NO_RESULT_TTL = 60 * 1000;
const TCRRRY_PROVIDERS = new Set(["netease", "kugou", "qq"]);
const TCRRRY_EXACT_MATCH_SCORE = 95;
const HOSTS = new Set([
  "interface.music.163.com", "music.163.com", "c.y.qq.com",
  "songsearch.kugou.com", "krcs.kugou.com", "lyrics.kugou.com", "api.qishui.com", "beta-luna.douyin.com",
  "itunes.apple.com"
]);
const REFERRERS = new Map([
  ["https://music.163.com/api/cloudsearch/pc", "https://music.163.com/"],
  ["https://music.163.com/api/song/lyric", "https://music.163.com/"],
  ["https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp", "https://y.qq.com/"],
  ["https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg", "https://c.y.qq.com/"],
  ["https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg", "https://y.qq.com/"]
]);

let referrerRules;
function prepareReferrers() {
  const api = globalThis.browser || globalThis.chrome;
  if (!api?.declarativeNetRequest?.updateSessionRules || !api.runtime?.getURL) return;
  // A Fetch request cannot set these cross-origin Referer values directly.
  // Restrict the rules to extension-initiated calls to the lyrics API paths.
  const host = new URL(api.runtime.getURL("/")).hostname;
  const addRules = Array.from(REFERRERS, ([endpoint, value], index) => ({
    id: 36100 + index,
    priority: 1,
    action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value }] },
    condition: { regexFilter: `^${endpoint.replaceAll(".", "\\.")}([?]|$)`, initiatorDomains: [host], resourceTypes: ["xmlhttprequest"] }
  }));
  referrerRules ||= api.declarativeNetRequest.updateSessionRules({ addRules, removeRuleIds: addRules.map(rule => rule.id) })
    .catch(error => console.warn("Muisc+ lyrics request headers:", error.message));
  return referrerRules;
}

function tcrrryCoverage(lyrics) {
  const lines = lyrics.data;
  if (lyricsPrecision(lyrics) < 2) return { words: 0, translation: 0, romanization: 0 };
  const percent = predicate => Math.trunc(lines.filter(predicate).length * 100 / lines.length);
  return {
    words: percent(line => line.syllabus?.some(word => word.text.trim() && word.duration > 0)),
    translation: percent(line => line.translation?.text || line.translatedText),
    romanization: percent(line => line.romanizedText)
  };
}

function needsTcrrryEnrichment(lyrics) {
  if (!lyrics || lyrics.metadata.matchScore < TCRRRY_EXACT_MATCH_SCORE) return false;
  const coverage = tcrrryCoverage(lyrics);
  return coverage.words < 80 || (coverage.translation < 80 &&
    lyrics.data.some(line => /[a-z\u3040-\u30ff\uac00-\ud7af]/i.test(line.text)));
}

function tcrrryQuality(lyrics) {
  if (!lyrics) return 0;
  const coverage = tcrrryCoverage(lyrics);
  const hasWords = lyricsPrecision(lyrics) === 3;
  const score = lyrics.metadata.matchScore;
  const confidence = score >= TCRRRY_EXACT_MATCH_SCORE ? 2 : 1;
  return confidence * 1000000 + (hasWords ? 200000 + coverage.words * 1000 : 0)
    + coverage.translation * 200 + coverage.romanization * 50 + score * 100
    + Math.min(tcrrryLyricBody(lyrics.data.map(line => line.text)).length, 40) * 3;
}

/** Metadata matching stays in the extension worker; no account or audio requests. */
export class FallbackLyricsService {
  constructor({ request = (...args) => fetch(...args) } = {}) {
    this.request = request;
    this.results = new Map();
    this.controllers = new Set();
    this.generation = 0;
    this.pending = new Map();
    this.providers = new LyricsFallbackProviders({ requestJSON: (url, options) => this.requestJSON(url, options) });
  }

  async requestJSON(url, { responseType = "json", ...options } = {}) {
    const target = new URL(url);
    if (target.protocol !== "https:" || !HOSTS.has(target.hostname) || target.username || target.password) throw new Error("Unsupported lyrics host");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 6000);
    this.controllers.add(controller);
    try {
      if (REFERRERS.has(target.origin + target.pathname)) await prepareReferrers();
      const response = await this.request(target.href, { ...options, credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
      if (!response.ok) throw new Error(`Lyrics HTTP ${response.status}`);
      const advertised = Number(response.headers?.get?.("content-length"));
      if (advertised > MAX_BYTES) throw new Error("Lyrics response is too large");
      const binary = responseType === "bytes";
      let text;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = binary ? null : new TextDecoder();
        let size = 0;
        const parts = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) { controller.abort(); throw new Error("Lyrics response is too large"); }
            parts.push(binary ? value : decoder.decode(value, { stream: true }));
          }
          if (binary) {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const part of parts) {
              bytes.set(part, offset);
              offset += part.byteLength;
            }
            return bytes;
          }
          parts.push(decoder.decode());
          text = parts.join("");
        } finally { reader.releaseLock(); }
      } else {
        if (binary) {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > MAX_BYTES) throw new Error("Lyrics response is too large");
          return new Uint8Array(buffer);
        }
        text = await response.text();
        if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error("Lyrics response is too large");
      }
      if (responseType === "text") return text;
      // Preserve long platform IDs without touching digits inside JSON strings.
      return JSON.parse(text.replace(/^﻿/, "").replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token =>
        token[0] !== '"' && /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? `"${token}"` : token));
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }

  key(provider, song, manual) {
    return JSON.stringify([provider, String(song.appleId || ""), song.title || "", song.artist || "", song.album || "", song.duration || 0, song.appleMusicLyricsLanguage || "", !!manual]);
  }

  remember(key, lyrics) {
    this.results.delete(key);
    this.results.set(key, { lyrics, expires: Date.now() + (lyrics ? RESULT_TTL : NO_RESULT_TTL) });
    while (this.results.size > MAX_RESULTS) this.results.delete(this.results.keys().next().value);
  }

  async readCandidate(provider, candidate, song, signal) {
    if (signal.aborted) return null;
    try {
      const payload = await this.providers.lyrics(provider, candidate, song, signal);
      if (!payload) return null;
      const parsed = await parseFallbackLyrics(payload, song, candidate);
      if (!lyricsPrecision(parsed)) return null;
      const tcrrry = TCRRRY_PROVIDERS.has(provider);
      if (tcrrry && !tcrrryLyricBody(parsed.data.map(line => line.text)).length) return null;
      const matchScore = candidate.matchScore + (tcrrry ? 5 : 0);
      return { ...parsed, provider, metadata: { ...parsed.metadata, provider, source: FALLBACK_LYRICS_NAMES[provider], matchedSong: candidate, matchScore, fallbackParser: 1 } };
    } catch (error) {
      if (!signal.aborted) console.warn(`Muisc+ ${provider} lyrics: ${error.message}`);
      return null;
    }
  }

  async searchTcrrry(provider, song, searchSong, signal, manual, attempted) {
    for (const plan of tcrrrySearchPlans(searchSong)) {
      if (signal.aborted) return null;
      let results;
      try {
        results = await this.providers.search(provider, plan.query, song, signal);
      } catch (error) {
        if (signal.aborted) return null;
        console.warn(`Muisc+ ${provider} search: ${error.message}`);
        continue;
      }
      const candidates = rankTcrrryCandidates(searchSong, results, {
        searchTitle: plan.title, allowRankFallback: plan.includesArtist, manual
      }).filter(candidate => !attempted.has(candidate.id)).slice(0, 4);
      let best = null;
      for (const candidate of candidates) {
        if (signal.aborted) return best;
        if (best && (!needsTcrrryEnrichment(best) || !sameTcrrryRecording(best.metadata.matchedSong, candidate))) break;
        attempted.add(candidate.id);
        const lyrics = await this.readCandidate(provider, candidate, song, signal);
        if (best) return tcrrryQuality(lyrics) > tcrrryQuality(best) ? lyrics : best;
        if (lyrics) best = lyrics;
      }
      if (best) return best;
    }
    return null;
  }

  async localizedSong(song, signal) {
    try {
      const identity = await resolveTcrrryIdentity(this.providers.requestJSON, song, signal);
      return identity ? { ...song, ...identity } : null;
    } catch (error) {
      if (!signal.aborted) console.warn("Muisc+ lyrics identity lookup:", error.message);
      return null;
    }
  }

  async provider(provider, song, force = false, options = {}) {
    if (!FALLBACK_LYRICS_ORDER.includes(provider) || !song?.title || !song?.artist) return null;
    const key = this.key(provider, song, options.manual);
    const cached = options.cacheResults !== false && !force ? this.results.get(key) : null;
    if (cached?.expires > Date.now()) {
      const id = cached.lyrics?.metadata?.matchedSong?.id;
      if (id) options.attempted?.add(id);
      return cached.lyrics;
    }
    const generation = this.generation;
    const ticket = {};
    this.pending.set(key, ticket);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 8500);
    this.controllers.add(controller);
    let best = null;
    let completed = false;
    try {
      const old = options.cachedLyrics;
      const saved = old?.provider === provider ? old.metadata?.matchedSong : null;
      const signal = controller.signal;
      if (TCRRRY_PROVIDERS.has(provider)) {
        const attempted = options.attempted || new Set();
        const cachedMatch = saved && !force && rankTcrrryCandidates(song, [saved], { allowRankFallback: false })[0];
        if (cachedMatch) {
          attempted.add(cachedMatch.id);
          best = await this.readCandidate(provider, cachedMatch, song, signal);
        }
        if (!best) best = await this.searchTcrrry(provider, song, song, signal, options.manual, attempted);
        if (!options.directOnly && !signal.aborted && (!best || (!options.manual && needsTcrrryEnrichment(best)))) {
          const localized = await this.localizedSong(song, signal);
          if (localized && !signal.aborted) {
            const retried = await this.searchTcrrry(provider, song, localized, signal, options.manual, attempted);
            if (tcrrryQuality(retried) > tcrrryQuality(best)) best = retried;
          }
        }
      } else {
        let candidates = saved && !force ? rankFallbackCandidates(song, [saved]) : [];
        if (!candidates.length) {
          const keyword = `${song.artist} ${song.title}`.trim();
          candidates = rankFallbackCandidates(song, await this.providers.search(provider, keyword, song, signal));
          if (!candidates.length && !signal.aborted) candidates = rankFallbackCandidates(song, await this.providers.search(provider, song.title, song, signal));
        }
        for (const candidate of candidates.slice(0, 3)) {
          if (signal.aborted) break;
          const lyrics = await this.readCandidate(provider, candidate, song, signal);
          if (lyricsPrecision(lyrics) > lyricsPrecision(best)) best = lyrics;
          if (lyricsPrecision(best) === 3) break;
        }
      }
      completed = !controller.signal.aborted;
    } catch (error) {
      if (!controller.signal.aborted) console.warn(`Muisc+ ${provider} search: ${error.message}`);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
    if (generation === this.generation && this.pending.get(key) === ticket) {
      this.pending.delete(key);
      if (options.cacheResults !== false && (best || completed)) this.remember(key, best);
    }
    return best;
  }

  async resolve(song, native, order, options = {}) {
    let best = native || null;
    if (lyricsPrecision(best) >= 2) return best;
    const enabled = normalizeFallbackLyricsOrder(order);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    this.controllers.add(controller);
    const localizedRetries = [];
    try {
      for (const provider of enabled) {
        if (controller.signal.aborted) break;
        const prior = options.cachedLyrics?.provider === provider ? options.cachedLyrics : null;
        const attempted = new Set();
        const lyrics = await this.provider(provider, song, !!options.force, {
          ...options, signal: controller.signal, directOnly: true, attempted
        });
        const candidate = lyricsPrecision(prior) > lyricsPrecision(lyrics) ? prior : lyrics;
        if (TCRRRY_PROVIDERS.has(provider) && (!candidate || needsTcrrryEnrichment(candidate))) {
          localizedRetries.push({ provider, candidate, attempted });
        }
        if (lyricsPrecision(candidate) > lyricsPrecision(best)) {
          best = candidate;
          // A line-timed upgrade can be displayed while later sources search for words.
          if (typeof options.onProgress === 'function') await options.onProgress(best);
        }
        if (lyricsPrecision(best) === 3) break;
      }
      // Let the enabled sources try the original title before sending a catalogue lookup.
      const retries = lyricsPrecision(best) === 3
        ? localizedRetries.filter(retry => retry.candidate === best)
        : localizedRetries;
      if (retries.length && !controller.signal.aborted) {
        const localized = await this.localizedSong(song, controller.signal);
        for (const { provider, candidate, attempted } of localized ? retries : []) {
          if (controller.signal.aborted) break;
          const lyrics = await this.searchTcrrry(provider, song, localized, controller.signal, false, attempted);
          if (tcrrryQuality(lyrics) <= tcrrryQuality(candidate)) continue;
          if (candidate === best || lyricsPrecision(lyrics) > lyricsPrecision(best)) {
            best = lyrics;
            if (typeof options.onProgress === "function") await options.onProgress(best);
          }
          if (lyricsPrecision(best) === 3) break;
        }
      }
      // A timeout before reaching the previously matched source must not replace
      // known word timing with lower-precision native lyrics. Equal quality still
      // belongs to native or an earlier source visited above.
      const previous = options.cachedLyrics;
      if (enabled.includes(previous?.provider) && lyricsPrecision(previous) > lyricsPrecision(best)) best = previous;
      return best;
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }

  clear() {
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.results.clear();
    this.pending.clear();
  }
}
