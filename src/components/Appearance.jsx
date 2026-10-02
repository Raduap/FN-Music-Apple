// 外观设置面板：模式（浅色 / 深色 / 跟随系统）、主题色、壁纸。所有修改即时生效，背后就是实时预览
import { useEffect, useRef } from 'react'
import { useUI } from '../store'
import { PALETTES, PRESET_WALLPAPERS, wallpaperVars } from '../appearance'
import { Seg } from './common'
import { Slider } from './Player'
import * as Icon from '../icons'

// 当前是否有壁纸要显示（自选图片还没读出来时先不显示）
export function useActiveWallpaper() {
  const wp = useUI((s) => s.wallpaper)
  const url = useUI((s) => s.wallpaperUrl)
  const on = wp.kind === 'preset' || (wp.kind === 'custom' && !!url)
  return { on, wp, url, vars: on ? wallpaperVars(wp) : null }
}

// 壁纸层：放在 .app 下面，固定铺满窗口
export function Wallpaper() {
  const { on, wp, url } = useActiveWallpaper()
  useEffect(() => { useUI.getState().loadWallpaper() }, [])
  if (!on) return null
  return wp.kind === 'custom'
    ? <div key={url} className="wallpaper" style={{ backgroundImage: `url("${url}")` }} aria-hidden="true" />
    : <div key={wp.preset} className={`wallpaper wp-${wp.preset}`} aria-hidden="true" />
}

const Check = () => <span className="ap-check" aria-hidden="true"><Icon.Check size={12} /></span>

export function AppearancePanel() {
  const open = useUI((s) => s.appearanceOpen)
  const close = useUI((s) => s.closeAppearance)
  const theme = useUI((s) => s.theme)
  const palette = useUI((s) => s.palette)
  const wp = useUI((s) => s.wallpaper)
  const url = useUI((s) => s.wallpaperUrl)
  const ui = useUI.getState
  const panelRef = useRef(null)
  const lastFocus = useRef(null)

  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement
    ui().loadWallpaper()
    setTimeout(() => panelRef.current?.querySelector('button')?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape' && !ui().menu) { e.stopPropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close])

  if (!open) return null

  const pickCustom = () => (url ? ui().setWallpaper({ kind: 'custom' }) : ui().chooseWallpaper())
  // Tab 焦点限制在面板内
  const trap = (e) => {
    if (e.key !== 'Tab') return
    const els = [...panelRef.current.querySelectorAll('button:not(:disabled), [role="slider"]')]
    const first = els[0], last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="dialog-mask ap-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={panelRef} className="dialog ap" role="dialog" aria-modal="true" aria-labelledby="ap-title" onKeyDown={trap}>
        <header className="ap-head">
          <h2 id="ap-title">外观</h2>
          <button className="icon-btn" onClick={close} aria-label="关闭" title="关闭 (Esc)"><Icon.Close size={16} /></button>
        </header>

        <section className="ap-sec">
          <div className="ap-row">
            <div className="ap-label">模式</div>
            <Seg small label="外观模式" value={theme} onChange={(v) => ui().setTheme(v)} options={[{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} />
          </div>
        </section>

        <section className="ap-sec">
          <div className="ap-label">主题色</div>
          <div className="ap-palettes" role="radiogroup" aria-label="主题色">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={palette === p.id}
                className={`ap-palette ${palette === p.id ? 'on' : ''}`}
                style={{ '--sw1': p.swatch[0], '--sw2': p.swatch[1] }}
                onClick={() => ui().setPalette(p.id)}
              >
                <span className="ap-swatch">{palette === p.id && <Check />}</span>
                <span className="ap-name">{p.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ap-sec">
          <div className="ap-label">壁纸</div>
          <div className="ap-walls" role="radiogroup" aria-label="壁纸">
            <button role="radio" aria-checked={wp.kind === 'none'} className={`ap-wall none ${wp.kind === 'none' ? 'on' : ''}`} onClick={() => ui().setWallpaper({ kind: 'none' })}>
              <span className="ap-thumb"><Icon.Close size={18} /></span>
              <span className="ap-name">无</span>
              {wp.kind === 'none' && <Check />}
            </button>
            {PRESET_WALLPAPERS.map((w) => {
              const on = wp.kind === 'preset' && wp.preset === w.id
              return (
                <button key={w.id} role="radio" aria-checked={on} className={`ap-wall ${on ? 'on' : ''}`} onClick={() => ui().setWallpaper({ kind: 'preset', preset: w.id })}>
                  <span className={`ap-thumb wp-${w.id}`} />
                  <span className="ap-name">{w.name}</span>
                  {on && <Check />}
                </button>
              )
            })}
            <button role="radio" aria-checked={wp.kind === 'custom'} className={`ap-wall custom ${wp.kind === 'custom' ? 'on' : ''} ${url ? '' : 'empty'}`} onClick={pickCustom} title={url ? '使用自选图片' : '选择一张图片作为壁纸'}>
              <span className="ap-thumb" style={url ? { backgroundImage: `url("${url}")` } : undefined}>{!url && <Icon.Plus size={20} />}</span>
              <span className="ap-name">{url ? '自选图片' : '选择图片…'}</span>
              {wp.kind === 'custom' && <Check />}
            </button>
          </div>
          {url && (
            <div className="ap-links">
              <button className="link-btn" onClick={() => ui().chooseWallpaper()}>更换图片…</button>
              <button className="link-btn danger" onClick={() => ui().removeCustomWallpaper()}>移除自选图片</button>
            </div>
          )}

          <div className={`ap-sliders ${wp.kind === 'none' ? 'disabled' : ''}`} aria-disabled={wp.kind === 'none'}>
            <div className="ap-slider">
              <span>模糊</span>
              <Slider label="壁纸模糊" value={wp.blur} max={60} step={2} disabled={wp.kind === 'none'} onChange={(v) => ui().setWallpaper({ blur: Math.round(v) })} valueText={(v) => `${Math.round(v)} 像素`} />
              <em>{Math.round(wp.blur)}</em>
            </div>
            <div className="ap-slider">
              <span>界面浓度</span>
              <Slider label="界面背景浓度" value={wp.opacity - 0.4} max={0.57} step={0.03} disabled={wp.kind === 'none'} onChange={(v) => ui().setWallpaper({ opacity: Math.round((v + 0.4) * 100) / 100 })} valueText={(v) => `${Math.round((v + 0.4) * 100)}%`} />
              <em>{Math.round(wp.opacity * 100)}%</em>
            </div>
            <p className="ap-hint">浓度越高，文字越清楚；越低，壁纸越明显。</p>
          </div>
        </section>

        <footer className="ap-foot">
          <button className="btn btn-accent" onClick={close}>完成</button>
        </footer>
      </div>
    </div>
  )
}
