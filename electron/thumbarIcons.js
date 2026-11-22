// 任务栏缩略图工具栏的图标：复用界面图标库（src/icons.jsx）里播放 / 暂停 / 上一首 / 下一首的
// 几何数据（src/iconShapes.json），不再单独画一套。主进程把数据拼成 SVG，运行时交给渲染进程
// 按各档 DPI 栅格化成位图——Windows 的缩略图工具栏按钮最终只接受 HICON 位图。
const SHAPES = require('../src/iconShapes.json')

const NAMES = ['prev', 'play', 'pause', 'next']
// 与托盘图标一致：100% / 125% / 150% / 200% / 250% / 300% 缩放下的实际像素
const SIZES = [16, 20, 24, 32, 40, 48]
// 任务栏预览的背景跟随 Windows 系统主题：深色主题用白色图形，浅色主题用深色图形
const COLORS = { dark: '#ffffff', light: '#1f1f1f' }

// iconShapes.json 的节点（path / rect / g）转成 SVG 片段
function toSvg(node) {
  if (node.t === 'path') return `<path d="${node.d}"/>`
  if (node.t === 'rect') return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.rx}"/>`
  if (node.t === 'g') return `<g transform="${node.transform}">${node.children.map(toSvg).join('')}</g>`
  return ''
}

// 与界面图标一样使用 24×24 网格；尺寸缩得小时图形会显得细，16px 下略微放大保持清晰
function glyph(name, size, color) {
  const k = size <= 16 ? 1.05 : 1
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <g fill="${color}" transform="translate(12 12) scale(${k}) translate(-12 -12)">${SHAPES[name].map(toSvg).join('')}</g>
</svg>`
}

module.exports = { NAMES, SIZES, COLORS, glyph }
