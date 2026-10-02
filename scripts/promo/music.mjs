// 宣传片配乐：用代码合成（无版权问题），90 BPM，20 小节，与 compose.js 的场景切换对齐
// 和弦 Fmaj7 – G6 – Em7 – Am7 循环，最后解决到 Cmaj9
// 编排：片头只有铺底；第 3 小节起加贝斯与琶音；第 5 小节起加轻柔的鼓；最后两小节鼓退出，留下铺底收尾
// 运行：node scripts/promo/music.mjs <输出.wav>
import { writeFileSync } from 'node:fs'

const SR = 44100
const BPM = 90
const BEAT = 60 / BPM
const BAR = BEAT * 4
const BARS = 20
const LEN = Math.ceil((BARS * BAR + 1.5) * SR)
const L = new Float32Array(LEN)
const R = new Float32Array(LEN)
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)

const CHORDS = [
  { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
  { root: 43, notes: [55, 59, 62, 64] }, // G6
  { root: 40, notes: [52, 55, 59, 62] }, // Em7
  { root: 45, notes: [57, 60, 64, 67] }, // Am7
]
const FINAL = { root: 36, notes: [48, 52, 55, 59, 62] } // Cmaj9
const chordAt = (bar) => (bar >= BARS - 1 ? FINAL : CHORDS[bar % 4])

// 伪随机（固定种子，结果可复现）
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1

function add(buf, i, v) { if (i >= 0 && i < LEN) buf[i] += v }

// 铺底：每个和弦音用略微失谐的两个正弦 + 少量三次谐波，慢起慢收
function pad(start, dur, midi, gain, pan) {
  const f = hz(midi)
  const s0 = Math.floor(start * SR), n = Math.floor((dur + 1.2) * SR)
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.9) * (t > dur ? Math.exp(-(t - dur) * 3) : 1)
    const v = (Math.sin(2 * Math.PI * f * 0.997 * t) + Math.sin(2 * Math.PI * f * 1.003 * t) + 0.18 * Math.sin(2 * Math.PI * f * 3 * t)) * env * gain
    add(L, s0 + k, v * (1 - pan)); add(R, s0 + k, v * pan)
  }
}

// 拨弦：快速衰减的正弦 + 二次谐波
function pluck(start, midi, gain, pan, decay = 5) {
  const f = hz(midi)
  const s0 = Math.floor(start * SR), n = Math.floor(1.2 * SR)
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.004) * Math.exp(-t * decay)
    const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 8)) * env * gain
    add(L, s0 + k, v * (1 - pan)); add(R, s0 + k, v * pan)
  }
}

function bass(start, midi, dur, gain) {
  const f = hz(midi)
  const s0 = Math.floor(start * SR), n = Math.floor((dur + 0.3) * SR)
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.01) * (t > dur ? Math.exp(-(t - dur) * 12) : Math.exp(-t * 0.9))
    const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t)) * env * gain
    add(L, s0 + k, v); add(R, s0 + k, v)
  }
}

function kick(start, gain) {
  const s0 = Math.floor(start * SR), n = Math.floor(0.4 * SR)
  let ph = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const f = 45 + 90 * Math.exp(-t * 30)
    ph += 2 * Math.PI * f / SR
    const v = Math.sin(ph) * Math.exp(-t * 9) * gain
    add(L, s0 + k, v); add(R, s0 + k, v)
  }
}

function hat(start, gain, pan) {
  const s0 = Math.floor(start * SR), n = Math.floor(0.08 * SR)
  let prev = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const x = rand()
    const v = (x - prev) * Math.exp(-t * 60) * gain // 一阶差分 ≈ 高通，去掉低频的“噗”声
    prev = x
    add(L, s0 + k, v * (1 - pan)); add(R, s0 + k, v * pan)
  }
}

// ---------- 编排 ----------
for (let bar = 0; bar < BARS; bar++) {
  const t0 = bar * BAR
  const c = chordAt(bar)
  const last = bar === BARS - 1
  c.notes.forEach((m, i) => pad(t0, last ? BAR * 1.6 : BAR, m, bar < 2 ? 0.045 : 0.055, 0.3 + i * 0.13))

  if (bar >= 2 && !last) {
    bass(t0, c.root, BEAT * 1.8, 0.22)
    bass(t0 + BEAT * 2, c.root, BEAT * 1.8, 0.18)
    const order = [0, 1, 2, 3, 2, 1, 2, 3]
    for (let i = 0; i < 8; i++) {
      const m = c.notes[order[i] % c.notes.length] + 12
      const g = (bar < 4 ? 0.05 : 0.07) * (i % 2 ? 0.75 : 1)
      pluck(t0 + i * BEAT / 2, m, g, i % 2 ? 0.68 : 0.32)
    }
  }
  if (last) {
    bass(t0, c.root, BAR * 1.2, 0.2)
    c.notes.forEach((m, i) => pluck(t0 + i * 0.09, m + 12, 0.06, 0.3 + i * 0.1, 1.6))
  }
  // 鼓：第 5 小节到倒数第 3 小节
  if (bar >= 4 && bar < BARS - 2) {
    kick(t0, 0.5)
    kick(t0 + BEAT * 2, 0.42)
    if (bar % 4 === 3) kick(t0 + BEAT * 3.5, 0.3)
    for (let i = 0; i < 4; i++) hat(t0 + i * BEAT + BEAT / 2, 0.06, i % 2 ? 0.7 : 0.3)
  }
}

// ---------- 乒乓延迟（让拨弦有空间感），再做软限幅与淡入淡出 ----------
const D = Math.floor(BEAT * 0.75 * SR)
for (let i = D; i < LEN; i++) {
  L[i] += R[i - D] * 0.28
  R[i] += L[i - D] * 0.28
}
let peak = 0
for (let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const norm = 0.9 / Math.max(peak, 1e-6)
const fadeIn = 0.4 * SR, fadeOut = 2.5 * SR, end = Math.floor(BARS * BAR * SR)
const out = Buffer.alloc(44 + end * 4)
out.write('RIFF', 0); out.writeUInt32LE(36 + end * 4, 4); out.write('WAVEfmt ', 8)
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22)
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34)
out.write('data', 36); out.writeUInt32LE(end * 4, 40)
for (let i = 0; i < end; i++) {
  const g = Math.min(1, i / fadeIn) * Math.min(1, (end - i) / fadeOut)
  const l = Math.tanh(L[i] * norm * 1.1) * g, r = Math.tanh(R[i] * norm * 1.1) * g
  out.writeInt16LE(Math.round(l * 32000), 44 + i * 4)
  out.writeInt16LE(Math.round(r * 32000), 46 + i * 4)
}
writeFileSync(process.argv[2] || 'promo-build/music.wav', out)
console.log(`配乐 ${(end / SR).toFixed(2)} 秒`)
