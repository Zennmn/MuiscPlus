export const APPLE_LYRICS_ORDER = ['amll', 'lunabeat', 'amlyrics', 'applemusic'];
export const APPLE_LYRICS_NAMES = { amll: 'AMLL TTML DB', lunabeat: 'LunaBeat', amlyrics: 'AmLyrics', applemusic: 'Apple Music' };
export const FALLBACK_LYRICS_ORDER = ['netease', 'kugou', 'soda'];
export const FALLBACK_LYRICS_NAMES = {
  netease: 'NetEase Cloud Music',
  kugou: 'Kugou Music',
  soda: 'Soda Music'
};
export function normalizeAppleLyricsOrder(value) {
  const order = value == null ? APPLE_LYRICS_ORDER : Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(order.map(x => x.trim()).filter(x => APPLE_LYRICS_ORDER.includes(x) && x !== 'applemusic')), 'applemusic'];
}
/** Independent fallback group used only for missing or plain-text native Apple lyrics. */
export function normalizeFallbackLyricsOrder(value) {
  const order = value == null ? FALLBACK_LYRICS_ORDER : Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(order.map(x => String(x).trim()).filter(x => FALLBACK_LYRICS_ORDER.includes(x)))];
}
