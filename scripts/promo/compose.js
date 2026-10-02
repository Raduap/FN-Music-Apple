// 宣传片时间轴：renderAt(t) 把画面设置为第 t 秒的样子（纯函数式，逐帧渲染时调用）
// 素材由 render.mjs 注入 window.PROMO = { clips: { 名称: meta + base }, covers: [文件地址], version }
/* global PROMO */
const $ = (id) => document.getElementById(id)
const BAR = 60 / 90 * 4 // 配乐 90 BPM，一小节 2.667 秒；场景切换都落在小节线上
const T = {
  intro: [0, 2 * BAR],
  library: [2 * BAR, 5 * BAR],
  player: [5 * BAR, 9 * BAR],
  themes: [9 * BAR, 13 * BAR],
  ball: [13 * BAR, 16 * BAR],
  features: [16 * BAR, 18 * BAR],
  outro: [18 * BAR, 20 * BAR],
}
window.DURATION = 20 * BAR

// ---------- 缓动 ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const lerp = (a, b, k) => a + (b - a) * k
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3)
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const back = (x) => { x = clamp(x); const c = 1.5; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }
const prog = (t, a, d) => clamp((t - a) / d)
// 场景可见度：起止两端各有 fade 秒的交叉淡化
const vis = (t, [a, b], fade = 0.5) => Math.min(clamp((t - a + fade / 2) / fade), clamp((b + fade / 2 - t) / fade))

// 关键帧插值：[[时间, 值...], ...]
function keys(list, t) {
  if (t <= list[0][0]) return list[0].slice(1)
  for (let i = 1; i < list.length; i++) {
    if (t <= list[i][0]) {
      const k = easeInOut((t - list[i - 1][0]) / (list[i][0] - list[i - 1][0]))
      return list[i].slice(1).map((v, j) => lerp(list[i - 1][j + 1], v, k))
    }
  }
  return list[list.length - 1].slice(1)
}

// ---------- 素材：按片段时间取帧、取光标位置 ----------
function clipAt(name, ct) {
  const c = PROMO.clips[name]
  const ts = c.timeScale || 1
  const time = (x) => (x - c.t0) * ts
  let lo = 0, hi = c.frames.length - 1, ans = 0
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (time(c.frames[mid].t) <= ct) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
  const frame = c.base + c.frames[ans].file
  // 光标：线性插值
  const cur = c.cursor
  let i = cur.findIndex((p) => time(p.t) > ct)
  if (i === -1) i = cur.length
  const p0 = cur[Math.max(0, i - 1)], p1 = cur[Math.min(cur.length - 1, i)]
  const span = time(p1.t) - time(p0.t)
  const k = span > 0 ? clamp((ct - time(p0.t)) / span) : 0
  const cursor = { x: lerp(p0.x, p1.x, k), y: lerp(p0.y, p1.y, k) }
  const click = c.clicks.map((q) => ({ ...q, age: ct - time(q.t) })).filter((q) => q.age >= 0 && q.age < 0.55).pop()
  return { frame, cursor, click }
}

const decodes = []
function setSrc(img, src) {
  if (img.getAttribute('src') === src) return
  img.setAttribute('src', src)
  decodes.push(img.decode().catch(() => {}))
}
const style = (el, o, tf) => { el.style.opacity = o; if (tf !== undefined) el.style.transform = tf }

// ---------- 演示场景（应用窗口里的三个片段） ----------
const CSS2WIN = 1380 / 1280 // 应用窗口 CSS 像素 → 宣传片里窗口的像素
const SEGMENTS = [
  {
    clip: 'library', from: 0.2, to: 8.0, at: T.library,
    title: '你的音乐库，焕然一新', sub: '简洁优雅的界面，专辑、艺人、歌单一目了然',
    zoom: [[0, 1, 640, 400], [7.8, 1, 640, 400]], // 资料库保持全景：推近会切掉侧栏，显得残缺
  },
  {
    clip: 'album', from: 0.5, to: 3.4, at: [T.player[0], T.player[0] + 2.9],
    title: '沉浸式播放', sub: '封面取色背景 · 逐行同步歌词 · 无损音质一眼可辨',
    zoom: [[0, 1.12, 560, 420], [3, 1.12, 560, 420]],
  },
  {
    clip: 'player', from: 0.3, to: 0.3 + (T.player[1] - T.player[0] - 2.9), at: [T.player[0] + 2.9, T.player[1]],
    title: '沉浸式播放', sub: '封面取色背景 · 逐行同步歌词 · 无损音质一眼可辨',
    zoom: [[0, 1.12, 560, 420], [1.0, 1, 640, 400], [2.6, 1, 640, 400], [6.5, 1.2, 545, 400], [8.1, 1.2, 545, 400]], // 推近到歌词，同时保留完整的封面,
  },
  {
    clip: 'themes', from: 0.8, to: 14.2, at: T.themes,
    title: '主题色与壁纸，随心切换', sub: '经典红 · 墨绿 · 海蓝 · 深浅模式 · 自定义壁纸',
    zoom: [[0, 1, 640, 400], [3.2, 1, 640, 400], [4.6, 1.32, 640, 400], [11.0, 1.32, 640, 410], [12.4, 1, 640, 400], [14.2, 1, 640, 400]],
  },
]

