import { describe, expect, it } from 'vitest'
import icons from '../electron/thumbarIcons.js'
import SHAPES from '../src/iconShapes.json'

const { NAMES, SIZES, COLORS, glyph } = icons

describe('thumbarIcons', () => {
  it('复用界面图标库里的播放控制图形', () => {
    expect(Object.keys(SHAPES).sort()).toEqual([...NAMES].sort())
    for (const name of NAMES) expect(SHAPES[name].length).toBeGreaterThan(0)
    expect(NAMES).toEqual(['prev', 'play', 'pause', 'next'])
    expect(SIZES).toEqual([16, 20, 24, 32, 40, 48])
    expect(COLORS).toEqual({ dark: '#ffffff', light: '#1f1f1f' })
  })

  it('按尺寸与主题生成合法 SVG', () => {
    for (const name of NAMES) {
      for (const size of SIZES) {
        const svg = glyph(name, size, COLORS.dark)
        expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
        expect(svg).toContain(`width="${size}"`)
        expect(svg).toContain(`height="${size}"`)
        expect(svg).toContain('viewBox="0 0 24 24"')
        expect(svg).toContain('fill="#ffffff"')
      }
    }
  })

  it('16px 下略微放大保持清晰', () => {
    expect(glyph('play', 16, COLORS.dark)).toContain('scale(1.05)')
    expect(glyph('play', 32, COLORS.dark)).toContain('scale(1)')
  })

  it('四个图标的形状各不相同', () => {
    const bodies = NAMES.map((name) => glyph(name, 32, COLORS.light))
    expect(new Set(bodies).size).toBe(4)
    // 暂停是两根竖条，其余都是填充的路径
    expect(SHAPES.pause.every((n) => n.t === 'rect')).toBe(true)
    expect(SHAPES.play.every((n) => n.t === 'path')).toBe(true)
  })
})
