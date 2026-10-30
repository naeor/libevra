/**
 * 工作区外壳用到的小图标：24px 画布、`currentColor`、1.7 线宽，与底部导航同一套画法。
 */
interface IconProps {
  readonly className?: string;
}

/** 侧栏收起 / 展开：一个窗口，左边一条竖栏。 */
export function SidebarIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path d="M9.5 5v14" />
    </svg>
  );
}

/** 打开第二个工作区：一个窗口分成两块，横屏左右、竖屏上下。 */
export function SplitIcon({ className, vertical = false }: IconProps & { readonly vertical?: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      {vertical ? <path d="M3.5 13h17" /> : <path d="M13 5v14" />}
    </svg>
  );
}

export function MenuIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <path d="M5 7.5h14M5 12h14M5 16.5h14" strokeLinecap="round" />
    </svg>
  );
}

export function BackIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M14.5 6 8.5 12l6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function XIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" strokeLinecap="round" />
    </svg>
  );
}

export function BookIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H18v14H6.5A1.5 1.5 0 0 0 5 19.5v-14Z" strokeLinejoin="round" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H18v-3" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path d="m6 12.5 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CaretIcon({ className, open }: IconProps & { readonly open: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`${className ?? ""} transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
      aria-hidden="true"
    >
      <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 辅助工作区导航按钮：四个圆角小方块（「去往别处」）。 */
export function GridIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.8" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.8" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.8" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.8" />
    </svg>
  );
}
