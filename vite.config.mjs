import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 仅在生产构建里注入内容安全策略（开发模式下 Vite 热更新需要内联脚本与 WebSocket）
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: fnm:",
  "media-src 'self' blob: fnm:",
  "connect-src fnm:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const injectCsp = () => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

export default defineConfig({
  plugins: [react(), injectCsp()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 主窗口与悬浮球是两个页面
    rollupOptions: { input: { main: 'index.html', ball: 'ball.html' } },
  },
  // 单元测试；e2e/ 下的端到端测试需要 Electron，单独用 npm run test:e2e 运行
  test: { include: ['test/**/*.test.js'] },
})
