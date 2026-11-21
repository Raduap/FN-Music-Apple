// QQ 音乐 QRC 解密与解析（实验性）：纯逻辑模块，便于单测与主进程复用。
//
// QRC 用一套**非标准 DES 变体**加密（S-box 与标准 DES 不同，标准 des-ede3
// 解不出来），需自实现。位运算移植自 WXRIW/QQMusicDecoder 的 DESHelper.cs，
// 在 JS 里统一用无符号 32 位（>>> / Uint8Array）还原 C# 的 uint / byte 语义。
'use strict'

const ENCRYPT = 1
const DECRYPT = 0

const SBOX1 = [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13]
const SBOX2 = [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9]
const SBOX3 = [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12]
const SBOX4 = [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14]
const SBOX5 = [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3]
const SBOX6 = [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13]
const SBOX7 = [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12]
const SBOX8 = [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]
const BOXES = [SBOX1, SBOX2, SBOX3, SBOX4, SBOX5, SBOX6, SBOX7, SBOX8]

const KEY_RND_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const KEY_PERM_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35]
const KEY_PERM_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3]
const KEY_COMPRESSION = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31]

// 从字节数组按「大端位序」取第 b 位，放到结果的第 c 位。
const bitNum = (a, b, c) => (((a[(((b / 32) | 0) * 4 + 3 - (((b % 32) / 8) | 0))] >> (7 - (b % 8))) & 1) << c) >>> 0
const bitNumIntR = (a, b, c) => (((a >>> (31 - b)) & 1) << c) & 0xff
const bitNumIntL = (a, b, c) => ((((a << b) & 0x80000000) >>> c)) >>> 0
const sboxBit = (a) => ((a & 0x20) | ((a & 0x1f) >> 1) | ((a & 1) << 4)) >>> 0

function keySchedule(key, schedule, mode) {
  let i, j, c = 0, d = 0
  for (i = 0, j = 31; i < 28; i++, j--) c = (c | bitNum(key, KEY_PERM_C[i], j)) >>> 0
  for (i = 0, j = 31; i < 28; i++, j--) d = (d | bitNum(key, KEY_PERM_D[i], j)) >>> 0
  for (i = 0; i < 16; i++) {
    c = (((c << KEY_RND_SHIFT[i]) | (c >>> (28 - KEY_RND_SHIFT[i]))) & 0xfffffff0) >>> 0
    d = (((d << KEY_RND_SHIFT[i]) | (d >>> (28 - KEY_RND_SHIFT[i]))) & 0xfffffff0) >>> 0
    const gen = mode === DECRYPT ? 15 - i : i
    const s = schedule[gen]
    for (j = 0; j < 6; j++) s[j] = 0
    for (j = 0; j < 24; j++) s[(j / 8) | 0] |= bitNumIntR(c, KEY_COMPRESSION[j], 7 - (j % 8))
    for (; j < 48; j++) s[(j / 8) | 0] |= bitNumIntR(d, KEY_COMPRESSION[j] - 27, 7 - (j % 8))
  }
}

