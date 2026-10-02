# 飞牛音乐 · Apple Music 风格 Windows 客户端

为 fnOS「飞牛音乐」打造的 Windows 桌面播放器，界面仿照 Apple Music。Electron + React 实现，直接对接飞牛音乐原生 API（`/music/api/v1`）。

## 功能

- **资料库**：主页（最近添加 / 为你推荐 / 播放列表 / 艺人）、专辑、艺人、歌曲（虚拟滚动，支持排序）、流派、喜欢的歌曲
- **详情页**：专辑、艺人（模糊大图头部）、播放列表（四宫格封面）
- **搜索**：侧边栏输入即搜，按艺人 / 专辑 / 歌曲分组显示结果（Ctrl+F 聚焦）
- **播放**：顶栏控制条（含进度）、随机、循环（全部 / 单曲）、音量、播放下一首 / 稍后播放、队列管理，重启后恢复上次的队列
- **歌词**：LRC 逐行同步滚动，点击某一行跳转到对应位置
- **全屏播放页**：取封面主色做动态模糊背景，显示大字歌词或播放队列，并标注音质（如「高解析度无损 · 24-bit/96 kHz」）
- **播放列表与收藏**：新建、重命名、删除播放列表，添加 / 移除歌曲，喜欢 / 取消喜欢
- **系统集成**：Windows 媒体控制（SMTC）、键盘媒体键、浅色 / 深色 / 跟随系统，Windows 11 原生标题栏按钮
- **安全**：登录凭证经 Windows DPAPI（`safeStorage`）加密保存；token 失效时自动静默重登；兼容 NAS 自签名证书

## 快捷键

| 按键 | 作用 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| Ctrl + ← / → | 上一首 / 下一首 |
| Ctrl + ↑ / ↓ | 音量 |
| Ctrl + F | 搜索 |
| Ctrl + L | 歌词面板 |
| Esc | 收起全屏播放页 |

## 开发

```bash
npm install          # 国内网络建议设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev          # Vite 热更新 + Electron
npm start            # 构建后以生产模式运行
npm run dist         # 打包 release/ 下的安装版与便携版 exe
```

### 没有 NAS 时用模拟服务器调试

```bash
npm run mock
```

登录时服务器地址填 `127.0.0.1:5666`，用户名和密码都是 `demo`。模拟服务器带有示例专辑、封面、可播放的音频和同步歌词。

## 结构

```
electron/main.js     主进程：fnm:// 协议代理（附带 music-token Cookie）、登录与凭证存储、窗口
electron/preload.js  向渲染进程暴露的有限 IPC
src/api.js           飞牛音乐 API 封装与数据映射
src/store.js         播放器 / 界面 / 登录状态（zustand）
src/components/      顶栏播放器、侧边栏、歌曲列表、卡片、菜单、全屏播放页
src/pages/           各页面
dev/mock-server.js   API 模拟服务器
```

渲染进程的所有请求（接口、封面、音频流）都发往 `fnm://srv/...`，由主进程转发到 `<服务器>/music/...` 并附带 `music-token` Cookie，渲染进程接触不到凭证。

## 说明

飞牛音乐的 API 没有公开文档。本项目使用的接口参照了开源项目 [Liusound](https://github.com/silence-top/Liusound) 中的 fnOS 适配器。如果飞牛更新后接口有变化，请调整 `src/api.js`。
