// 类 SF Symbols 风格的线性/填充图标
const I = ({ children, size = 20, fill, className, style, viewBox = '0 0 24 24' }) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const Play = (p) => <I fill {...p}><path d="M7 4.8v14.4c0 .9 1 1.5 1.8 1l11.4-7.2c.7-.5.7-1.5 0-2L8.8 3.8C8 3.3 7 3.9 7 4.8z" /></I>
export const Pause = (p) => <I fill {...p}><rect x="6" y="4" width="4.2" height="16" rx="1.2" /><rect x="13.8" y="4" width="4.2" height="16" rx="1.2" /></I>
export const Next = (p) => <I fill {...p}><path d="M2.5 6.2v11.6c0 .8.9 1.3 1.6.8l8.4-5.8c.6-.4.6-1.3 0-1.7L4.1 5.4c-.7-.5-1.6 0-1.6.8z" /><path d="M11.5 6.2v11.6c0 .8.9 1.3 1.6.8l8.4-5.8c.6-.4.6-1.3 0-1.7l-8.4-5.7c-.7-.5-1.6 0-1.6.8z" /></I>
export const Prev = (p) => <I fill {...p}><g transform="matrix(-1 0 0 1 24 0)"><path d="M2.5 6.2v11.6c0 .8.9 1.3 1.6.8l8.4-5.8c.6-.4.6-1.3 0-1.7L4.1 5.4c-.7-.5-1.6 0-1.6.8z" /><path d="M11.5 6.2v11.6c0 .8.9 1.3 1.6.8l8.4-5.8c.6-.4.6-1.3 0-1.7l-8.4-5.7c-.7-.5-1.6 0-1.6.8z" /></g></I>
export const Shuffle = (p) => <I {...p}><path d="M3 7h3.5c2 0 3.2 1 4.3 2.6l2.4 4.8c1 1.6 2.3 2.6 4.3 2.6H21" /><path d="M3 17h3.5c1.6 0 2.7-.6 3.6-1.7M13.9 8.7c.9-1.1 2-1.7 3.6-1.7H21" /><path d="M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" /></I>
export const Repeat = (p) => <I {...p}><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M16.5 2.5 20 6l-3.5 3.5" /><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4M7.5 21.5 4 18l3.5-3.5" /></I>
export const RepeatOne = (p) => <I {...p}><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M16.5 2.5 20 6l-3.5 3.5" /><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4M7.5 21.5 4 18l3.5-3.5" /><path d="M11 10.5l1.5-1v5" strokeWidth="1.6" /></I>
export const Volume = (p) => <I {...p}><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" /></I>
export const VolumeLow = (p) => <I {...p}><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor" /></I>
export const Mute = (p) => <I {...p}><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></I>
export const Lyrics = (p) => <I {...p}><path d="M4.5 5.5h12a2.5 2.5 0 0 1 2.5 2.5v6.5a2.5 2.5 0 0 1-2.5 2.5h-5L7 20.5V17H4.5" /><path d="M4.5 5.5A2.5 2.5 0 0 0 2 8v6.5A2.5 2.5 0 0 0 4.5 17" /><path d="M7.5 10h7M7.5 13h4.5" /></I>
export const LyricBox = (p) => <I {...p}><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.6" /><text x="12" y="11.8" textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif">词</text></I>
export const Translate = (p) => (
  <I {...p} viewBox="0 0 1024 1024" fill>
    <path d="M925.866667 883.2l-46.933334-106.666667-123.733333-277.333333c-8.533333-21.333333-46.933333-21.333333-59.733333 0l-72.533334 166.4-12.8-12.8s-128-51.2-217.6-110.933333l12.8-12.8c81.066667-81.066667 119.466667-209.066667 136.533334-264.533334H597.333333c17.066667 0 34.133333-12.8 34.133334-34.133333s-17.066667-25.6-34.133334-25.6H392.533333c4.266667-8.533333 4.266667-12.8 0-21.333333l-21.333333-64c-4.266667-17.066667-21.333333-25.6-38.4-21.333334-17.066667 4.266667-25.6 21.333333-21.333333 38.4l21.333333 64H128c-17.066667 0-34.133333 12.8-34.133333 34.133334s17.066667 29.866667 34.133333 29.866666h341.333333c-17.066667 55.466667-51.2 153.6-115.2 217.6l-17.066666 17.066667c-68.266667-68.266667-93.866667-166.4-98.133334-166.4 0-17.066667-17.066667-25.6-34.133333-21.333333-17.066667 4.266667-25.6 21.333333-21.333333 38.4 0 4.266667 34.133333 110.933333 106.666666 192-85.333333 64-174.933333 110.933333-179.2 110.933333-17.066667 8.533333-21.333333 25.6-12.8 42.666667 4.266667 12.8 17.066667 17.066667 29.866667 17.066666 4.266667 0 8.533333 0 12.8-4.266666 4.266667-4.266667 106.666667-55.466667 196.266667-128 98.133333 72.533333 238.933333 128 247.466666 128h17.066667l-25.6 59.733333-46.933333 106.666667c0 4.266667-4.266667 8.533333-4.266667 12.8 0 12.8 8.533333 25.6 17.066667 29.866666 17.066667 8.533333 34.133333 0 42.666666-17.066666l38.4-89.6h204.8l38.4 89.6c4.266667 12.8 17.066667 17.066667 29.866667 17.066666 4.266667 0 8.533333 0 12.8-4.266666 12.8-4.266667 17.066667-17.066667 17.066667-29.866667 4.266667 8.533333 0 4.266667 0 0z m-273.066667-123.733333l72.533333-166.4 72.533334 166.4h-145.066667z" />
  </I>
)
export const QueueIcon = (p) => <I {...p}><path d="M4 6h11M4 11h11M4 16h7" /><path d="M15 14.5v5.2a1.8 1.8 0 1 1-1.5-1.8M15 14.5l4.5-1.3" /></I>
export const Search = (p) => <I {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></I>
export const Home = (p) => <I {...p}><path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19z" /></I>
export const Grid = (p) => <I {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></I>
export const Clock = (p) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></I>
export const Mic = (p) => <I {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></I>
export const AlbumIcon = (p) => <I {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></I>
export const Note = (p) => <I {...p}><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></I>
export const Guitar = (p) => <I {...p}><path d="M14 10 20 4M18 3l3 3" /><path d="M11.5 9.5c-1.6-.4-3.3 0-4.4 1.2-.9.9-.8 2.1-1.9 2.6-1.4.6-2.6 1.6-2.2 3.4.4 1.7 2.3 3.3 4 3.7 1.8.4 2.9-.8 3.4-2.2.5-1.1 1.7-1 2.6-1.9 1.2-1.1 1.6-2.8 1.2-4.4" /><circle cx="10" cy="14" r="1.3" /></I>
export const ListIcon = (p) => <I {...p}><path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20" /><circle cx="4.5" cy="6.5" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="17.5" r="1" fill="currentColor" /></I>
export const Heart = (p) => <I {...p}><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" /></I>
export const HeartFill = (p) => <I fill {...p}><path d="M12 20.5S3.8 15.6 3.8 9.6a4.7 4.7 0 0 1 8.2-3.1 4.7 4.7 0 0 1 8.2 3.1c0 6-8.2 10.9-8.2 10.9z" /></I>
export const More = (p) => <I fill {...p}><circle cx="5.5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.5" cy="12" r="1.7" /></I>
export const Plus = (p) => <I {...p}><path d="M12 5v14M5 12h14" /></I>
export const ChevronDown = (p) => <I {...p}><path d="m6 9 6 6 6-6" /></I>
export const ChevronRight = (p) => <I {...p}><path d="m9 6 6 6-6 6" /></I>
export const ChevronLeft = (p) => <I {...p}><path d="m15 6-6 6 6 6" /></I>
export const Close = (p) => <I {...p}><path d="M6 6l12 12M18 6 6 18" /></I>
export const Trash = (p) => <I {...p}><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.2A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" /></I>
export const Edit = (p) => <I {...p}><path d="M14.5 5.5 18.5 9.5M4 20l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19z" /></I>
export const PlayNext = (p) => <I {...p}><path d="M4 6h10M4 11h10M4 16h6" /><path d="m15 13.5 5 3-5 3z" fill="currentColor" /></I>
export const PlayLater = (p) => <I {...p}><path d="M4 6h10M4 11h10M4 16h6" /><path d="M17 13v7M13.5 16.5h7" /></I>
export const Person = (p) => <I {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></I>
export const Logout = (p) => <I {...p}><path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" /></I>
export const Sun = (p) => <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></I>
export const Moon = (p) => <I {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></I>
export const Monitor = (p) => <I {...p}><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M8.5 20.5h7M12 16.5v4" /></I>
export const Expand = (p) => <I {...p}><path d="M14.5 4H20v5.5M9.5 20H4v-5.5M20 4l-6.5 6.5M4 20l6.5-6.5" /></I>
export const Sidebar = (p) => <I {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></I>
export const Check = (p) => <I {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></I>
export const Disc = (p) => <I {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.5" /></I>
export const Wave = (p) => <I {...p}><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" /></I>

// 正在播放的跳动音柱
export const Bars = ({ playing = true }) => (
  <span className={'eq' + (playing ? ' on' : '')} aria-label="正在播放">
    <i /><i /><i /><i />
  </span>
)
