import { describe, expect, it } from 'vitest'
import { syllableOverrideMessage, translationDebugMessage } from '../src/lyricsDebug.js'

describe('翻译调试提示', () => {
  it('汇总来源、匹配、源站译文与 AI 补译行数', () => {
    const msg = translationDebugMessage({ title: 'Lemon' }, { source: 'netease', matched: 'Lemon / 米津玄師', sourceCount: 40, aiCount: 2, warning: '缺 1 行' }, { translate: true })
    expect(msg).toContain('Lemon')
    expect(msg).toContain('网易云')
    expect(msg).toContain('源站译文 40 行')
    expect(msg).toContain('AI 补译 2 行')
    expect(msg).toContain('缺 1 行')
  })

  it('只开音译时明确说明仅取同源音译', () => {
    const msg = translationDebugMessage({ title: 'Lemon' }, { source: 'netease', matched: 'Lemon / 米津玄師', sourceCount: 0, aiCount: 0 }, { translate: false, romanize: true })
    expect(msg).toContain('仅取同源音译')
  })

  it('无元信息时提示保留原文', () => {
    expect(translationDebugMessage({ title: 'Lemon' }, null, { translate: true })).toContain('已保留原文')
  })

  it('内部取消不作为用户可见失败原因', () => {
    const msg = translationDebugMessage({ title: 'Lemon' }, { source: 'none', sourceCount: 0, aiCount: 0, warning: 'cancelled' }, { translate: true })
    expect(msg).not.toMatch(/cancel/i)
  })

  it('跳过翻译时提示具体原因', () => {
    const msg = translationDebugMessage({ title: '晴天' }, { source: 'none', warning: '当前歌词不是可翻译/音译的外语内容', skipped: true }, { translate: true })
    expect(msg).toContain('未发起翻译')
    expect(msg).toContain('不是可翻译')
  })
})

describe('覆盖歌词状态提示', () => {
  it('覆盖成功时报告来源、provider 与覆盖率', () => {
    const msg = syllableOverrideMessage(
      { title: '晴天' },
      { overwritten: true, source: 'qq', provider: 'qq-qrc', coverage: 0.976 },
      { enabled: true },
    )
    expect(msg).toContain('晴天')
    expect(msg).toContain('覆盖成功')
    expect(msg).toContain('QQ 音乐/qq-qrc')
    expect(msg).toContain('98%')
  })

  it('候选未通过可信校验时明确继续使用本地歌词', () => {
    const msg = syllableOverrideMessage(
      { title: '晴天' },
      { overwritten: false, source: 'qq', provider: 'qq-qrc', coverage: 0.82 },
      { enabled: true },
    )
    expect(msg).toContain('未通过可信校验')
    expect(msg).toContain('继续使用本地歌词')
  })

  it('没有候选与抓取异常分别提示', () => {
    expect(syllableOverrideMessage({ title: '晴天' }, null, { enabled: true })).toContain('没有可用逐字源')
    expect(syllableOverrideMessage({ title: '晴天' }, null, { enabled: true, error: '网络错误' })).toContain('覆盖失败，网络错误')
  })

  it('覆盖关闭时不产生提示', () => {
    expect(syllableOverrideMessage({ title: '晴天' }, { overwritten: true }, { enabled: false })).toBe('')
  })
})