// 初始置换 IP：input 为 8 字节，写回 state[0] / state[1]。
function initialPermutation(state, input) {
  state[0] = (bitNum(input, 57, 31) | bitNum(input, 49, 30) | bitNum(input, 41, 29) | bitNum(input, 33, 28) |
    bitNum(input, 25, 27) | bitNum(input, 17, 26) | bitNum(input, 9, 25) | bitNum(input, 1, 24) |
    bitNum(input, 59, 23) | bitNum(input, 51, 22) | bitNum(input, 43, 21) | bitNum(input, 35, 20) |
    bitNum(input, 27, 19) | bitNum(input, 19, 18) | bitNum(input, 11, 17) | bitNum(input, 3, 16) |
    bitNum(input, 61, 15) | bitNum(input, 53, 14) | bitNum(input, 45, 13) | bitNum(input, 37, 12) |
    bitNum(input, 29, 11) | bitNum(input, 21, 10) | bitNum(input, 13, 9) | bitNum(input, 5, 8) |
    bitNum(input, 63, 7) | bitNum(input, 55, 6) | bitNum(input, 47, 5) | bitNum(input, 39, 4) |
    bitNum(input, 31, 3) | bitNum(input, 23, 2) | bitNum(input, 15, 1) | bitNum(input, 7, 0)) >>> 0
  state[1] = (bitNum(input, 56, 31) | bitNum(input, 48, 30) | bitNum(input, 40, 29) | bitNum(input, 32, 28) |
    bitNum(input, 24, 27) | bitNum(input, 16, 26) | bitNum(input, 8, 25) | bitNum(input, 0, 24) |
    bitNum(input, 58, 23) | bitNum(input, 50, 22) | bitNum(input, 42, 21) | bitNum(input, 34, 20) |
    bitNum(input, 26, 19) | bitNum(input, 18, 18) | bitNum(input, 10, 17) | bitNum(input, 2, 16) |
    bitNum(input, 60, 15) | bitNum(input, 52, 14) | bitNum(input, 44, 13) | bitNum(input, 36, 12) |
    bitNum(input, 28, 11) | bitNum(input, 20, 10) | bitNum(input, 12, 9) | bitNum(input, 4, 8) |
    bitNum(input, 62, 7) | bitNum(input, 54, 6) | bitNum(input, 46, 5) | bitNum(input, 38, 4) |
    bitNum(input, 30, 3) | bitNum(input, 22, 2) | bitNum(input, 14, 1) | bitNum(input, 6, 0)) >>> 0
}

// 逆初始置换 IP^-1：把 state 写回 8 字节 output。
function inverseInitialPermutation(state, output) {
  output[3] = bitNumIntR(state[1], 7, 7) | bitNumIntR(state[0], 7, 6) | bitNumIntR(state[1], 15, 5) | bitNumIntR(state[0], 15, 4) | bitNumIntR(state[1], 23, 3) | bitNumIntR(state[0], 23, 2) | bitNumIntR(state[1], 31, 1) | bitNumIntR(state[0], 31, 0)
  output[2] = bitNumIntR(state[1], 6, 7) | bitNumIntR(state[0], 6, 6) | bitNumIntR(state[1], 14, 5) | bitNumIntR(state[0], 14, 4) | bitNumIntR(state[1], 22, 3) | bitNumIntR(state[0], 22, 2) | bitNumIntR(state[1], 30, 1) | bitNumIntR(state[0], 30, 0)
  output[1] = bitNumIntR(state[1], 5, 7) | bitNumIntR(state[0], 5, 6) | bitNumIntR(state[1], 13, 5) | bitNumIntR(state[0], 13, 4) | bitNumIntR(state[1], 21, 3) | bitNumIntR(state[0], 21, 2) | bitNumIntR(state[1], 29, 1) | bitNumIntR(state[0], 29, 0)
  output[0] = bitNumIntR(state[1], 4, 7) | bitNumIntR(state[0], 4, 6) | bitNumIntR(state[1], 12, 5) | bitNumIntR(state[0], 12, 4) | bitNumIntR(state[1], 20, 3) | bitNumIntR(state[0], 20, 2) | bitNumIntR(state[1], 28, 1) | bitNumIntR(state[0], 28, 0)
  output[7] = bitNumIntR(state[1], 3, 7) | bitNumIntR(state[0], 3, 6) | bitNumIntR(state[1], 11, 5) | bitNumIntR(state[0], 11, 4) | bitNumIntR(state[1], 19, 3) | bitNumIntR(state[0], 19, 2) | bitNumIntR(state[1], 27, 1) | bitNumIntR(state[0], 27, 0)
  output[6] = bitNumIntR(state[1], 2, 7) | bitNumIntR(state[0], 2, 6) | bitNumIntR(state[1], 10, 5) | bitNumIntR(state[0], 10, 4) | bitNumIntR(state[1], 18, 3) | bitNumIntR(state[0], 18, 2) | bitNumIntR(state[1], 26, 1) | bitNumIntR(state[0], 26, 0)
  output[5] = bitNumIntR(state[1], 1, 7) | bitNumIntR(state[0], 1, 6) | bitNumIntR(state[1], 9, 5) | bitNumIntR(state[0], 9, 4) | bitNumIntR(state[1], 17, 3) | bitNumIntR(state[0], 17, 2) | bitNumIntR(state[1], 25, 1) | bitNumIntR(state[0], 25, 0)
  output[4] = bitNumIntR(state[1], 0, 7) | bitNumIntR(state[0], 0, 6) | bitNumIntR(state[1], 8, 5) | bitNumIntR(state[0], 8, 4) | bitNumIntR(state[1], 16, 3) | bitNumIntR(state[0], 16, 2) | bitNumIntR(state[1], 24, 1) | bitNumIntR(state[0], 24, 0)
}