function renderScene(t) {
  const seg = SEGMENTS.find((s) => t < s.at[1]) || SEGMENTS[SEGMENTS.length - 1]
  const local = t - seg.at[0]
  const speed = (seg.to - seg.from) / (seg.at[1] - seg.at[0])
  const ct = clamp(seg.from + local * speed, seg.from, seg.to)
  const { frame, cursor, click } = clipAt(seg.clip, ct)
  setSrc($('frame'), frame)

  // 镜头推拉：关键帧给出缩放倍数与对准的点（应用窗口 CSS 像素）
  const [s, fx, fy] = keys(seg.zoom, ct)
  const W = 1380, H = 865
  const tx = clamp(W / 2 - fx * CSS2WIN * s, W - W * s, 0)
  const ty = clamp(H / 2 - fy * CSS2WIN * s, H - H * s, 0)
  $('content').style.transform = `translate(${tx}px, ${ty}px) scale(${s})`

  // 光标与点击波纹（在内容层里，跟着推拉一起缩放）
  const cx = cursor.x * CSS2WIN, cy = cursor.y * CSS2WIN
  $('cursor').style.transform = `translate(${cx - 6}px, ${cy - 3}px) scale(${1 / s})`
  $('cursor').style.transformOrigin = '6px 3px'
  if (click) {
    $('ripple').style.left = click.x * CSS2WIN + 'px'
    $('ripple').style.top = click.y * CSS2WIN + 'px'
    style($('ripple'), 1 - click.age / 0.55, `scale(${(0.4 + easeOut(click.age / 0.55) * 0.9) / s})`)
  } else $('ripple').style.opacity = 0

  // 标题：同一标题的相邻片段不重复淡入
  const first = SEGMENTS.find((x) => x.title === seg.title)
  const titleStart = first.at[0]
  const nextTitleSeg = SEGMENTS[SEGMENTS.indexOf(seg) + 1]
  const titleEnd = nextTitleSeg && nextTitleSeg.title !== seg.title ? seg.at[1] : seg.at[1] + 99
  const ci = easeOut(prog(t, titleStart + 0.1, 0.6))
  const co = 1 - easeInOut(prog(t, titleEnd - 0.35, 0.3))
  $('capTitle').textContent = seg.title
  $('capSub').textContent = seg.sub
  style($('capTitle').parentElement, ci * co, `translateY(${(1 - ci) * 24}px)`)
  // 片段之间：画面短暂压暗，掩盖跳切
  const edge = Math.min(local, seg.at[1] - t)
  $('frame').style.filter = `brightness(${0.55 + 0.45 * clamp(edge / 0.22)})`
}

// ---------- 背景色 ----------
const PALETTE = {
  intro: ['#fa233b', '#7c3aed', '#0ea5e9'],
  library: ['#fa233b', '#f97316', '#7c3aed'],
  player: ['#16a34a', '#0f766e', '#22c55e'],
  themes: ['#2563eb', '#0f7a5a', '#7c3aed'],
  ball: ['#0ea5e9', '#6366f1', '#2dd4bf'],
  features: ['#7c3aed', '#2563eb', '#fa233b'],
  outro: ['#fa233b', '#7c3aed', '#f97316'],
}
function renderBg(t) {
  const name = Object.keys(T).find((k) => t < T[k][1]) || 'outro'
  const [c1, c2, c3] = PALETTE[name]
  const blobs = [$('b1'), $('b2'), $('b3')]
  const cs = [c1, c2, c3]
  blobs.forEach((b, i) => {
    b.style.background = cs[i]
    const a = t * 0.18 + i * 2.1
    b.style.transform = `translate(${[-200, 900, 300][i] + Math.cos(a) * 160}px, ${[-300, 200, 500][i] + Math.sin(a * 1.3) * 120}px)`
    b.style.transition = 'background 0s'
  })
}

// ---------- 片头 ----------
const NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5" fill="#fff"/><circle cx="17.5" cy="16" r="2.5" fill="#fff"/></svg>'
function setupIntro() {
  $('introIcon').innerHTML = NOTE
  $('outroIcon').innerHTML = NOTE
  const covers = PROMO.covers
  $('mosaic').innerHTML = Array.from({ length: 54 }, (_, i) => `<img src="${covers[(i * 7) % covers.length]}">`).join('')
}
function renderIntro(t) {
  const o = vis(t, T.intro)
  style($('intro'), o)
  if (!o) return
  $('mosaic').style.transform = `rotate(-12deg) translate(${-t * 26}px, ${-t * 8}px)`
  $('mosaic').style.opacity = 0.22 * easeOut(prog(t, 0, 1.2))
  const k = back(prog(t, 0.3, 0.9))
  style($('introIcon'), clamp(prog(t, 0.3, 0.3)), `scale(${0.4 + 0.6 * k})`)
  const b = easeOut(prog(t, 0.9, 0.8))
  style($('introBrand'), b, `translateY(${(1 - b) * 30}px)`)
  const g = easeOut(prog(t, 1.5, 0.8))
  style($('introTag'), g, `translateY(${(1 - g) * 20}px)`)
}

