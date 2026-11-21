import { describe, expect, it } from 'vitest'
import { mergeSyllableLines } from '../src/lyrics.js'

const w = (text, t, e) => ({ text, time: t, end: e })
const line = (text, t, e, words) => ({ text, time: t, end: e, words })

// 用户实测回归：川村ゆみ - キミの記憶。
// 本地 LRC 把一句写成一行，远端 kuwo 拆成两行；且远端用假名 / 异体写法
// （はかなく/儚く、キミ/君、优/優、一绪/一緒…），逐字完全相等对不上，
// 导致 Pass 1.4 合行漏判 → Pass 2 只挂第一段 → 整句 2 秒扫完、干等 2.5 秒。
describe('逐字合并：同义写法差异下的宽松合行（措施 A）', () => {
  it('假名/异体写法对不上时，仍能合行并把铺色铺到窗口末尾', () => {
    // L9：本地 69.10→73.37，远端 r11+r12（69.38→73.57）
    const local = [
      { time: 69.10, text: '儚く たゆたう 世界を君の手で守ったから' },
      { time: 73.37, text: '今はただ 翼をたたんで ゆっくり眠りなさい' },
    ]
    const remote = [
      line('はかなくたゆたう', 69.384, 70.794, [
        w('は', 69.384, 69.644), w('か', 69.644, 69.894), w('な', 69.894, 70.094),
        w('く', 70.094, 70.294), w('た', 70.294, 70.444), w('ゆ', 70.444, 70.594),
        w('た', 70.594, 70.694), w('う', 70.694, 70.794),
      ]),
      line('世界をキミの手で守ったから', 70.794, 73.574, [
        w('世', 70.794, 71.094), w('界', 71.094, 71.344), w('を', 71.344, 71.544),
        w('キ', 71.544, 71.844), w('ミ', 71.844, 72.144), w('の', 72.144, 72.444),
        w('手', 72.444, 72.744), w('で', 72.744, 72.944), w('守', 72.944, 73.244),
        w('っ', 73.244, 73.344), w('た', 73.344, 73.444), w('か', 73.444, 73.494),
        w('ら', 73.494, 73.574),
      ]),
      line('今はただ翼をたたんで', 73.574, 75.864, [w('今はただ翼をたたんで', 73.574, 75.864)]),
    ]
    const merged = mergeSyllableLines(local, remote)
    const l = merged[0]
    // 显示文本一个字都不改
    expect(l.words.map((x) => x.text).join('')).toBe(local[0].text)
    // 末词结束贴到窗口末尾（不再是 70.79 就扫完）
    const last = l.words[l.words.length - 1]
    expect(last.end ?? last.time).toBeGreaterThan(73.0)
  })

  it('繁体/简体/异体写法混用时也能合行', () => {
    // L12：本地「優しく 見守る 私の この手で眠りなさい」vs 远端「优しく见守るわたしの」+「この手で眠りなさい」
    const local = [
      { time: 86.09, text: '優しく 見守る 私の この手で眠りなさい' },
      { time: 90.49, text: '笑ってた 泣いてた 怒ってた 君の事覚えている' },
    ]
    const remote = [
      line('优しく见守るわたしの', 86.293, 88.713, [w('优しく见守るわたしの', 86.293, 88.713)]),
      line('この手で眠りなさい', 88.713, 90.58, [w('この手で眠りなさい', 88.713, 90.58)]),
      line('笑ってた泣いていた怒ってた', 90.582, 92.86, [w('笑ってた泣いていた怒ってた', 90.582, 92.86)]),
    ]
    const merged = mergeSyllableLines(local, remote)
    expect(merged[0].words.map((x) => x.text).join('')).toBe(local[0].text)
    const last = merged[0].words[merged[0].words.length - 1]
    expect(last.end ?? last.time).toBeGreaterThan(89.5)
  })

  it('首尾锚点护栏：远端第二行其实属于下一句时不误并', () => {
    // 本地 line1 = あああ いいい，line2 = ううう；远端 r1=あああ r2=ううう
    // 首行对得上、尾行对不上 → 不能把 r2 并进 line1（否则 line1 吞掉下一句）
    const local = [
      { time: 10, text: 'あああ いいい' },
      { time: 14, text: 'ううう' },
    ]
    const remote = [
      line('あああ', 10.05, 11.5, [w('あああ', 10.05, 11.5)]),
      line('ううう', 11.6, 13.8, [w('ううう', 11.6, 13.8)]),
    ]
    const merged = mergeSyllableLines(local, remote)
    const l = merged[0]
    if (l.words) {
      // 若发生合并，尾巴必须仍落在本行窗口内，且不能是「整句错位」
      const last = l.words[l.words.length - 1]
      expect(last.end ?? last.time).toBeLessThanOrEqual(14 + 0.35)
    }
    // line2 仍能正常配到 r2
    expect(merged[1].words?.map((x) => x.text).join('')).toBe('ううう')
  })

  it('繁琐写法差异下仍不误伤：完全不相干的远端行不会被硬并', () => {
    const local = [{ time: 10, text: '本地第一句歌词内容' }, { time: 14, text: '本地第二句歌词内容' }]
    const remote = [line('完全不相干的另一首歌的句子', 10.1, 13.5, [w('完全不相干的另一首歌的句子', 10.1, 13.5)])]
    const merged = mergeSyllableLines(local, remote)
    expect(merged[0].words?.map((x) => x.text).join('')).not.toBe('本地第一句歌词内容本地第二句歌词内容')
  })
})

describe('逐字合并：铺色提前扫完的兜底续接（措施 B）', () => {
  it('远端首段只覆盖句首、写法又对不上时，续接后续远端行铺到窗口末尾', () => {
    // 本地 10→16（下一句 16）；远端 r1 只覆盖前 2s、写法对不上，
    // r2 紧接其后、覆盖到 15.8，属同一句的续唱，应被续接进来。
    const local = [
      { time: 10, text: 'AAAA BBBB' },
      { time: 16, text: 'Next line here' },
    ]
    const remote = [
      line('AAAA', 10.1, 12.0, [w('AAAA', 10.1, 12.0)]),
      line('XXXX', 12.1, 15.8, [w('XXXX', 12.1, 15.8)]),
      line('Next line here', 16.1, 18.0, [w('Next line here', 16.1, 18.0)]),
    ]
    const merged = mergeSyllableLines(local, remote)
    const l = merged[0]
    expect(l.words?.length).toBeGreaterThan(1)
    const last = l.words[l.words.length - 1]
    expect(last.end ?? last.time).toBeGreaterThan(14.5)
    // 显示文本不变
    expect(l.words.map((x) => x.text).join('')).toBe('AAAA BBBB')
  })

  it('续接不越过本地行边界（间奏空行 / 下一句）', () => {
    const local = [
      { time: 1, text: '第一句' },
      { time: 5, text: '' }, // 间奏空行：是硬边界
      { time: 9, text: '第二句' },
    ]
    const remote = [
      { time: 1, text: '第一句', words: [w('第一句', 1, 2)] },
      { time: 5, text: '间奏假词', words: [w('间奏假词', 5, 6)] },
      { time: 9, text: '第二句', words: [w('第二句', 9, 11)] },
    ]
    const merged = mergeSyllableLines(local, remote)
    expect(merged[0].words?.length).toBe(1) // 只有本行自己的词，没吞间奏行
    expect(merged[1].words).toBeUndefined()
    expect(merged[2].words?.length).toBe(1)
  })
})
