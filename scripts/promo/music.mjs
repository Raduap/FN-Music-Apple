// 宣传片配乐：用代码合成（无版权问题），96 BPM，24 小节，每小节 2.5 秒，与 compose.js 的场景切换对齐
// 和弦 Fmaj7 – G6 – Em7 – Am7 循环，最后解决到 Cmaj9
// 编排：开场两小节只有铺底和零星的钢琴音，末尾一段上扬的噪声推到第 3 小节的重拍（片名出现）；
// 第 5 小节起进鼓（底鼓、拍手、踩镲）与八分音符贝斯，铺底随底鼓起伏；换场前加一小段上扬；
// 第 22 小节起鼓退出，留下铺底与钢琴收尾
// 运行：node scripts/promo/music.mjs <输出.wav>
import { writeFileSync } from 'node:fs'

const SR = 44100
const BPM = 96
const BEAT = 60 / BPM
const BAR = BEAT * 4
const BARS = 24
const LEN = Math.ceil((BARS * BAR + 2) * SR)
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)

// 两组声部分开混：铺底类（会被底鼓压低，形成律动）与其余
const bus = () => ({ L: new Float32Array(LEN), R: new Float32Array(LEN) })
const soft = bus()
const dry = bus()

const CHORDS = [
  { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
  { root: 43, notes: [55, 59, 62, 64] }, // G6
  { root: 40, notes: [52, 55, 59, 62] }, // Em7
  { root: 45, notes: [57, 60, 64, 67] }, // Am7
]
const FINAL = { root: 36, notes: [48, 52, 55, 59, 62] } // Cmaj9
const OUTRO = 21 // 片尾从这一小节开始
const chordAt = (bar) => (bar >= OUTRO ? FINAL : CHORDS[bar % 4])

// 伪随机（固定种子，结果可复现）
let seed = 11
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1

function put(b, i, v, pan) {
  if (i < 0 || i >= LEN) return
  b.L[i] += v * (1 - pan)
  b.R[i] += v * pan
}

// 铺底：每个和弦音用略微失谐的两个正弦 + 少量三次谐波，慢起慢收
function pad(start, dur, midi, gain, pan) {
  const f = hz(midi)
  const s0 = Math.floor(start * SR), n = Math.floor((dur + 1.4) * SR)
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.7) * (t > dur ? Math.exp(-(t - dur) * 3) : 1)
    const v = (Math.sin(2 * Math.PI * f * 0.996 * t) + Math.sin(2 * Math.PI * f * 1.004 * t) + 0.15 * Math.sin(2 * Math.PI * f * 3 * t)) * env * gain
    put(soft, s0 + k, v, pan)
  }
}

// 钢琴感的音：基音 + 几个快速衰减的泛音，起音干净
function keys(start, midi, gain, pan, decay = 2.2) {
  const f = hz(midi)
  const s0 = Math.floor(start * SR), n = Math.floor(2.4 * SR)
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.003) * Math.exp(-t * decay)
    const v = (Math.sin(2 * Math.PI * f * t) + 0.45 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 4) + 0.2 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t * 7) + 0.08 * Math.sin(2 * Math.PI * f * 4.02 * t) * Math.exp(-t * 10)) * env * gain
    put(dry, s0 + k, v, pan)
  }
}

// 拨弦：快速衰减的正弦 + 二次谐波
function pluck(start, midi, gain, pan) {
  const f = hz(midi)
  const s0 = Math.floor(start * SR), n = Math.floor(0.9 * SR)
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 7)
    const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 10)) * env * gain
    put(soft, s0 + k, v, pan)
  }
}

function bass(start, midi, dur, gain) {
  const f = hz(midi)
  const s0 = Math.floor(start * SR), n = Math.floor((dur + 0.15) * SR)
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.006) * (t > dur ? Math.exp(-(t - dur) * 30) : Math.exp(-t * 2.5))
    const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t) + 0.08 * Math.sin(2 * Math.PI * f * 3 * t)) * env * gain
    put(dry, s0 + k, v, 0.5)
  }
}

