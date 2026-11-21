import { describe, expect, it } from 'vitest'
import { karaokeFills, mergeSyllableLines } from '../src/lyrics.js'

const w = (text, t, e) => ({ text, time: t, end: e })

// 用户实测回归（真实曲库 + 真实源）：
// 1. 句首「一下跳好几个字」
// 2. 空格前后「一下跳好几个字」
// 3. 结尾「还没走完就直接跳变」
// 4. 本地一行 = 远端连续多句时「铺完干等 + 背景色停顿」
// 这里用真实抓取到的词级时间轴做定格回归。
describe('逐字扫色：句首 / 空格 / 句尾的跳变回归', () => {
  const kFilled = (line, t) => {
    const k = karaokeFills(line, t)
    if (!k) return null
    const solid = line.words.map((x) => [...String(x.text)].filter((c) => /\S/.test(c)).length)
    return k.fills.reduce((s, f, i) => s + f * solid[i], 0)
  }

  it('句首：首词早于本行起点时整条时间轴后移，起句从 0 开始铺', () => {
    // YOASOBI - 三原色 行 40：本地 t=103.394，远端首词 103.201（早 0.193s）
    const local = [{ time: 103.394, text: 'それでも変わってしまったことだって' }]
    const remote = [{
      time: 103.201, end: 107.803, text: 'それでも変わってしまったことだって',
      words: [
        w('それで', 103.201, 103.604), w('も変わ', 103.604, 104.143), w('ってし', 104.382, 105.496),
        w('まった', 105.496, 106.588), w('ことだ', 106.588, 107.503), w('って', 107.503, 107.803),
      ],
    }]
    const l = mergeSyllableLines(local, remote)[0]
    expect(l.words[0].time).toBeCloseTo(103.394, 3)
    // 起句那一刻还没有任何铺色
    expect(kFilled(l, l.time)).toBeCloseTo(0, 2)
  })

  it('空格：纯空白远端词不占用索引，空格后仍按真实时间推进', () => {
    // Aimer - 残響散歌 行 12：QQ QRC 里空格是 0ms 的独立 token
    const local = [{ time: 48.260, text: '声よ轟け 夜のその向こうへ' }]
    const remote = [{
      time: 48.267, end: 51.263, text: '声よ轟け 夜のその向こうへ',
      words: [
        w('声', 48.267, 48.646), w('よ', 48.646, 48.717), w('轟', 48.717, 49.325), w('け', 49.325, 49.757),
        w(' ', 49.757, 49.757), // 0ms 空格
        w('夜', 49.757, 50.036), w('の', 50.036, 50.079), w('そ', 50.079, 50.383), w('の', 50.383, 50.430),
        w('向', 50.430, 50.750), w('こ', 50.750, 50.966), w('う', 50.966, 51.182), w('へ', 51.182, 51.263),
      ],
    }]
    const l = mergeSyllableLines(local, remote)[0]
    expect(l.words.map((x) => x.text).join('')).toBe('声よ轟け 夜のその向こうへ')
    // 空格归并进「夜」，且「夜」不再被压成 30ms
    const ye = l.words.find((x) => x.text.includes('夜'))
    expect(ye.end - ye.time).toBeGreaterThan(0.2)
    // 任意一帧的进度增量都有界（不再「一下跳好几个字」）
    let prev = -1
    for (let t = 48.26; t <= 51.26; t += 1 / 60) {
      const f = kFilled(l, t)
      if (prev >= 0) expect(f - prev).toBeLessThan(0.6)
      prev = f
    }
  })

  it('本地一行 = 远端连续多句：合并两段词，整句都有铺色、结尾贴到下一句', () => {
    // 水瀬いのり - アイマイモコ 行 2：本地一句 = 远端「些細な出来事さえも」+「特別だって思うよ」
    const local = [
      { time: 36.400, text: '些細な出来事さえも 特別だって思うよ' },
      { time: 43.240, text: 'ほらね 今も君のこと 考えちゃうの' },
    ]
    const remote = [
      { time: 36.037, end: 39.076, text: '些細な出来事さえも', words: [
        w('些', 36.037, 36.317), w('細', 36.317, 36.763), w('な', 36.763, 36.995), w('出', 36.995, 37.374),
        w('来', 37.374, 37.654), w('事', 37.654, 38.166), w('さ', 38.166, 38.464), w('え', 38.464, 38.829), w('も', 38.829, 39.076),
      ] },
      { time: 39.642, end: 42.9, text: '特別だって思うよ', words: [
        w('特', 39.642, 40.201), w('別', 40.201, 40.647), w('だ', 40.647, 40.893), w('っ', 40.893, 41.127),
        w('て', 41.127, 41.589), w('思', 41.589, 42.151), w('う', 42.151, 42.547), w('よ', 42.547, 42.9),
      ] },
    ]
    const l = mergeSyllableLines(local, remote)[0]
    expect(l.words.map((x) => x.text).join('')).toBe('些細な出来事さえも 特別だって思うよ')
    // 首段与第二段都在
    expect(l.words.some((x) => x.text.includes('特'))).toBe(true)
    // 起句从 0 开始、结尾能铺满
    expect(kFilled(l, 36.4)).toBeCloseTo(0, 2)
    expect(kFilled(l, 42.9)).toBeGreaterThan(kFilled(l, 39.2))
  })

  it('结尾：末词结束被收口到下一句起点，切句前能铺满', () => {
    const local = [
      { time: 160.1, text: 'Said no more counting dollars' },
      { time: 162.03, text: "We'll be counting stars" },
    ]
    const remote = [{
      time: 160.53, end: 162.03, text: 'Said no more counting dollars',
      words: [
        w('Said', 160.53, 160.92), w(' no', 160.92, 161.16), w(' more', 161.16, 161.4),
        w(' counting', 161.4, 161.94), w(' dollars', 161.94, 162.03),
      ],
    }]
    const l = mergeSyllableLines(local, remote)[0]
    const last = l.words[l.words.length - 1]
    expect(last.end).toBeLessThanOrEqual(162.03 + 1e-9)
    expect(kFilled(l, 162.03)).toBeCloseTo(25, 1)
  })
})
