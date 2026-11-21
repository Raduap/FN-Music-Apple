// 悬浮歌词样式设置：与外观面板同款的弹窗，所有修改实时推送到悬浮歌词窗口预览
import { useEffect, useRef } from 'react'
import { useUI } from '../store'
import { Seg } from './common'
import { Slider } from './Player'
import * as Icon from '../icons'
import SPEC from '../../electron/lyricsVisualSpec.json'

export const DEFAULT_LYRICS_STYLE = SPEC.defaultStyle

const LABELS = {
  system: '系统', round: '圆润', serif: '衬线', mono: '等宽',
  400: '常规', 500: '中黑', 600: '加粗', 700: '特粗',
  dark: '深色', light: '浅色', cover: '跟随封面', custom: '自定义图片',
}
const FONTS = SPEC.fonts.map((value) => [value, LABELS[value]])
const WEIGHTS = SPEC.weights.map((value) => [value, LABELS[value]])
const BACKGROUNDS = SPEC.backgroundModes.map((value) => [value, LABELS[value]])

export function FloatingLyricsSettings() {
  const open = useUI((s) => s.lyricsSettingsOpen)
  const close = useUI((s) => s.closeLyricsSettings)
  const saved = useUI((s) => s.lyricsStyle)
  const backgroundUrl = useUI((s) => s.lyricsBackgroundUrl)
  const ui = useUI.getState
  const ref = useRef(null)
  const lastFocus = useRef(null)
  const legacy = !saved.backgroundMode && saved.colorMode
    ? {
        backgroundMode: ['light', 'cover'].includes(saved.colorMode) ? saved.colorMode : DEFAULT_LYRICS_STYLE.backgroundMode,
        textColor: saved.textColor || saved.customColor || DEFAULT_LYRICS_STYLE.textColor,
        textColorCustom: saved.textColorCustom ?? saved.colorMode === 'custom',
      }
    : null
  const style = { ...DEFAULT_LYRICS_STYLE, ...saved, ...legacy }
  const set = (patch) => ui().setLyricsStyle(patch)

  useEffect(() => {
    if (!open) return
    ui().loadLyricsBackground?.()
    lastFocus.current = document.activeElement
    setTimeout(() => ref.current?.querySelector('button')?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape' && !ui().menu) { e.stopPropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close])

  if (!open) return null
  const trap = (e) => {
    if (e.key !== 'Tab') return
    const els = [...ref.current.querySelectorAll('button:not(:disabled), [role="slider"], input[type="color"]')]
    const first = els[0], last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="dialog-mask ap-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className="dialog ap fl" role="dialog" aria-modal="true" aria-labelledby="fl-title" onKeyDown={trap}>
        <header className="ap-head">
          <h2 id="fl-title">悬浮歌词</h2>
          <button className="icon-btn" onClick={close} aria-label="关闭" title="关闭 (Esc)"><Icon.Close size={16} /></button>
        </header>

        <section className="ap-sec">
          <div className="ap-row">
            <div className="ap-label">字号</div>
            <Slider label="字号" value={style.fontSize} max={SPEC.geometry.maxFont} step={1} onChange={(v) => set({ fontSize: Math.max(SPEC.geometry.minFont, Math.round(v)) })} valueText={(v) => `${Math.round(v)} 像素`} />
            <em>{style.fontSize}</em>
          </div>
          <div className="ap-row">
            <div className="ap-label">宽度</div>
            {/* 横排长度不限制上限；竖排长度由主进程按屏幕高度裁剪。滑块上限用 maxW 的若干倍，
                拖动 / 输入仍可继续放宽（主进程再做竖排裁剪）。 */}
            <Slider label={style.vertical ? '长度' : '宽度'} value={style.width} max={style.vertical ? SPEC.geometry.maxW : SPEC.geometry.maxW * 4} step={20} onChange={(v) => set({ width: Math.max(SPEC.geometry.minW, Math.round(v)) })} valueText={(v) => `${Math.round(v)} 像素`} />
            <em>{style.width}</em>
          </div>
          <div className="ap-row">
            <div className="ap-label">字体</div>
            <Seg small label="字体" value={style.fontFamily} onChange={(v) => set({ fontFamily: v })} options={FONTS.map(([value, label]) => ({ value, label }))} />
          </div>
          <div className="ap-row">
            <div className="ap-label">字重</div>
            <Seg small label="字重" value={style.weight} onChange={(v) => set({ weight: Number(v) })} options={WEIGHTS.map(([value, label]) => ({ value, label }))} />
          </div>
          <div className="ap-row">
            <div className="ap-label">对齐</div>
            <Seg small label="对齐" value={style.align} onChange={(v) => set({ align: v })} options={[{ value: 'center', label: '居中' }, { value: 'left', label: '左对齐' }]} />
          </div>
        </section>

        <section className="ap-sec">
          <div className="ap-label">背景</div>
          <div className="ap-palettes" role="radiogroup" aria-label="背景模式">
            {BACKGROUNDS.map(([value, label]) => (
              <button key={value} role="radio" aria-checked={style.backgroundMode === value} className={`ap-palette fl-color ${style.backgroundMode === value ? 'on' : ''}`} onClick={() => set(value === 'custom' && backgroundUrl ? { backgroundMode: value, customImage: true } : { backgroundMode: value, customImage: value === 'custom' && !!backgroundUrl })}>
                <span className={`fl-swatch ${value}`} style={value === 'custom' && backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")`, backgroundSize: 'cover' } : undefined} />
                <span className="ap-name">{label}</span>
              </button>
            ))}
          </div>
          {style.backgroundMode === 'custom' && (
            <div className="ap-links fl-bg-links">
              <button className="link-btn" onClick={() => ui().chooseLyricsBackground().then((ok) => ok && set({ backgroundMode: 'custom', customImage: true }))}>{backgroundUrl ? '更换背景图片…' : '选择背景图片…'}</button>
              {backgroundUrl && <button className="link-btn danger" onClick={() => ui().removeLyricsBackground().then(() => set({ customImage: false }))}>移除背景图片</button>}
            </div>
          )}
          <div className="ap-sliders">
            <div className="ap-slider">
              <span className="fl-slider-label">不透明度</span>
              <Slider label="不透明度" value={style.opacity} max={1} step={0.05} onChange={(v) => set({ opacity: Math.round(v * 100) / 100 })} valueText={(v) => `${Math.round(v * 100)}%`} />
              <em>{Math.round(style.opacity * 100)}%</em>
            </div>
            <div className="ap-slider">
              <span>毛玻璃强度</span>
              <Slider label="毛玻璃强度" value={style.frost} max={48} step={2} onChange={(v) => set({ frost: Math.round(v) })} valueText={(v) => `${Math.round(v)} 像素`} />
              <em>{style.frost}</em>
            </div>
          </div>
        </section>

        <section className="ap-sec">
          <div className="ap-row fl-custom">
            <div className="ap-label">文字颜色</div>
            <Seg small label="文字颜色" value={style.textColorCustom ? 'custom' : 'auto'} onChange={(v) => set({ textColorCustom: v === 'custom' })} options={[{ value: 'auto', label: '自动' }, { value: 'custom', label: '自定义' }]} />
            {style.textColorCustom && <input type="color" value={style.textColor} aria-label="自定义文字颜色" onChange={(e) => set({ textColor: e.target.value })} />}
          </div>
          <div className="ap-label">外观</div>
          <div className="fl-toggles">
            <button className={`fl-toggle ${style.showProgress ? 'on' : ''}`} role="switch" aria-checked={style.showProgress} onClick={() => set({ showProgress: !style.showProgress })}>
              <span>显示进度条</span><span className="fl-switch" aria-hidden="true" />
            </button>
            <button className={`fl-toggle ${style.showBorder ? 'on' : ''}`} role="switch" aria-checked={style.showBorder} onClick={() => set({ showBorder: !style.showBorder })}>
              <span>显示边框</span><span className="fl-switch" aria-hidden="true" />
            </button>
            <button className={`fl-toggle ${style.karaoke !== false ? 'on' : ''}`} role="switch" aria-checked={style.karaoke !== false} onClick={() => set({ karaoke: !(style.karaoke !== false) })}>
              <span>逐字扫色（需在实验设置里开启逐字歌词）</span><span className="fl-switch" aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className="ap-sec">
          <div className="ap-label">显示</div>
          <div className="fl-toggles">
            <button className={`fl-toggle ${style.showTranslation ? 'on' : ''}`} role="switch" aria-checked={style.showTranslation} onClick={() => set({ showTranslation: !style.showTranslation })}>
              <span>双语歌词显示译文</span><span className="fl-switch" aria-hidden="true" />
            </button>
            <button className={`fl-toggle ${style.showNext ? 'on' : ''}`} role="switch" aria-checked={style.showNext} onClick={() => set({ showNext: !style.showNext })}>
              <span>显示下一句（仅单语时更清爽）</span><span className="fl-switch" aria-hidden="true" />
            </button>
            <button className={`fl-toggle ${style.clickThrough ? 'on' : ''}`} role="switch" aria-checked={style.clickThrough} onClick={() => set({ clickThrough: !style.clickThrough })}>
              <span>鼠标穿透（锁定后把鼠标移到浮窗上自动解锁）</span><span className="fl-switch" aria-hidden="true" />
            </button>
          </div>
        </section>

        <footer className="ap-foot">
          <button className="link-btn danger" onClick={() => ui().resetLyricsStyle()}>恢复默认样式</button>
          <button className="link-btn" onClick={() => window.fn.lyricsResetPosition?.()}>重置位置</button>
          <button className="btn btn-accent" onClick={close}>完成</button>
        </footer>
      </div>
    </div>
  )
}