const kicks = []
function kick(start, gain, tail = 9) {
  kicks.push(start)
  const s0 = Math.floor(start * SR), n = Math.floor(0.6 * SR)
  let ph = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const f = 48 + 110 * Math.exp(-t * 32)
    ph += 2 * Math.PI * f / SR
    const v = (Math.sin(ph) * Math.exp(-t * tail) + (t < 0.004 ? rand() * 0.3 : 0)) * gain
    put(dry, s0 + k, v, 0.5)
  }
}

// 重拍：长尾的低频 + 一记底鼓，用在片名出现和片尾
function boom(start, gain) {
  kick(start, gain * 0.9, 5)
  const s0 = Math.floor(start * SR), n = Math.floor(2.2 * SR)
  for (let k = 0; k < n; k++) {
    const t = k / SR
    put(dry, s0 + k, Math.sin(2 * Math.PI * 41 * t) * Math.exp(-t * 1.6) * Math.min(1, t / 0.01) * gain * 0.6, 0.5)
  }
}

// 拍手：几次很近的噪声短脉冲叠在一起，再做一阶高通
function clap(start, gain) {
  const s0 = Math.floor(start * SR), n = Math.floor(0.25 * SR)
  let prev = 0, lp = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const x = rand()
    lp += (x - lp) * 0.35
    const hp = lp - prev
    prev = lp
    const env = [0, 0.011, 0.022].reduce((s, d) => s + (t >= d ? Math.exp(-(t - d) * (d === 0.022 ? 22 : 140)) : 0), 0)
    put(dry, s0 + k, hp * env * gain, 0.5)
  }
}

function hat(start, gain, pan) {
  const s0 = Math.floor(start * SR), n = Math.floor(0.06 * SR)
  let prev = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const x = rand()
    put(dry, s0 + k, (x - prev) * Math.exp(-t * 75) * gain, pan) // 一阶差分 ≈ 高通，去掉低频的“噗”声
    prev = x
  }
}

// 上扬：噪声由弱到强、由暗到亮，在 end 时刻戛然而止
function riser(end, dur, gain) {
  const s0 = Math.floor((end - dur) * SR), n = Math.floor(dur * SR)
  let lp = 0
  for (let k = 0; k < n; k++) {
    const p = k / n
    const x = rand()
    lp += (x - lp) * (0.02 + 0.5 * p * p)
    const v = (x - lp * 0.6) * Math.pow(p, 2.2) * gain
    put(soft, s0 + k, v, 0.5 + Math.sin(p * 9) * 0.15)
  }
}

