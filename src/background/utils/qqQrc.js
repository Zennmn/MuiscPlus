/**
 * QQ Music QRC decoder.
 *
 * The non-standard DES tables and QRC key are derived from QQMusicDecoder by
 * WXRIW (Copyright (c) 2023, MIT License). The implementation uses only typed
 * arrays and browser compression APIs; it does not depend on Android or JNI.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_ENCRYPTED_HEX_LENGTH = MAX_OUTPUT_BYTES * 4;
const QRC_KEY = new TextEncoder().encode('!@#)(*$%123ZXC!@!@#)(NHL');

const INITIAL_PERMUTATION = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

// QQ's QRC cipher keeps two historical S-box deviations from standard DES.
const SBOX = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

function bitFromBytes(bytes, offset, bit, target) {
  const index = offset + Math.floor(bit / 32) * 4 + 3 - Math.floor((bit % 32) / 8);
  return (((bytes[index] & 0xff) >>> (7 - (bit % 8))) & 1) << target;
}

function bitFromInt(value, bit, target) {
  return ((value >>> (31 - bit)) & 1) << target;
}

function highBit(value, shift, target) {
  return ((value << shift) & 0x80000000) >>> target;
}

function sboxBit(value) {
  return (value & 0x20) | ((value & 0x1f) >>> 1) | ((value & 1) << 4);
}

function createKeySchedule(key, offset, encrypt) {
  const permC = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
  const permD = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
  const compression = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];
  let c = 0;
  let d = 0;

  for (let index = 0, target = 31; index < 28; index += 1, target -= 1) {
    c |= bitFromBytes(key, offset, permC[index], target);
    d |= bitFromBytes(key, offset, permD[index], target);
  }

  const schedule = new Array(16);
  for (let round = 0; round < 16; round += 1) {
    const shift = SHIFTS[round];
    c = ((c << shift) | (c >>> (28 - shift))) & 0xfffffff0;
    d = ((d << shift) | (d >>> (28 - shift))) & 0xfffffff0;
    const targetRound = encrypt ? round : 15 - round;
    const roundKey = new Uint8Array(6);

    for (let index = 0; index < 24; index += 1) {
      roundKey[Math.floor(index / 8)] |= bitFromInt(c, compression[index], 7 - (index % 8));
    }
    for (let index = 24; index < 48; index += 1) {
      roundKey[Math.floor(index / 8)] |= bitFromInt(d, compression[index] - 27, 7 - (index % 8));
    }
    schedule[targetRound] = roundKey;
  }
  return schedule;
}

function initialPermutation(input) {
  const state = [0, 0];
  for (let index = 0; index < INITIAL_PERMUTATION.length; index += 1) {
    const part = index < 32 ? 0 : 1;
    const target = 31 - (index % 32);
    state[part] |= bitFromBytes(input, 0, INITIAL_PERMUTATION[index] - 1, target);
  }
  return state;
}

function inversePermutation(state) {
  const output = new Uint8Array(8);
  output[3] = bitFromInt(state[1], 7, 7) | bitFromInt(state[0], 7, 6) | bitFromInt(state[1], 15, 5) | bitFromInt(state[0], 15, 4) | bitFromInt(state[1], 23, 3) | bitFromInt(state[0], 23, 2) | bitFromInt(state[1], 31, 1) | bitFromInt(state[0], 31, 0);
  output[2] = bitFromInt(state[1], 6, 7) | bitFromInt(state[0], 6, 6) | bitFromInt(state[1], 14, 5) | bitFromInt(state[0], 14, 4) | bitFromInt(state[1], 22, 3) | bitFromInt(state[0], 22, 2) | bitFromInt(state[1], 30, 1) | bitFromInt(state[0], 30, 0);
  output[1] = bitFromInt(state[1], 5, 7) | bitFromInt(state[0], 5, 6) | bitFromInt(state[1], 13, 5) | bitFromInt(state[0], 13, 4) | bitFromInt(state[1], 21, 3) | bitFromInt(state[0], 21, 2) | bitFromInt(state[1], 29, 1) | bitFromInt(state[0], 29, 0);
  output[0] = bitFromInt(state[1], 4, 7) | bitFromInt(state[0], 4, 6) | bitFromInt(state[1], 12, 5) | bitFromInt(state[0], 12, 4) | bitFromInt(state[1], 20, 3) | bitFromInt(state[0], 20, 2) | bitFromInt(state[1], 28, 1) | bitFromInt(state[0], 28, 0);
  output[7] = bitFromInt(state[1], 3, 7) | bitFromInt(state[0], 3, 6) | bitFromInt(state[1], 11, 5) | bitFromInt(state[0], 11, 4) | bitFromInt(state[1], 19, 3) | bitFromInt(state[0], 19, 2) | bitFromInt(state[1], 27, 1) | bitFromInt(state[0], 27, 0);
  output[6] = bitFromInt(state[1], 2, 7) | bitFromInt(state[0], 2, 6) | bitFromInt(state[1], 10, 5) | bitFromInt(state[0], 10, 4) | bitFromInt(state[1], 18, 3) | bitFromInt(state[0], 18, 2) | bitFromInt(state[1], 26, 1) | bitFromInt(state[0], 26, 0);
  output[5] = bitFromInt(state[1], 1, 7) | bitFromInt(state[0], 1, 6) | bitFromInt(state[1], 9, 5) | bitFromInt(state[0], 9, 4) | bitFromInt(state[1], 17, 3) | bitFromInt(state[0], 17, 2) | bitFromInt(state[1], 25, 1) | bitFromInt(state[0], 25, 0);
  output[4] = bitFromInt(state[1], 0, 7) | bitFromInt(state[0], 0, 6) | bitFromInt(state[1], 8, 5) | bitFromInt(state[0], 8, 4) | bitFromInt(state[1], 16, 3) | bitFromInt(state[0], 16, 2) | bitFromInt(state[1], 24, 1) | bitFromInt(state[0], 24, 0);
  return output;
}

function feistelLegacy(state, roundKey) {
  const t1 = highBit(state, 31, 0) | ((state & 0xf0000000) >>> 1) | highBit(state, 4, 5) | highBit(state, 3, 6) | ((state & 0x0f000000) >>> 3) | highBit(state, 8, 11) | highBit(state, 7, 12) | ((state & 0x00f00000) >>> 5) | highBit(state, 12, 17) | highBit(state, 11, 18) | ((state & 0x000f0000) >>> 7) | highBit(state, 16, 23);
  const t2 = highBit(state, 15, 0) | ((state & 0x0000f000) << 15) | highBit(state, 20, 5) | highBit(state, 19, 6) | ((state & 0x00000f00) << 13) | highBit(state, 24, 11) | highBit(state, 23, 12) | ((state & 0x000000f0) << 11) | highBit(state, 28, 17) | highBit(state, 27, 18) | ((state & 0x0000000f) << 9) | highBit(state, 0, 23);
  const expanded = [(t1 >>> 24) & 255, (t1 >>> 16) & 255, (t1 >>> 8) & 255, (t2 >>> 24) & 255, (t2 >>> 16) & 255, (t2 >>> 8) & 255];

  for (let index = 0; index < expanded.length; index += 1) expanded[index] ^= roundKey[index] & 255;

  const result = (SBOX[0][sboxBit(expanded[0] >>> 2)] << 28)
    | (SBOX[1][sboxBit(((expanded[0] & 3) << 4) | (expanded[1] >>> 4))] << 24)
    | (SBOX[2][sboxBit(((expanded[1] & 15) << 2) | (expanded[2] >>> 6))] << 20)
    | (SBOX[3][sboxBit(expanded[2] & 63)] << 16)
    | (SBOX[4][sboxBit(expanded[3] >>> 2)] << 12)
    | (SBOX[5][sboxBit(((expanded[3] & 3) << 4) | (expanded[4] >>> 4))] << 8)
    | (SBOX[6][sboxBit(((expanded[4] & 15) << 2) | (expanded[5] >>> 6))] << 4)
    | SBOX[7][sboxBit(expanded[5] & 63)];

  return highBit(result, 15, 0) | highBit(result, 6, 1) | highBit(result, 19, 2) | highBit(result, 20, 3)
    | highBit(result, 28, 4) | highBit(result, 11, 5) | highBit(result, 27, 6) | highBit(result, 16, 7)
    | highBit(result, 0, 8) | highBit(result, 14, 9) | highBit(result, 22, 10) | highBit(result, 25, 11)
    | highBit(result, 4, 12) | highBit(result, 17, 13) | highBit(result, 30, 14) | highBit(result, 9, 15)
    | highBit(result, 1, 16) | highBit(result, 7, 17) | highBit(result, 23, 18) | highBit(result, 13, 19)
    | highBit(result, 31, 20) | highBit(result, 26, 21) | highBit(result, 2, 22) | highBit(result, 8, 23)
    | highBit(result, 18, 24) | highBit(result, 12, 25) | highBit(result, 29, 26) | highBit(result, 5, 27)
    | highBit(result, 21, 28) | highBit(result, 10, 29) | highBit(result, 3, 30) | highBit(result, 24, 31);
}

function desCrypt(input, key) {
  let state = initialPermutation(input);
  for (let round = 0; round < 15; round += 1) {
    const previousRight = state[1];
    state[1] = feistelLegacy(state[1], key[round]) ^ state[0];
    state[0] = previousRight;
  }
  state[0] = feistelLegacy(state[1], key[15]) ^ state[0];
  return inversePermutation(state);
}

function tripleDesCrypt(input, schedules) {
  return desCrypt(desCrypt(desCrypt(input, schedules[0]), schedules[1]), schedules[2]);
}

function parseHex(hex) {
  if (typeof hex !== 'string' || !hex || (hex.length & 1) !== 0 || hex.length > MAX_ENCRYPTED_HEX_LENGTH
    || !/^[0-9a-f]+$/i.test(hex) || (hex.length / 2) % 8 !== 0) {
    throw new Error('Invalid QRC block');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function inflateQrcOnce(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('QRC compression is not supported');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OUTPUT_BYTES) {
        await reader.cancel();
        throw new Error('QRC output is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(output);
}

/**
 * The Java reference feeds every decrypted block to InflaterInputStream, which
 * accepts trailing bytes after the zlib stream. DecompressionStream may reject
 * them. Keep the original attempt first; only block-aligned zero suffixes are
 * safe to omit, and every shortened candidate still runs the zlib checksum.
 */
async function inflateQrc(bytes) {
  try {
    return await inflateQrcOnce(bytes);
  } catch (originalError) {
    let zeroSuffix = 0;
    while (zeroSuffix < Math.min(7, bytes.length - 1) && bytes[bytes.length - 1 - zeroSuffix] === 0) {
      zeroSuffix += 1;
    }
    for (let trim = 1; trim <= zeroSuffix; trim += 1) {
      try {
        return await inflateQrcOnce(bytes.subarray(0, bytes.length - trim));
      } catch {
        // Try the next bounded block-padding candidate.
      }
    }
    throw originalError;
  }
}

export async function decodeQqQrc(hex) {
  const encrypted = parseHex(hex.trim());
  const schedules = [
    createKeySchedule(QRC_KEY, 16, false),
    createKeySchedule(QRC_KEY, 8, true),
    createKeySchedule(QRC_KEY, 0, false),
  ];
  const decrypted = new Uint8Array(encrypted.length);
  for (let offset = 0; offset < encrypted.length; offset += 8) {
    decrypted.set(tripleDesCrypt(encrypted.subarray(offset, offset + 8), schedules), offset);
  }
  return inflateQrc(decrypted);
}
