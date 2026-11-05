import { FALLBACK_LYRICS_ORDER, FALLBACK_LYRICS_NAMES, normalizeFallbackLyricsOrder } from "../../lib/appleLyricsSources.js";
import { LyricsFallbackProviders } from "./lyricsFallbackProviders.js";
import { lyricsPrecision, parseFallbackLyrics, rankFallbackCandidates } from "../utils/fallbackLyrics.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 100;
const RESULT_TTL = 6 * 60 * 60 * 1000;
const NO_RESULT_TTL = 60 * 1000;
const HOSTS = new Set(["interface.music.163.com", "songsearch.kugou.com", "krcs.kugou.com", "lyrics.kugou.com", "api.qishui.com", "beta-luna.douyin.com"]);

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

  async requestJSON(url, options = {}) {
    const target = new URL(url);
    if (target.protocol !== "https:" || !HOSTS.has(target.hostname) || target.username || target.password) throw new Error("Unsupported lyrics host");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 6000);
    this.controllers.add(controller);
    try {
      const response = await this.request(target.href, { ...options, credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
      if (!response.ok) throw new Error(`Lyrics HTTP ${response.status}`);
      const advertised = Number(response.headers?.get?.("content-length"));
      if (advertised > MAX_BYTES) throw new Error("Lyrics response is too large");
      let text;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        const parts = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) { controller.abort(); throw new Error("Lyrics response is too large"); }
            parts.push(decoder.decode(value, { stream: true }));
          }
          parts.push(decoder.decode());
          text = parts.join("");
        } finally { reader.releaseLock(); }
      } else {
        text = await response.text();
        if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error("Lyrics response is too large");
      }
      // Preserve long platform IDs without touching digits inside JSON strings.
      return JSON.parse(text.replace(/^﻿/, "").replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token =>
        token[0] !== '"' && /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? `"${token}"` : token));
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }

  key(provider, song) {
    return JSON.stringify([provider, String(song.appleId || ""), song.title || "", song.artist || "", song.album || "", song.duration || 0, song.appleMusicLyricsLanguage || ""]);
  }

  remember(key, lyrics) {
    this.results.delete(key);
    this.results.set(key, { lyrics, expires: Date.now() + (lyrics ? RESULT_TTL : NO_RESULT_TTL) });
    while (this.results.size > MAX_RESULTS) this.results.delete(this.results.keys().next().value);
  }

  async provider(provider, song, force = false, options = {}) {
    if (!FALLBACK_LYRICS_ORDER.includes(provider) || !song?.title || !song?.artist) return null;
    const key = this.key(provider, song);
    const cached = options.cacheResults !== false && !force ? this.results.get(key) : null;
    if (cached?.expires > Date.now()) return cached.lyrics;
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
      let candidates = saved && !force ? rankFallbackCandidates(song, [saved]) : [];
      if (!candidates.length) {
        const keyword = `${song.artist} ${song.title}`.trim();
        candidates = rankFallbackCandidates(song, await this.providers.search(provider, keyword, song, controller.signal));
        if (!candidates.length && !controller.signal.aborted) candidates = rankFallbackCandidates(song, await this.providers.search(provider, song.title, song, controller.signal));
      }
      for (const candidate of candidates.slice(0, 3)) {
        if (controller.signal.aborted) break;
        try {
          const payload = await this.providers.lyrics(provider, candidate, song, controller.signal);
          if (!payload) continue;
          const parsed = await parseFallbackLyrics(payload, song, candidate);
          if (!lyricsPrecision(parsed)) continue;
          const lyrics = { ...parsed, provider, metadata: { ...parsed.metadata, provider, source: FALLBACK_LYRICS_NAMES[provider], matchedSong: candidate, matchScore: candidate.matchScore, fallbackParser: 1 } };
          if (lyricsPrecision(lyrics) > lyricsPrecision(best)) best = lyrics;
          if (lyricsPrecision(best) === 3) break;
        } catch (error) {
          if (controller.signal.aborted) break;
          console.warn(`Muisc+ ${provider} lyrics: ${error.message}`);
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
    try {
      for (const provider of enabled) {
        if (controller.signal.aborted) break;
        const prior = options.cachedLyrics?.provider === provider ? options.cachedLyrics : null;
        const lyrics = await this.provider(provider, song, !!options.force, { ...options, signal: controller.signal });
        const candidate = lyricsPrecision(prior) > lyricsPrecision(lyrics) ? prior : lyrics;
        if (lyricsPrecision(candidate) > lyricsPrecision(best)) {
          best = candidate;
          // A line-timed upgrade can be displayed while later sources search for words.
          if (typeof options.onProgress === 'function') await options.onProgress(best);
        }
        if (lyricsPrecision(best) === 3) break;
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
