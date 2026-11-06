// 悬浮歌词：独立的透明置顶小窗，显示当前句（可带译文 / 下一句）
//
// 交互
// - 控制条（播放控制 / Aa / 菜单 / 锁定 / 关闭）根据胶囊位置固定在胶囊上方或下方：光标进入胶囊才显示，离开 3 秒后自动隐藏
// - 控制条容器与按钮间隙不拦截鼠标；只有按钮本身的矩形可点击，其余区域会穿透到下方窗口
// - 锁定（鼠标穿透）后整窗让鼠标穿透，光标移到胶囊上只显示解锁按钮，点击解锁即可恢复操作
// - 拖动胶囊空白处移动窗口；直接拉胶囊的四边 / 四角可缩放，字号随窗口高度等比变化
// - 当前句原文锚定在胶囊顶部：译文、下一句只是它下面的独立行，开关不会带动原文
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import SPEC from '../../electron/lyricsVisualSpec.json'
import { lyricPlaceholder } from '../lyrics'
import { karaokeClock, karaokeProgress, karaokeWords } from '../karaoke'

const bridge = window.lyricsWin
const { defaultStyle: DEFAULT_STYLE, fontStacks: FONT_STACKS } = SPEC
const EMPTY_STATE = { title: '', lyric: '', lyricTrans: '', nextLyric: '', nextLyricTrans: '', nextNextLyric: '', nextNextLyricTrans: '', lyricsReady: false, hasLyrics: false, hasTranslation: false, hasNext: false, playing: false, currentTime: 0, at: 0, duration: 0, palette: 'red' }
// 控制条显隐完全由主进程按光标位置驱动（离开胶囊 / 按钮 3s 后隐藏），页面只镜像 active 状态。

// ---------- 演示模式：在普通浏览器里打开 lyrics.html?demo 预览界面（无 Electron） ----------
const demo = bridge ? null : new URLSearchParams(location.search)
const DEMO_STATE = demo && {
  ...EMPTY_STATE,
  title: '晴天',
  lyric: demo.get('lyric') ?? "I'm keeping my balance, but I'm standing",
  lyricTrans: demo.get('trans') ?? '我尽力保持自己的平衡',
  nextLyric: demo.get('next') ?? "On razor's edge now",
  lyricsReady: true,
  hasLyrics: demo.get('inst') !== '1',
  playing: demo.get('playing') !== '0',
  duration: 240,
  currentTime: 96,
  at: Date.now(),
}
const DEMO_STYLE = demo && {
  ...DEFAULT_STYLE,
  showTranslation: demo.get('showTrans') !== '0', showNext: demo.get('showNext') === '1',
  clickThrough: demo.get('lock') === '1', vertical: demo.get('vertical') === '1', width: Number(demo.get('width')) || DEFAULT_STYLE.width,
}

const ACCENT = { red: [250, 45, 72], green: [60, 196, 144], blue: [74, 157, 255] }
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

// 单色矢量图标：跟随 currentColor，避免 emoji 在不同系统上的彩色 / 样式差异
const IconLock = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
  </svg>
)
const IconUnlock = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
    <path d="M8 10.5V7.8a4 4 0 0 1 7.5-1.9" />
  </svg>
)
const IconPrev = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 6v12" />
    <path d="M18 6.8 10.4 12 18 17.2Z" />
  </svg>
)
const IconNext = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6v12" />
    <path d="M6 6.8 13.6 12 6 17.2Z" />
  </svg>
)
const IconPlay = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 5.5 18.5 12 8 18.5Z" />
  </svg>
)
const IconPause = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5v14M15 5v14" />
  </svg>
)
const IconClose = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 7l10 10M17 7 7 17" />
  </svg>
)
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const LATIN_RE = /[A-Za-z]/
// 竖排时：中日韩等文字保持正立；纯拉丁文字旋转 90°，让英文仍然从左到右阅读。
const verticalClass = (text) => {
  const value = String(text || '')
  if (CJK_RE.test(value)) return ''
  return LATIN_RE.test(value) ? ' latin' : ''
}