// ---------- 悬浮球 ----------
function renderBall(t) {
  const o = vis(t, T.ball)
  style($('desktop'), o)
  if (!o) return
  const local = t - T.ball[0]
  const span = T.ball[1] - T.ball[0]
  const ct = 0.4 + local * ((10.0 - 0.4) / span)
  const { frame, cursor, click } = clipAt('ball', ct)
  setSrc($('ballFrame'), frame)
  const S = 2.5 // 384×108 的悬浮球窗口放大 2.5 倍
  $('ballCursor').style.transform = `translate(${cursor.x * S - 6}px, ${cursor.y * S - 3}px)`
  if (click) {
    $('ballRipple').style.left = click.x * S + 'px'
    $('ballRipple').style.top = click.y * S + 'px'
    style($('ballRipple'), 1 - click.age / 0.55, `scale(${0.4 + easeOut(click.age / 0.55) * 0.9})`)
  } else $('ballRipple').style.opacity = 0
  const c = easeOut(prog(local, 0.2, 0.8))
  style($('desktop').querySelector('.caption'), c, `translateX(${(1 - c) * -40}px)`)
  $('ballWrap').style.transform = `translateY(${Math.sin(local * 1.2) * 4}px)`
}

// ---------- 细节功能 ----------
const ICONS = {
  disk: '<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"/><path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  resume: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  tray: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="17" cy="13" r="1.4" fill="#fff"/>',
  keys: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10"/>',
}
const FEATURES = [
  ['disk', '#0ea5e9', '封面本地缓存', '看过的封面存在本地，再次打开瞬间显示'],
  ['resume', '#f97316', '记住播放位置', '重启后从上次停下的地方继续'],
  ['tray', '#22c55e', '托盘常驻', '关掉窗口，音乐不停'],
  ['keys', '#a855f7', '系统媒体键', '键盘媒体键与 Windows 媒体浮窗'],
  ['lock', '#fa233b', 'NAS 账号登录', '密码只在 fnOS 官方页面输入'],
  ['wave', '#eab308', '无损 / Hi-Res 标识', 'FLAC、24-bit 音质一眼可辨'],
]
function setupFeatures() {
  $('cards').innerHTML = FEATURES.map(([ic, color, h, p]) => `<div class="card"><div class="ic" style="background:${color}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[ic]}</svg></div><h3>${h}</h3><p>${p}</p></div>`).join('')
}
function renderFeatures(t) {
  const o = vis(t, T.features)
  style($('features'), o)
  if (!o) return
  const local = t - T.features[0]
  const h = easeOut(prog(local, 0, 0.6))
  style($('featTitle'), h, `translateY(${(1 - h) * 30}px)`)
  ;[...$('cards').children].forEach((el, i) => {
    const k = back(prog(local, 0.3 + i * 0.11, 0.7))
    style(el, clamp(prog(local, 0.3 + i * 0.11, 0.35)), `translateY(${(1 - k) * 60}px) scale(${0.92 + 0.08 * k})`)
  })
}

// ---------- 片尾 ----------
function renderOutro(t) {
  const o = vis(t, T.outro) * (1 - easeInOut(prog(t, window.DURATION - 0.7, 0.7)))
  style($('outro'), o)
  if (!o) return
  const local = t - T.outro[0]
  const k = back(prog(local, 0.1, 0.9))
  style($('outroIcon'), clamp(prog(local, 0.1, 0.3)), `scale(${0.5 + 0.5 * k})`)
  const b = easeOut(prog(local, 0.5, 0.7))
  style($('outroBrand'), b, `translateY(${(1 - b) * 24}px)`)
  const m = easeOut(prog(local, 1.0, 0.7))
  style($('outroMeta'), m, `translateY(${(1 - m) * 20}px)`)
  const u = easeOut(prog(local, 1.4, 0.7))
  style($('outroUrl'), u, `translateY(${(1 - u) * 16}px)`)
}

let ready = false
window.renderAt = async function renderAt(t) {
  if (!ready) {
    setupIntro()
    setupFeatures()
    $('ver').textContent = PROMO.version
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})))
    ready = true
  }
  decodes.length = 0
  renderBg(t)
  renderIntro(t)
  const so = Math.max(vis(t, [T.library[0], T.themes[1]]))
  style($('scene'), so)
  if (so) renderScene(t)
  renderBall(t)
  renderFeatures(t)
  renderOutro(t)
  // 背景光斑在片头片尾之外压暗一些
  $('bg').style.opacity = 1
  await Promise.all(decodes)
}