// Feistel 轮函数：1 个 32 位分组 + 6 字节轮密钥 -> 32 位。
function feistel(state, key) {
  const t1 = (bitNumIntL(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitNumIntL(state, 4, 5) | bitNumIntL(state, 3, 6) |
    ((state & 0x0f000000) >>> 3) | bitNumIntL(state, 8, 11) | bitNumIntL(state, 7, 12) | ((state & 0x00f00000) >>> 5) |
    bitNumIntL(state, 12, 17) | bitNumIntL(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitNumIntL(state, 16, 23)) >>> 0
  const t2 = (bitNumIntL(state, 15, 0) | ((state & 0x0000f000) << 15) | bitNumIntL(state, 20, 5) | bitNumIntL(state, 19, 6) |
    ((state & 0x00000f00) << 13) | bitNumIntL(state, 24, 11) | bitNumIntL(state, 23, 12) | ((state & 0x000000f0) << 11) |
    bitNumIntL(state, 28, 17) | bitNumIntL(state, 27, 18) | ((state & 0x0000000f) << 9) | bitNumIntL(state, 0, 23)) >>> 0
  const l = [(t1 >>> 24) & 0xff, (t1 >>> 16) & 0xff, (t1 >>> 8) & 0xff, (t2 >>> 24) & 0xff, (t2 >>> 16) & 0xff, (t2 >>> 8) & 0xff]
  for (let i = 0; i < 6; i++) l[i] ^= key[i]
  let st = ((BOXES[0][sboxBit(l[0] >>> 2)] << 28) |
    (BOXES[1][sboxBit(((l[0] & 0x03) << 4) | (l[1] >>> 4))] << 24) |
    (BOXES[2][sboxBit(((l[1] & 0x0f) << 2) | (l[2] >>> 6))] << 20) |
    (BOXES[3][sboxBit(l[2] & 0x3f)] << 16) |
    (BOXES[4][sboxBit(l[3] >>> 2)] << 12) |
    (BOXES[5][sboxBit(((l[3] & 0x03) << 4) | (l[4] >>> 4))] << 8) |
    (BOXES[6][sboxBit(((l[4] & 0x0f) << 2) | (l[5] >>> 6))] << 4) |
    BOXES[7][sboxBit(l[5] & 0x3f)]) >>> 0
  st = (bitNumIntL(st, 15, 0) | bitNumIntL(st, 6, 1) | bitNumIntL(st, 19, 2) | bitNumIntL(st, 20, 3) |
    bitNumIntL(st, 28, 4) | bitNumIntL(st, 11, 5) | bitNumIntL(st, 27, 6) | bitNumIntL(st, 16, 7) |
    bitNumIntL(st, 0, 8) | bitNumIntL(st, 14, 9) | bitNumIntL(st, 22, 10) | bitNumIntL(st, 25, 11) |
    bitNumIntL(st, 4, 12) | bitNumIntL(st, 17, 13) | bitNumIntL(st, 30, 14) | bitNumIntL(st, 9, 15) |
    bitNumIntL(st, 1, 16) | bitNumIntL(st, 7, 17) | bitNumIntL(st, 23, 18) | bitNumIntL(st, 13, 19) |
    bitNumIntL(st, 31, 20) | bitNumIntL(st, 26, 21) | bitNumIntL(st, 2, 22) | bitNumIntL(st, 8, 23) |
    bitNumIntL(st, 18, 24) | bitNumIntL(st, 12, 25) | bitNumIntL(st, 29, 26) | bitNumIntL(st, 5, 27) |
    bitNumIntL(st, 21, 28) | bitNumIntL(st, 10, 29) | bitNumIntL(st, 3, 30) | bitNumIntL(st, 24, 31)) >>> 0
  return st
}

function crypt(input, output, key) {
  const state = [0, 0]
  initialPermutation(state, input)
  for (let i = 0; i < 15; i++) {
    const t = state[1]
    state[1] = (feistel(state[1], key[i]) ^ state[0]) >>> 0
    state[0] = t
  }
  state[0] = (feistel(state[1], key[15]) ^ state[0]) >>> 0
  inverseInitialPermutation(state, output)
}

// 3DES-EDE 轮密钥表：3 组 × 16 轮 × 6 字节。
function makeSchedule() {
  return Array.from({ length: 3 }, () => Array.from({ length: 16 }, () => new Uint8Array(6)))
}

function setupDecrypt(key) {
  const schedule = makeSchedule()
  keySchedule(key.subarray(0, 8), schedule[2], DECRYPT)
  keySchedule(key.subarray(8, 16), schedule[1], ENCRYPT)
  keySchedule(key.subarray(16, 24), schedule[0], DECRYPT)
  return schedule
}

// QRC 官方固定密钥（24 字节，ASCII）。
const QQ_QRC_KEY = Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL', 'ascii')

// 解密 QRC：hex -> 3DES-EDE 分组解密 -> zlib inflate -> UTF-8 文本。
// 失败返回 null（调用方据此静默跳过该源）。
function decryptQrc(hex) {
  try {
    const src = Buffer.from(String(hex || '').trim(), 'hex')
    if (!src.length || src.length % 8 !== 0) return null
    const schedule = setupDecrypt(QQ_QRC_KEY)
    const out = Buffer.alloc(src.length)
    for (let i = 0; i < src.length; i += 8) {
      const block = Buffer.alloc(8)
      src.copy(block, 0, i, Math.min(i + 8, src.length))
      const tmp = Buffer.alloc(8)
      crypt(block, tmp, schedule[0])
      crypt(tmp, tmp, schedule[1])
      crypt(tmp, tmp, schedule[2])
      tmp.copy(out, i, 0, Math.min(8, src.length - i))
    }
    return require('zlib').inflateSync(out).toString('utf8')
  } catch { return null }
}

// 解开 QRC 里 XML 属性 / CDATA 常见的实体，数字引用也要还原。
function unescapeXmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// 解密后的文本可能是 QrcInfos XML（内容在 LyricContent 属性里），
// 也可能直接是裸 QRC 文本。
function extractQrcText(decrypted) {
  const text = String(decrypted || '')
  const attr = /LyricContent\s*=\s*"([\s\S]*?)"/.exec(text)
  if (attr) return unescapeXmlEntities(attr[1])
  return text.includes('<?xml') || text.includes('<QrcInfos') ? '' : text
}

// QRC 词级格式：`[行起始,行时长]词(词起始,词时长)词(词起始,词时长)...`
// 与酷狗 KRC 不同，词的开始时间是**绝对毫秒**（与网易云 YRC 一致），
// 且时间戳写在词文本之后。
function parseQrc(raw) {
  const content = extractQrcText(raw)
  const lines = []
  let offset = 0
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const off = /^\[offset:\s*(-?\d+)\]$/i.exec(line)
    if (off) { offset = +off[1] / 1000; continue }
    const lm = /^\[(\d+)\s*,\s*(\d+)\](.*)$/.exec(line)
    if (!lm) continue
    const lineStart = +lm[1] / 1000 + offset
    const lineDur = +lm[2] / 1000
    const rest = lm[3]
    // 先扫出所有 (起始,时长) 时间戳；词文本 = 上一个时间戳之后到本时间戳之前。
    const toks = []
    const re = /\((\d+)\s*,\s*(\d+)\)/g
    let tm
    while ((tm = re.exec(rest))) toks.push({ at: tm.index, end: re.lastIndex, start: +tm[1], dur: +tm[2] })
    const words = []
    let text = ''
    let prev = 0
    for (const t of toks) {
      const piece = rest.slice(prev, t.at)
      prev = t.end
      if (!piece) continue
      const wStart = t.start / 1000 + offset
      text += piece
      words.push({ text: piece, time: wStart, end: wStart + t.dur / 1000 })
    }
    if (!words.length || !text.trim()) continue
    lines.push({
      time: lineStart,
      end: lineStart + lineDur,
      text: text.trim(),
      words,
    })
  }
  return lines
}

module.exports = { decryptQrc, parseQrc, extractQrcText, unescapeXmlEntities, QQ_QRC_KEY }