function useLayer() {
  const [state, setState] = useState(DEMO_STATE || EMPTY_STATE)
  const [style, setStyle] = useState(DEMO_STYLE || null)
  const [active, setActive] = useState(!!demo)
  const [flip, setFlip] = useState(demo ? (demo.get('controls') === 'below' ? 'below' : 'above') : 'above')
  const [side, setSide] = useState(demo?.get('side') === 'left' ? 'left' : 'right')
  const [edge, setEdge] = useState(demo?.get('edge') || 'bottom')
  const [layout, setLayout] = useState({ cap: null, css: null })
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [backgroundVersion, setBackgroundVersion] = useState(0)
  const s = style || DEFAULT_STYLE

  useEffect(() => {
    if (!bridge) return
    const offState = bridge.onState((s) => setState({ ...EMPTY_STATE, ...s }))
    const offStyle = bridge.onStyle((s) => setStyle(s))
    const offLayout = bridge.onLayout((l) => {
      if (l?.flip) setFlip(l.flip)
      if (l?.side) setSide(l.side)
      if (l?.edge) setEdge(l.edge)
      if (l?.cap) setLayout({ cap: l.cap, winCap: l.winCap || l.cap, inset: l.inset || null, css: l.css || null, anim: l.anim || null })
    })
    const offActive = bridge.onActive((v) => setActive(!!v))
    // 背景图被更换 / 移除时，即使样式里的 customImage 没变也要重拉图片
    const offBg = bridge.onBackground?.(() => setBackgroundVersion((v) => v + 1))
    bridge.ready()
    return () => { offState(); offStyle(); offLayout(); offActive(); offBg?.() }
  }, [])

  useEffect(() => {
    if (!bridge || s.backgroundMode !== 'custom' || !s.customImage) {
      setBackgroundUrl((old) => { if (old) URL.revokeObjectURL(old); return '' })
      return
    }
    let dead = false
    let url = ''
    bridge.getBackground().then((r) => {
      if (dead || !r?.data) return
      url = URL.createObjectURL(new Blob([r.data], { type: r.type }))
      setBackgroundUrl((old) => { if (old) URL.revokeObjectURL(old); return url })
    }).catch(() => {})
    return () => {
      dead = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [s.backgroundMode, s.customImage, backgroundVersion])

  return { state, style, active, flip, side, edge, layout, backgroundUrl }
}

export default function FloatingLyrics() {
  const { state, style, active, flip, side, edge, layout, backgroundUrl } = useLayer()
  const shown = !!active // 控制条是否显示（显隐延迟由主进程统一管理）
  const lineRef = useRef(null)
  const capRef = useRef(null)

  const s = style || DEFAULT_STYLE
  const vertical = !!s.vertical
  // 没有当前句时（前奏 / 伴奏 / 间隔 / 无歌词）：
  // 有下一句就按“待播放”形式灰显；没有可显示歌词时只做兜底，不再显示“前奏”。
  const upcoming = !state.lyric && !!state.nextLyric
  const placeholder = lyricPlaceholder(state)
  const main = state.lyric || state.nextLyric || placeholder
  // 伴奏 / 前奏（当前句还没内容）：把下一句作为主行灰显预告。
  // 行预留规则：主进程只下发“当前是否显示译文 / 下一句”，渲染端不重复歌曲级判断。
  const showTrans = !!s.showTranslation && !!state.hasTranslation
  const showNext = !!s.showNext && !!state.hasNext
  const transText = upcoming ? state.nextLyricTrans : state.lyricTrans
  const nextText = upcoming ? state.nextNextLyric : state.nextLyric
  // 逐字高亮只做当前句：upcoming（前奏预告）时显示的是下一句，跟着用下一句的词级数据。
  // words 文本与整句文本逐字符一致（合并层已保证），宽度不由 React 管，rAF 直接写 DOM。
  // 只在主窗口送来真实词级时间轴时才扫色；没有数据（或逐字开关关闭）保持普通整句文本。
  const karaoke = !upcoming && state.lyricWords?.length ? karaokeWords({ text: state.lyric, words: state.lyricWords }) : null

  // 行 / 列开关时，主进程已经按“靠近边框的边不动”把窗口移到位；
  // 这里让胶囊从旧尺寸和反向位移滑到最终尺寸，避免边框和已有歌词闪现。
  useLayoutEffect(() => {
    const el = capRef.current
    if (!el) return
    for (const a of el.getAnimations?.() || []) a.cancel()
    if (!layout.anim || !layout.cap) return
    const { from, shift } = layout.anim
    if (!from || !shift) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const anim = el.animate([
      { width: `${from.width}px`, height: `${from.height}px`, transform: `translate(${shift.x}px, ${shift.y}px)` },
      { width: `${layout.cap.width}px`, height: `${layout.cap.height}px`, transform: 'translate(0, 0)' },
    ], { duration: reduce ? 1 : 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    return () => anim.cancel()
  }, [layout.anim, layout.cap])

  // 进度线：播放中按时间推算，不依赖每秒广播
  useEffect(() => {
    const el = lineRef.current
    if (!el) return
    const draw = () => {
      const t = state.currentTime + (state.playing ? (Date.now() - state.at) / 1000 : 0)
      const p = state.duration > 0 ? Math.min(1, Math.max(0, t / state.duration)) : 0
      // 沿贴边方向生长：左右边用纵向，上下边用横向
      el.style.transform = (edge === 'left' || edge === 'right') ? `scaleY(${p})` : `scaleX(${p})`
    }
    draw()
    if (!state.playing) return
    const id = setInterval(draw, 250)
    return () => clearInterval(id)
  }, [state.currentTime, state.at, state.playing, state.duration, edge, s.showProgress])

  // 逐字扫色：悬浮窗没有 audio 元素，用「上次广播的 currentTime + 本地流逝」推算时钟，
  // 每帧用 karaokeFills 的连续进度边直接写 .kw-fill 宽度；暂停 / 切句时贴齐或清零。
  // 这与全屏页 LyricsView 的扫色语义一致，只是时钟来源不同。
  const mainRef = useRef(null)
  const karaokeOn = !!karaoke && !!s.karaoke
  useEffect(() => {
    if (!karaokeOn) return
    const el = mainRef.current
    if (!el) return
    let raf = 0
    const step = () => {
      const t = karaokeClock(state) + 0.25
      const fills = karaokeProgress(karaoke, t)
      el.querySelectorAll('.kw-fill').forEach((node, wi) => {
        const f = fills?.[wi] ?? 0
        node.style.width = `${(f * 100).toFixed(2)}%`
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      el.querySelectorAll('.kw-fill').forEach((node) => { node.style.width = '0%' })
    }
  }, [karaokeOn, karaoke, state]) // state.currentTime / at / playing 变化时贴齐真实时间；karaokeClock 只读这三个字段

  const startResize = (dir) => (e) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    bridge?.resizeStart(dir, e.screenX, e.screenY)
  }
  const moveResize = (e) => bridge?.resizeMove(e.screenX, e.screenY)
  const endResize = () => bridge?.resizeEnd()

  // 胶囊精确尺寸由主进程唯一计算；demo 模式没有 IPC 时交给 CSS 自适应。
  const css = layout.css || { rowGap: SPEC.geometry.rowGap, subH: Math.round(s.fontSize * SPEC.geometry.lineRatio * SPEC.geometry.subRatio), colExtra: Math.max(2, s.fontSize * SPEC.geometry.columnExtraRatio) }
  // --cap-* 是当前实际胶囊尺寸；--win-cap-* 是窗口为该歌预留的尺寸。
  // 网格轨道用预留尺寸（窗口内固定），玻璃胶囊用实际尺寸，开关翻译 / 下一句时窗口不动。
  const cap = layout.cap || null
  const winCap = layout.winCap || cap
  const capVars = cap ? {
    '--cap-w': `${cap.width}px`, '--cap-h': `${cap.height}px`,
    '--win-cap-w': `${winCap.width}px`, '--win-cap-h': `${winCap.height}px`,
  } : {}
  // 胶囊在窗口内的偏移。贴近屏幕上边 / 左边时主进程会把它收小到 0（见 lyricsGeometry.capsuleInset），
  // 让窗口能停在屏幕边上、胶囊仍然贴住屏幕边（原生拖动不允许窗口越过屏幕边）。
  const ins = layout.inset
  const insetVars = {
    // 横排：top = 控制条高（贴顶时收小），left = 安全边；竖排：left = 控制条宽，top = 安全边。
    '--cap-top': `${ins ? ins.y : (vertical ? SPEC.geometry.edgeBleed : SPEC.geometry.controlH)}px`,
    '--cap-left': `${ins ? ins.x : (vertical ? SPEC.geometry.controlH : SPEC.geometry.edgeBleed)}px`,
  }

  const accent = ACCENT[state.palette] || ACCENT.red
  const vars = {
    '--accent': `rgb(${accent.join(',')})`,
    '--pad': `${SPEC.geometry.pad}px`,
    // 长度轴安全边：胶囊边框不落在窗口最外缘，避免非整数 DPI 下被裁。
    '--bleed': `${SPEC.geometry.edgeBleed}px`,
    '--ctl': `${SPEC.geometry.controlH}px`,
    '--edge': `${SPEC.geometry.resizeEdge}px`,
    '--btn-w': `${SPEC.geometry.controlBtnW}px`,
    '--btn-gap': `${SPEC.geometry.controlBtnGap}px`,
    '--radius': `${SPEC.geometry.radius}px`,
    '--vpad': `${SPEC.geometry.vPad}px`,
    '--hpad': `${SPEC.geometry.hPad}px`,
    '--line-ratio': SPEC.geometry.lineRatio,
    '--sub-ratio': SPEC.geometry.subRatio,
    '--progress-inset': `${SPEC.geometry.progressInset}px`,
    '--handle': `${SPEC.geometry.resizeHandle}px`,
    '--fs': s.fontSize + 'px',
    '--fst': FONT_STACKS[s.fontFamily] || FONT_STACKS.system,
    '--fw': s.weight,
    '--align': s.align,
    '--col-extra': `${css.colExtra}px`,
    '--row-gap': `${css.rowGap}px`,
    '--sub-h': `${css.subH}px`,
    // 逐字已唱部分的颜色：默认跟 --fg 同色系（亮），白/浅色文字在暗底上表现为白扫色；
    // 浅色背景模式下文字是深色，跟随 --fg 也保持一致。
    '--karaoke-color': 'var(--fg)',
    ...capVars,
    ...insetVars,
  }
  const dark = s.backgroundMode !== 'light'
  if (s.backgroundMode === 'light') Object.assign(vars, { '--fg': '#1a1a1c', '--fg2': 'rgba(26,26,28,0.6)', '--fg3': 'rgba(26,26,28,0.4)', '--glass': `rgba(255,255,255,${s.opacity})`, '--glass-bd': 'rgba(0,0,0,0.08)' })
  else if (s.backgroundMode === 'cover') Object.assign(vars, { '--fg': '#fff', '--fg2': 'rgba(255,255,255,0.8)', '--fg3': 'rgba(255,255,255,0.55)', '--glass': `rgba(${accent.join(',')},${Math.max(0.3, s.opacity * 0.72)})`, '--glass-bd': 'rgba(255,255,255,0.2)' })
  else if (s.backgroundMode === 'custom') Object.assign(vars, { '--fg': '#fff', '--fg2': 'rgba(255,255,255,0.8)', '--fg3': 'rgba(255,255,255,0.55)', '--glass': `rgba(18,18,22,${s.opacity})`, '--glass-bd': 'rgba(255,255,255,0.18)' })
  else Object.assign(vars, { '--fg': '#fff', '--fg2': 'rgba(255,255,255,0.72)', '--fg3': 'rgba(255,255,255,0.46)', '--glass': `rgba(18,18,22,${s.opacity})`, '--glass-bd': 'rgba(255,255,255,0.14)' })
  if (s.textColorCustom) Object.assign(vars, { '--fg': s.textColor, '--fg2': s.textColor, '--fg3': s.textColor })
  Object.assign(vars, {
    '--frost': `${s.frost}px`,
    '--frost-strong': `${Math.min(0.32, 0.06 + s.frost / 160)}`,
    '--frost-soft': `${Math.min(0.16, 0.02 + s.frost / 320)}`,
    '--frost-line': `${Math.min(0.072, 0.009 + s.frost / 640)}`,
    '--custom-bg': backgroundUrl ? `url("${backgroundUrl}")` : 'none',
    '--custom-alpha': s.opacity,
  })

  return (
    <div className={`lw flip-${flip} side-${side} edge-${edge} ${vertical ? 'vertical' : ''} ${shown ? 'show' : ''} ${s.clickThrough ? 'locked' : ''} ${s.showBorder ? '' : 'no-border'} ${s.backgroundMode === 'custom' && backgroundUrl ? 'custom-bg' : ''}`} style={vars} data-dark={dark ? '1' : '0'}>
      <div className="lcore">
        <div className="lctl">
          {s.clickThrough ? (
            <button
              className="lbtn lock on"
              title="解除锁定（当前鼠标穿透）"
              aria-label="解除锁定"
              aria-pressed="true"
              onClick={() => bridge?.toggleLock()}
            >
              <IconUnlock />
            </button>
          ) : (
            <>
              <button className="lbtn" title="上一首" aria-label="上一首" onClick={() => bridge?.prev()}><IconPrev /></button>
              <button className="lbtn" title={state.playing ? '暂停' : '继续'} aria-label={state.playing ? '暂停' : '继续'} onClick={() => bridge?.toggle()}>{state.playing ? <IconPause /> : <IconPlay />}</button>
              <button className="lbtn" title="下一首" aria-label="下一首" onClick={() => bridge?.next()}><IconNext /></button>
              <button className="lbtn" title="悬浮歌词样式" onClick={() => bridge?.openSettings()} aria-label="悬浮歌词样式">Aa</button>
              <button className="lbtn" title="菜单" onClick={() => bridge?.menu()} aria-label="菜单">⋯</button>
              <button className="lbtn lock" title="锁定（鼠标穿透）" aria-label="锁定" aria-pressed="false" onClick={() => bridge?.toggleLock()}><IconLock /></button>
              <button className="lbtn" title="关闭悬浮歌词" aria-label="关闭悬浮歌词" onClick={() => bridge?.close()}><IconClose /></button>
            </>
          )}
        </div>
        <div
          ref={capRef}
          className="lc"
          style={{ backdropFilter: `blur(${s.frost}px) saturate(150%)`, WebkitBackdropFilter: `blur(${s.frost}px) saturate(150%)` }}
          onContextMenu={(e) => { e.preventDefault(); bridge?.menu() }}
        >
          <div className="ldrag" aria-hidden="true" />
          <div className="lrows">
            <div
              ref={mainRef}
              className={`lmain${karaokeOn ? ' karaoke' : ''}${verticalClass(main)}${upcoming ? ' upcoming' : ''}`}
              title={state.lyric || state.nextLyric || state.title || ''}
            >
              {karaokeOn
                ? karaoke.words.map((w, wi) => (
                  <span key={wi} className="kw">
                    <span className="kw-fill">{w.text}</span>
                    {w.text}
                  </span>
                ))
                : main}
            </div>
            <div className={`lsub-wrap ${showTrans ? 'on' : ''}`} aria-hidden={!showTrans}>
              <div className={`lsub${verticalClass(transText)}`}>{transText}</div>
            </div>
            <div className={`lnext-wrap ${showNext ? 'on' : ''}`} aria-hidden={!showNext}>
              <div className={`lnext${verticalClass(nextText)}${nextText ? '' : ' empty'}`}>{nextText}</div>
            </div>
          </div>
          {s.showProgress && <div className="lbar"><i ref={lineRef} /></div>}
          {!s.clickThrough && DIRS.map((d) => (
            <div
              key={d}
              className={`lresize lresize-${d}`}
              onPointerDown={startResize(d)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    </div>
  )
}


