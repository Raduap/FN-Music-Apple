# 飞牛音乐 · Apple Music 风格 Windows 客户端

[![CI](https://github.com/Raduap/FN-Music-Apple/actions/workflows/ci.yml/badge.svg)](https://github.com/Raduap/FN-Music-Apple/actions/workflows/ci.yml)

为 fnOS「飞牛音乐」打造的 Windows 桌面播放器，界面仿照 Apple Music。Electron + React 实现，直接对接飞牛音乐原生 API（`/music/api/v1`）。

> [!NOTE]
> 本项目是由独立开发者开发的**第三方** Windows 客户端，并非飞牛 fnOS 官方产品，与飞牛及 Apple Inc. 均无隶属、授权或合作关系。下方截图与宣传片中的曲目、专辑、艺人与封面均为演示用的虚构内容。

## 宣传片

[![观看宣传片](docs/media/promo-poster.jpg)](docs/media/promo.mp4)

点击图片观看（1080p · 60 秒）；如果浏览器无法在线播放，可[下载 MP4](https://github.com/Raduap/FN-Music-Apple/raw/main/docs/media/promo.mp4)。

## 界面预览

| 主页 | 专辑详情 |
| :---: | :---: |
| ![主页：最近添加与为你推荐](docs/screenshots/home.jpg) | ![专辑详情与播放栏（Hi-Res 标识）](docs/screenshots/album.jpg) |
| **全屏播放页**：封面取色背景，逐行同步歌词 | **墨绿 · 深色**：主题色与「林间」壁纸 |
| ![全屏播放页与歌词](docs/screenshots/player.jpg) | ![墨绿深色主题与壁纸](docs/screenshots/theme-green.jpg) |
| **外观设置**：主题色、深浅模式、壁纸、模糊与界面浓度 | **桌面悬浮球**：歌名、当前歌词、播放控制 |
| ![外观设置面板（海蓝 · 极光）](docs/screenshots/appearance.jpg) | ![悬浮球展开状态](docs/screenshots/ball.png) |

## 功能

- **布局**：整列通高的侧边栏，右侧为导航条、内容区和底部播放栏。窗口宽度 < 980 时侧栏自动收成图标栏（也可用 Ctrl+B 手动收起），< 1240 时歌词 / 队列面板改为浮层，不会挤压内容
- **资料库**：主页（最近添加 / 为你推荐 / 播放列表 / 艺人）、专辑、艺人、歌曲（虚拟滚动，列头可排序）、流派、播放列表、喜欢的歌曲
- **详情页**：专辑、艺人（模糊大图头部）、播放列表（四宫格封面）
- **搜索**：侧边栏输入即搜，按艺人 / 专辑 / 歌曲分组显示结果
- **歌曲列表**：单击 / Ctrl 多选 / Shift 连选，↑↓ 键盘导航，右键菜单对多首歌曲操作，可把歌曲拖到侧边栏的播放列表或“喜欢的歌曲”；列随内容区宽度自动收起
- **播放栏**：随机、循环、上一首 / 下一首、可键盘操作的进度和音量滑块（悬停显示时间）、音质标识（无损 / Hi-Res）、队列管理，重启后恢复上次的队列和播放位置
- **歌词**：LRC 逐行同步滚动，点击某一行跳转
- **全屏播放页**：封面取色动态模糊背景、大字歌词或播放队列、音质信息；自适应小窗口
- **导航**：前进 / 后退按钮（支持鼠标侧键、Alt+←/→），返回时恢复滚动位置，滚动后导航条显示页面标题
- **系统集成**：Windows 媒体控制（SMTC）、键盘媒体键、窗口标题显示当前歌曲
- **外观**：浅色 / 深色 / 跟随系统；主题色可选经典红、墨绿、海蓝（背景、侧栏、面板都随之着色，深色模式下是同色系的深底）；壁纸可用内置的渐变或自选图片，并调节模糊与界面浓度。账户菜单 →「外观、主题色与壁纸…」，修改即时生效
- **悬浮球**：桌面上的迷你播放器。收起时是一颗旋转的唱片封面，外圈是播放进度，颜色取自封面；鼠标移上去展开成胶囊，显示歌名、当前歌词行和播放 / 切歌 / 喜欢按钮。单击圆球打开主窗口，滚轮调音量，可在屏幕上任意拖动（松手停在原处，只保证不出屏幕）并记住位置，右键有菜单。透明区域鼠标穿透，不抢焦点。可在账户菜单或托盘菜单设为「始终显示 / 主窗口隐藏时显示（默认）/ 关闭」
- **系统托盘**：关闭窗口后停留在托盘，音乐继续播放；托盘提示显示当前歌曲，右键菜单可播放 / 暂停、切歌、显示窗口或退出；再次启动应用会调出已有窗口。可在账户菜单 →「关闭窗口时」或托盘菜单中改为直接退出
- **登录**：支持 **NAS 账号登录**（打开 fnOS 官方登录页授权，密码只在飞牛页面输入）和飞牛音乐**独立账号**登录
- **安全**：凭证经 Windows DPAPI（`safeStorage`）加密保存；token 失效时自动静默续期；生产构建带内容安全策略（CSP）；兼容 NAS 自签名证书（只对填写的 NAS 地址放行，其他网站照常校验）
- **封面加载**：封面缓存在本地磁盘（默认上限 400 MB，按最近使用淘汰），重启后无需再向 NAS 请求；屏幕内的封面优先加载，同时访问 NAS 的封面请求不超过 3 个，给接口和音频流留出连接；已有小图时先显示小图再换清晰版。账户菜单可「清除封面缓存」
- **稳定性**：页面出错时只影响内容区；渲染进程崩溃后自动重新载入
- **动效**（模仿 Apple 的运动语言）：页面转场（前进 / 后退方向不同）、卡片与列表依次浮现、悬停上浮与按压回弹、红心弹出光环、播放 / 暂停图标切换、分段控件滑动高亮、菜单与对话框弹簧展开（带退出动画）、切歌时封面与文字换入、播放栏封面与全屏大封面之间的共享元素过渡（View Transitions）
- **动画开关**：账户菜单 →「动画效果」可选 开启（默认）/ 跟随系统 / 关闭。默认不跟随系统，因为 Windows 关闭“显示动画效果”时系统会要求减少动效，应用里就会完全没有动画
- **无障碍**：键盘焦点样式、按钮与滑块的 ARIA 标注、对话框焦点限制

## 快捷键

| 按键 | 作用 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| Ctrl + ← / → | 上一首 / 下一首 |
| Ctrl + ↑ / ↓ | 音量 |
| Ctrl + F | 搜索 |
| Ctrl + L | 歌词面板 |
| Ctrl + B | 收起 / 展开侧边栏 |
| Alt + ← / → | 后退 / 前进 |
| ↑ ↓ Home End Enter | 歌曲列表中移动 / 播放 |
| Ctrl + A | 歌曲列表全选 |
| Esc | 关闭菜单 / 面板 / 全屏播放页 |

## 下载

在 [Releases](https://github.com/Raduap/FN-Music-Apple/releases) 页面下载 `FN-Music-Setup-*.exe`（安装版）或 `FN-Music-Portable-*.exe`（便携版）。

## 开发

需要 Node.js 22 或更高版本。

```bash
npm install          # 国内网络建议设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ 和 npm 镜像源
npm run dev          # Vite 热更新 + Electron
npm start            # 构建后以生产模式运行
npm run dist         # 打包 release/ 下的安装版与便携版 exe
```

### 检查与测试

```bash
npm run lint         # ESLint
npm test             # 单元测试（Vitest）：签名、地址处理、LRC 解析、数据映射
npm run test:e2e     # 端到端测试：启动模拟服务器和 Electron，走一遍登录、播放、喜欢、搜索、重启恢复
npm run check        # lint + 单元测试 + 构建
```

Linux 上没有显示器时，端到端测试用 `xvfb-run -a npm run test:e2e` 运行。

### 宣传片

`npm run promo` 会用展示数据（虚构的艺人、专辑与抽象画封面）启动模拟服务器和真实的应用，按分镜录下操作画面，再合成为 1080p 宣传片 `promo-build/fn-music-promo.mp4`：

- `scripts/promo/capture.mjs`：录制素材（逐帧图片 + 光标轨迹）
- `scripts/promo/compose.html` / `compose.js`：时间轴与画面（苹果发布会风格：黑底大字、笔记本机身、推入屏幕的镜头、片尾第三方声明），`renderAt(t)` 按时间逐帧绘制
- `scripts/promo/music.mjs`：代码合成的配乐（96 BPM，场景切换落在小节线上）
- `scripts/promo/render.mjs`：逐帧渲染并用 ffmpeg 编码；加 `--sheet` 只生成每秒一帧的预览图，`--frames=5,12` 导出指定时刻的单帧；首次运行会从 npm 下载 Inter 与思源黑体可变字重字体（缓存在 `promo-build/fonts`）

需要 ffmpeg 与 Chromium（`PLAYWRIGHT_CHROMIUM` 可指定路径）。Linux 无显示器时用 `xvfb-run -a -s "-screen 0 2400x1600x24" npm run promo`；中文字体建议安装 Noto Sans CJK。

### 界面截图

`npm run screenshots` 用同一套展示数据启动应用，把 README 里的界面截图拍到 `docs/screenshots/`（1920×1200）。Linux 无显示器时同样用 `xvfb-run` 运行。

### 持续集成与发布

- 每次推送到 `main` 或提交 Pull Request，GitHub Actions 会运行 lint、单元测试、端到端测试，并打包 Windows 版作为构建产物
- **自动发布**：把 `package.json` 的 `version` 改成新版本号，并在 `CHANGELOG.md` 里加上同名段落（如 `## 1.2.0`），合并到 `main` 后会自动：
  1. 检查该版本是否已发布（已有 `v1.2.0` 标签则跳过）
  2. 运行 lint、单元测试、端到端测试
  3. 在 Windows 上打包安装版与便携版
  4. 创建 `v1.2.0` 标签和 GitHub Release，发布说明取自 `CHANGELOG.md` 中该版本的段落
- 版本号带 `-`（如 `1.2.0-beta.1`）时发布为预发布版本
- 也可以手动推送标签（`git tag v1.2.0 && git push origin v1.2.0`），或在 Actions 页面手动运行 Release 工作流

### 没有 NAS 时用模拟服务器调试

```bash
npm run mock
```

登录时服务器地址填 `127.0.0.1:5666`。可以选「使用 NAS 账号登录」，在模拟的 fnOS 登录页中随便填写即可；也可以选独立账号，用户名和密码都是 `demo`。模拟服务器带有示例专辑、封面、可播放的音频和同步歌词。

## 结构

```
electron/main.js     主进程：fnm:// 协议代理（附带 music-token Cookie）、登录与凭证存储、窗口
electron/util.js     主进程的纯函数：authx 签名、地址处理（可单元测试）
electron/tray.js     系统托盘
electron/ball.js     悬浮球窗口（ballGeometry.js 为吸附与定位计算，ballPreload.js 为其接口）
src/ball/            悬浮球页面（ball.html 入口）
scripts/gen-tray-icons.mjs  生成各 DPI 尺寸的托盘图标（build/tray/）
electron/coverCache.js 封面磁盘缓存
src/covers.js        封面加载队列与内存缓存
electron/preload.js  向渲染进程暴露的有限 IPC
src/api.js           飞牛音乐 API 封装与数据映射
src/store.js         播放器 / 界面 / 登录状态（zustand）
src/components/      播放栏、侧边栏、歌曲列表、卡片、菜单、全屏播放页
src/pages/           各页面
dev/mock-server.js   API 模拟服务器
test/                单元测试
scripts/promo/       宣传片制作脚本
scripts/screenshots.mjs README 界面截图
docs/                README 用的截图与宣传片
e2e/                 端到端测试
```

渲染进程的所有请求（接口、封面、音频流）都发往 `fnm://srv/...`，由主进程转发到 `<服务器>/music/...` 并附带 `music-token` Cookie，渲染进程接触不到凭证。

## 说明

飞牛音乐的 API 没有公开文档。本项目使用的接口参照了开源项目 [Liusound](https://github.com/silence-top/Liusound) 中的 fnOS 适配器。如果飞牛更新后接口有变化，请调整 `src/api.js`。

## 许可

[MIT](LICENSE)
