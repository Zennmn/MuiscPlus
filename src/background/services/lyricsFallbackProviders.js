// SPDX-FileCopyrightText: Copyright (C) 2024-2025 沉默の金 <cmzj@cmzj.org>
// SPDX-License-Identifier: AGPL-3.0-only AND GPL-3.0-only
// Protocol references: guohuiyuan/music-lib (AGPL-3.0), netease/{crypto,netease}.go,
// kugou/{song,lyric}.go, soda/{search,song,soda}.go; LDDC (GPL-3.0-only),
// LDDC/core/api/lyrics/{ne,kg}.py and LDDC/core/decryptor/eapi.py.
// Retains LDDC copyright for the adapted request protocol logic.

import { lyricsPrecision, parseFallbackLyrics, rankFallbackCandidates } from '../utils/fallbackLyrics.js';

const SEARCH_LIMIT = 20;
const encoder = new TextEncoder();
const text = value => typeof value === 'string' ? value : '';
const idText = value => typeof value === 'string' ? value.trim()
  : Number.isSafeInteger(value) && value > 0 ? String(value) : '';
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const list = value => Array.isArray(value) ? value : [];
const names = value => list(value).map(artist => text(artist?.name).trim()).filter(Boolean).join(', ');
const seconds = (value, milliseconds = false) => positive(value) / (milliseconds ? 1000 : 1);
const lyricText = value => typeof value === 'string' ? value : text(value?.content) || text(value?.lyric);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const numericId = value => /^\d+$/.test(idText(value)) ? idText(value) : '';
const validHash = value => /^[a-f0-9]{32}$/i.test(idText(value)) ? idText(value).toLowerCase() : '';

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Lyrics request aborted', 'AbortError');
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter(candidate => {
    if (!candidate.id || !candidate.title || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  }).slice(0, SEARCH_LIMIT);
}

function apiError(provider, data, field, success) {
  if (!data || typeof data !== 'object') throw new Error(provider + ' returned invalid JSON');
  if (data[field] != null && !success.includes(Number(data[field]))) {
    throw new Error(provider + ' API error: ' + String(data[field]));
  }
}

function cleanKugouText(value) {
  return text(value).replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
    const known = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (known[entity.toLowerCase()]) return known[entity.toLowerCase()];
    const hexadecimal = /^&#x/i.test(entity);
    const point = parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).trim();
}

function lyricFormat(content) {
  if (/(?:^|\n)\s*\[\d+,\d+\].*?<\d+,\d+,\d+>/m.test(content)) return 'krc';
  return /\[\d+:\d{2}(?:[.:]\d+)?\]/.test(content) ? 'lrc' : 'text';
}

// MD5 is only the upstream EAPI protocol checksum.
function md5(value) {
  const bytes = encoder.encode(value);
  const buffer = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(buffer.length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(buffer.length - 4, Math.floor(bytes.length / 0x20000000), true);
  const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let offset = 0; offset < buffer.length; offset += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      const round = i >>> 4;
      const f = round === 0 ? (b & c) | (~b & d)
        : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) + view.getUint32(offset + g * 4, true)) | 0;
      const shift = shifts[round][i % 4];
      const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      a = d; d = c; c = b; b = next;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const result = new Uint8Array(16);
  const digest = new DataView(result.buffer);
  [a0, b0, c0, d0].forEach((word, index) => digest.setUint32(index * 4, word, true));
  return hex(result);
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function aesEcb(value, keyText, signal) {
  checkAbort(signal);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is required for NetEase lyrics');
  const key = await subtle.importKey('raw', encoder.encode(keyText), 'AES-CBC', false, ['encrypt']);
  const bytes = encoder.encode(value);
  const padding = 16 - bytes.length % 16;
  const padded = new Uint8Array(bytes.length + padding);
  padded.set(bytes);
  padded.fill(padding, bytes.length);
  const output = new Uint8Array(padded.length);
  // Zero-IV CBC on one manually padded block equals ECB for its first block.
  // WebCrypto appends another padding block; discard that second cipher block.
  for (let start = 0; start < padded.length; start += 256) {
    checkAbort(signal);
    const blocks = [];
    for (let offset = start; offset < Math.min(start + 256, padded.length); offset += 16) {
      blocks.push(subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, padded.slice(offset, offset + 16))
        .then(result => output.set(new Uint8Array(result, 0, 16), offset)));
    }
    await Promise.all(blocks);
  }
  checkAbort(signal);
  return hex(output).toUpperCase();
}