// ---------- 编排 ----------
const SCENES = [2, 4, 7, 11, 15, 18, OUTRO] // 场景切换的小节（与 compose.js 一致）
for (let bar = 0; bar < BARS; bar++) {
  const t0 = bar * BAR
  const c = chordAt(bar)
  const outro = bar >= OUTRO
  const groove = bar >= 4 && !outro
  if (!outro || bar === OUTRO) c.notes.forEach((m, i) => pad(t0, outro ? BAR * 2.4 : BAR, m, bar < 2 ? 0.035 : 0.045, 0.28 + i * 0.12))

  // 开场：零星的钢琴音
  if (bar < 2) {
    ;[0, 1.5, 2.5].forEach((b, i) => keys(t0 + b * BEAT, c.notes[[3, 2, 1][i]] + 12, 0.07, 0.4 + i * 0.1))
  }
  // 片名：和弦一齐落下
  if (bar === 2) c.notes.forEach((m, i) => keys(t0 + i * 0.012, m + 12, 0.06, 0.3 + i * 0.12, 1.4))
  if (bar === 3) [0, 1, 2, 3].forEach((b) => keys(t0 + b * BEAT, c.notes[b % 4] + 12, 0.045, 0.35 + b * 0.1))

  if (groove) {
    for (let i = 0; i < 8; i++) {
      bass(t0 + i * BEAT / 2, c.root + (i === 7 ? 12 : 0), BEAT * 0.38, i % 2 ? 0.16 : 0.2)
      const order = [0, 2, 1, 3, 2, 1, 3, 2]
      pluck(t0 + i * BEAT / 2, c.notes[order[i]] + 12, (i % 2 ? 0.05 : 0.065), i % 2 ? 0.7 : 0.3)
    }
    kick(t0, 0.55); kick(t0 + BEAT, 0.45); kick(t0 + BEAT * 2, 0.5); kick(t0 + BEAT * 3, 0.45)
    clap(t0 + BEAT, 0.22); clap(t0 + BEAT * 3, 0.22)
    for (let i = 0; i < 8; i++) hat(t0 + i * BEAT / 2 + (i % 2 ? 0.012 : 0), i % 2 ? 0.07 : 0.035, i % 2 ? 0.72 : 0.28)
    // 一句旋律：每两小节一次，钢琴在高音区应答
    if (bar % 2 === 1) [[0, 3], [0.75, 2], [1.5, 1], [2.5, 2]].forEach(([b, n]) => keys(t0 + b * BEAT, c.notes[n] + 24, 0.035, 0.6))
  }
  if (SCENES.includes(bar + 1) && bar >= 1) riser(t0 + BAR, bar === 1 || bar + 1 === OUTRO ? 2.2 : 1.1, bar === 1 ? 0.16 : 0.09)

  // 片尾：重拍 + 慢慢展开的钢琴琶音
  if (bar === OUTRO) {
    boom(t0, 0.5)
    bass(t0, c.root, BAR * 1.6, 0.18)
    c.notes.forEach((m, i) => keys(t0 + 0.4 + i * 0.16, m + 12, 0.055, 0.25 + i * 0.12, 1.1))
  }
  if (bar === OUTRO + 1) c.notes.slice().reverse().forEach((m, i) => keys(t0 + BEAT + i * 0.22, m + 24, 0.03, 0.7 - i * 0.1, 1.2))
}
boom(2 * BAR, 0.5)

// ---------- 底鼓触发的音量起伏（铺底随律动“呼吸”） ----------
const duck = new Float32Array(LEN).fill(1)
for (const k of kicks) {
  const s0 = Math.floor(k * SR), n = Math.floor(0.3 * SR)
  for (let i = 0; i < n && s0 + i < LEN; i++) duck[s0 + i] = Math.min(duck[s0 + i], 1 - 0.55 * Math.exp(-(i / SR) * 11))
}

// ---------- 乒乓延迟（只给铺底与拨弦），混合，再做软限幅与淡入淡出 ----------
const D = Math.floor(BEAT * 0.75 * SR)
for (let i = D; i < LEN; i++) {
  soft.L[i] += soft.R[i - D] * 0.25
  soft.R[i] += soft.L[i - D] * 0.25
}
const L = new Float32Array(LEN), R = new Float32Array(LEN)
for (let i = 0; i < LEN; i++) {
  L[i] = soft.L[i] * duck[i] + dry.L[i]
  R[i] = soft.R[i] * duck[i] + dry.R[i]
}
let peak = 0
for (let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const norm = 0.9 / Math.max(peak, 1e-6)
const fadeIn = 0.05 * SR, fadeOut = 2.4 * SR, end = Math.floor(BARS * BAR * SR)
const out = Buffer.alloc(44 + end * 4)
out.write('RIFF', 0); out.writeUInt32LE(36 + end * 4, 4); out.write('WAVEfmt ', 8)
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22)
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34)
out.write('data', 36); out.writeUInt32LE(end * 4, 40)
for (let i = 0; i < end; i++) {
  const g = Math.min(1, i / fadeIn) * Math.min(1, (end - i) / fadeOut)
  const l = Math.tanh(L[i] * norm * 1.25) * g, r = Math.tanh(R[i] * norm * 1.25) * g
  out.writeInt16LE(Math.round(l * 32000), 44 + i * 4)
  out.writeInt16LE(Math.round(r * 32000), 46 + i * 4)
}
writeFileSync(process.argv[2] || 'promo-build/music.wav', out)
console.log(`配乐 ${(end / SR).toFixed(2)} 秒`)
