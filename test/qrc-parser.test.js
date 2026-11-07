import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decryptQrc, extractQrcText, parseQrc, unescapeXmlEntities } from '../electron/qrc.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(here, '..', 'dev', 'fixtures', name), 'utf8')

describe('QQ 音乐 QRC 解密', () => {
  it('真实样本可解出 QrcInfos XML（回归：自定义 DES + zlib）', () => {
    const text = decryptQrc(fixture('qq-qrc-qingtian.hex'))
    expect(text).toBeTruthy()
    expect(text).toContain('<QrcInfos>')
    expect(text).toContain('LyricContent=')
    expect(text).toContain('[ti:晴天]')
  })

  it('非 8 字节对齐 / 非法 hex 返回 null 而不是抛错', () => {
    expect(decryptQrc('')).toBeNull()
    expect(decryptQrc('abcd')).toBeNull()
    expect(decryptQrc('zzzz')).toBeNull()
    expect(decryptQrc(null)).toBeNull()
  })
})

describe('QRC XML 解包', () => {
  it('从 LyricContent 属性取歌词并反转义 XML 实体', () => {
    const xml = '<Lyric_1 LyricContent="[0,1000]你(0,500)好(500,500) &apos;&amp;&lt;"/>'
    expect(extractQrcText(xml)).toBe('[0,1000]你(0,500)好(500,500) \'&<')
  })

  it('数字字符引用还原正确', () => {
    expect(unescapeXmlEntities('a&#10;b&#x41;c')).toBe('a\nbAc')
  })

  it('裸 QRC 文本不带 XML 包裹时原样返回', () => {
    expect(extractQrcText('[0,1000]你(0,500)好(500,500)')).toBe('[0,1000]你(0,500)好(500,500)')
  })
})

describe('QQ 音乐 QRC 解析', () => {
  it('词时间为绝对毫秒，词文本在时间戳之前', () => {
    const qrc = ['[ti:测试]', '[offset:0]', '[1000,2000]你(1000,500)好(1500,500)', '[3000,2000]再(3000,500)见(3500,500)'].join('\n')
    const lines = parseQrc(qrc)
    expect(lines).toHaveLength(2)
    expect(lines[0].text).toBe('你好')
    expect(lines[0].time).toBeCloseTo(1, 3)
    expect(lines[0].end).toBeCloseTo(3, 3)
    expect(lines[0].words[0]).toMatchObject({ text: '你' })
    expect(lines[0].words[0].time).toBeCloseTo(1, 3)
    expect(lines[0].words[0].end).toBeCloseTo(1.5, 3)
    expect(lines[0].words[1].time).toBeCloseTo(1.5, 3)
    expect(lines[1].words[1].time).toBeCloseTo(3.5, 3)
  })

  it('[offset:] 会把整首歌词平移', () => {
    const qrc = '[offset:500]\n[1000,1000]你(1000,500)好(1500,500)'
    const lines = parseQrc(qrc)
    expect(lines[0].time).toBeCloseTo(1.5, 3)
    expect(lines[0].words[0].time).toBeCloseTo(1.5, 3)
  })

  it('元数据行 / 空行 / 无词行被跳过', () => {
    const qrc = ['[ti:测试]', '[ar:某人]', '', '[1000,1000]你(1000,500)好(1500,500)', '[2000,1000]'].join('\n')
    const lines = parseQrc(qrc)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('你好')
  })

  it('真实样本解析出完整词级时间轴', () => {
    const lines = parseQrc(decryptQrc(fixture('qq-qrc-qingtian.hex')))
    expect(lines.length).toBeGreaterThan(50)
    const total = lines.reduce((n, l) => n + l.words.length, 0)
    expect(total).toBeGreaterThan(500)
    // 每个词都带有限的时间与文本
    for (const l of lines) {
      expect(l.text.length).toBeGreaterThan(0)
      for (const w of l.words) {
        expect(Number.isFinite(w.time)).toBe(true)
        expect(Number.isFinite(w.end)).toBe(true)
      }
    }
  })

  it('词文本自带括号时不被误判成时间戳', () => {
    const qrc = '[1000,2000]啊(1000,200)(这是(括号))(1200,200)好(1400,200)'
    const lines = parseQrc(qrc)
    // '(括号)' 不含数字，不会被当成 (起始,时长) 时间戳，而是算作下一个词的文本。
    expect(lines[0].text).toBe('啊(这是(括号))好')
    expect(lines[0].words.map((w) => w.text)).toEqual(['啊', '(这是(括号))', '好'])
    expect(lines[0].words[1].time).toBeCloseTo(1.2, 3)
    expect(lines[0].words[2].time).toBeCloseTo(1.4, 3)
  })
})