const apiURL = (base, params) => `${base}?${new URLSearchParams(params)}`;

function decodeBase64Text(content) {
  if (typeof content !== 'string' || content.length > 3 * 1024 * 1024) return '';
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content), char => char.charCodeAt(0)));
}

/** Only metadata search and lyrics endpoints; no music playback or account session. */
export class LyricsFallbackProviders {
  constructor({ requestJSON }) {
    this.requestJSON = requestJSON;
  }

  async eapi(path, params, signal) {
    const body = JSON.stringify({ ...params, e_r: false, header: JSON.stringify({ os: 'pc', appver: '3.0.18', requestId: `${Date.now()}_0` }) });
    const apiPath = path.replace(/^\/eapi\//, '/api/');
    const checksum = md5(`nobody${apiPath}use${body}md5forencrypt`);
    const encrypted = await aesEcb(`${apiPath}-36cd479b6b5-${body}-36cd479b6b5-${checksum}`, 'e82ckenh8dichen8', signal);
    const data = await this.requestJSON(`https://interface.music.163.com${path}`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ params: encrypted }).toString()
    });
    apiError('NetEase', data, 'code', [200]);
    return data;
  }

  async search(provider, keyword, songInfo = {}, signal) {
    checkAbort(signal);
    if (!hasText(keyword) || keyword.length > 1024) return [];
    let candidates;
    if (provider === 'netease') {
      const data = await this.eapi('/eapi/cloudsearch/pc', { s: keyword, type: 1, limit: SEARCH_LIMIT, offset: 0 }, signal);
      candidates = list(data.result?.songs).map(song => ({
        id: numericId(song.id), title: text(song.name), artist: names(song.ar || song.artists),
        album: text((song.al || song.album)?.name), duration: seconds(song.dt ?? song.duration, true)
      }));
    } else if (provider === 'kugou') {
      const data = await this.requestJSON(apiURL('https://songsearch.kugou.com/song_search_v2', {
        keyword, platform: 'WebFilter', format: 'json', page: '1', pagesize: String(SEARCH_LIMIT),
        userid: '-1', clientver: '', tag: 'em', filter: '2', iscorrection: '1', privilege_filter: '0'
      }), { signal });
      apiError('Kugou', data, 'status', [1]);
      candidates = list(data.data?.lists).map(song => ({
        id: validHash(song.FileHash || song.SQFileHash || song.HQFileHash),
        title: cleanKugouText(song.SongName),
        artist: cleanKugouText(song.SingerName) || names(song.Singers),
        album: cleanKugouText(song.AlbumName), duration: seconds(song.Duration),
        extra: { albumAudioId: idText(song.AlbumAudioId ?? song.album_audio_id) }
      }));
    } else if (provider === 'soda') {
      // Public client query profile from music-lib/soda/search.go, not user credentials.
      const data = await this.requestJSON(apiURL('https://api.qishui.com/luna/search/track', {
        q: keyword, cursor: '0', count: String(SEARCH_LIMIT), aid: '386088',
        device_platform: 'android', os: 'android', ssmix: 'a',
        cdid: '46556f98-1720-4248-83da-62b74b60b46a', channel: 'xiaomi_8478_64',
        app_name: 'luna', version_code: '100198030', version_name: '19.8.0',
        manifest_version_code: '100198030', update_version_code: '100198030',
        resolution: '1080*1920', dpi: '480', device_type: 'ABR-AL80', device_brand: 'HUAWEI',
        language: 'zh', os_api: '35', os_version: '15', ac: 'wifi', device_model: 'ABR-AL80',
        save_power: '0', font_size: '1.00', luna_first_launch_apk_type: 'normal_apk',
        diversion_channel_name: 'xiaomi_8478_64', is_car_play: '0', battery: '0.99',
        network_speed: '10156', hybrid_version_code: '100198030', tz_name: 'Asia/Shanghai',
        tz_offset: '28800', luna_register_time: '1784311292',
        diversion_category_level_two: 'Xiaomi%E5%95%86%E5%BA%97-%E8%87%AA%E7%84%B6',
        package: 'com.luna.music', charge: '0', luna_apk_type: 'normal_apk',
        output_device_type: 'Phone', volume: '1.00', brightness: '0.08',
        need_personal_recommend: '1', is_teen_mode: '0', sim_region: 'cn',
        diversion_category_level_one: '%E5%8E%82%E5%95%86%E5%95%86%E5%BA%97-%E8%87%AA%E7%84%B6',
        android_device_type: 'default', iid: '2204957404569386', device_id: '2204957404565290',
        _rticket: String(Date.now())
      }), { signal });
      apiError('Soda', data, 'status_code', [0]);
      const root = data.data?.result_groups ? data.data : data;
      candidates = list(root.result_groups).flatMap(group => list(group.data)).map(item => {
        const song = item?.entity?.track || {};
        return { id: numericId(song.id), title: text(song.name), artist: names(song.artists),
          album: text(song.album?.name), duration: seconds(song.duration, true) };
      });
    } else return [];
    checkAbort(signal);
    return uniqueCandidates(candidates);
  }

  async lyrics(provider, candidate, songInfo = {}, signal) {
    checkAbort(signal);
    if (provider === 'netease') {
      const id = numericId(candidate?.id);
      if (!id) return null;
      const data = await this.eapi('/eapi/song/lyric/v1', { id, lv: -1, tv: -1, rv: -1, yv: -1, ytv: -1, yrv: -1 }, signal);
      const yrc = lyricText(data.yrc), lrc = lyricText(data.lrc);
      if (!hasText(yrc) && !hasText(lrc)) return null;
      const payload = {
        format: hasText(yrc) ? 'yrc' : lyricFormat(lrc), content: hasText(yrc) ? yrc : lrc,
        translation: lyricText(data.ytlrc) || lyricText(data.tlyric),
        romanization: lyricText(data.yromalrc) || lyricText(data.romalrc),
        lineContent: hasText(yrc) ? lrc : '', language: 'zh'
      };
      if (hasText(yrc) && hasText(lrc) && !lyricsPrecision(await parseFallbackLyrics(payload, songInfo, candidate))) {
        return { ...payload, format: lyricFormat(lrc), content: lrc, lineContent: '',
          translation: lyricText(data.tlyric), romanization: lyricText(data.romalrc) };
      }
      return payload;
    }
    if (provider === 'soda') {
      const id = numericId(candidate?.id);
      if (!id) return null;
      const data = await this.requestJSON(apiURL('https://beta-luna.douyin.com/luna/h5/seo_track', {
        track_id: id, device_platform: 'web'
      }), { signal });
      apiError('Soda', data, 'status_code', [0]);
      const lyric = data.seo_track?.lyric || data.lyric || data.data?.seo_track?.lyric || data.data?.lyric;
      const content = lyricText(lyric);
      if (!hasText(content)) return null;
      return { format: lyricFormat(content), content,
        translation: lyricText(lyric?.translations?.cn) || lyricText(lyric?.translations?.zh), language: 'zh' };
    }
    if (provider !== 'kugou' || !validHash(candidate?.id)) return null;
    const data = await this.requestJSON(apiURL('https://krcs.kugou.com/search', {
      ver: '1', client: 'mobi', hash: candidate.id,
      duration: String(Math.round(positive(candidate.duration || songInfo.duration) * 1000)),
      album_audio_id: candidate.extra?.albumAudioId || ''
    }), { signal });
    apiError('Kugou lyrics', data, 'status', [200, 1]);
    let best = null, bestPrecision = 0;
    const candidates = list(data.candidates).filter(item => {
      if (!numericId(item.id) || !hasText(item.accesskey)) return false;
      // Hash establishes the recording; when a lyric candidate supplies metadata,
      // also reject conflicting singers, versions and durations.
      return !item.song || !item.singer || rankFallbackCandidates(candidate, [{
        title: cleanKugouText(item.song), artist: cleanKugouText(item.singer),
        duration: seconds(item.duration, true)
      }]).length > 0;
    });
    for (const item of candidates.slice(0, 3)) {
      checkAbort(signal);
      try {
        const download = await this.requestJSON(apiURL('https://lyrics.kugou.com/download', {
          ver: '1', client: 'pc', id: idText(item.id), accesskey: item.accesskey, fmt: 'krc', charset: 'utf8'
        }), { signal });
        if (!hasText(download.content)) continue;
        const isLrc = download.fmt === 'lrc' || Number(download.contenttype) === 2;
        const content = isLrc ? decodeBase64Text(download.content) : download.content;
        const payload = { format: isLrc ? lyricFormat(content) : 'krc-base64', content };
        const precision = lyricsPrecision(await parseFallbackLyrics(payload, songInfo, candidate));
        if (precision > bestPrecision) { best = payload; bestPrecision = precision; }
        if (precision === 3) break;
      } catch (error) {
        checkAbort(signal);
        console.warn('Muisc+ Kugou lyric candidate:', error.message);
      }
    }
    return best;
  }
}
