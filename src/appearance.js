// 主题色与壁纸的定义（界面在 components/Appearance.jsx，状态在 store.js 的 useUI）
export const PALETTES = [
  { id: 'red', name: '经典红', swatch: ['#ff5b72', '#e3112f'] },
  { id: 'green', name: '墨绿', swatch: ['#34b386', '#0a5440'] },
  { id: 'blue', name: '海蓝', swatch: ['#4ea2ff', '#0748a0'] },
]

// 内置壁纸（CSS 渐变，见 themes.css 的 .wp-*）
export const PRESET_WALLPAPERS = [
  { id: 'aurora', name: '极光' },
  { id: 'dusk', name: '暮色' },
  { id: 'forest', name: '林间' },
  { id: 'mist', name: '晨雾' },
]

// kind: none 无壁纸｜preset 内置｜custom 自选图片
// blur：模糊半径（px）；opacity：内容区背景的浓度（越大越不透明，文字越清楚）
export const DEFAULT_WALLPAPER = { kind: 'none', preset: 'aurora', blur: 28, opacity: 0.78 }

export const isPalette = (id) => PALETTES.some((p) => p.id === id)

// 在 <html> 上标记主题色；放在首屏渲染前调用，避免先闪一下默认红色
export function applyPalette(id) {
  document.documentElement.dataset.palette = isPalette(id) ? id : 'red'
}

// 壁纸样式变量：侧栏比内容区再透一点，更有层次
export function wallpaperVars(wp) {
  const main = Math.round(Math.min(0.97, Math.max(0.4, wp.opacity)) * 100)
  return { '--wp-blur': `${Math.max(0, Math.min(80, wp.blur))}px`, '--wp-main': `${main}%`, '--wp-side': `${Math.max(30, main - 10)}%` }
}
