/**
 * **记账工作区的顶栏**（1.19.78，所有者 2026-11-14 的要求）。
 *
 * 记账方式页（手动记账、文本、语音、拍照、导入账单）在手机上是一个独立工作区：进入时隐藏常驻的五项底栏，离开时恢复；
 * 顶部是一条较矮的导航栏——左侧返回箭头，中间是页面标题（手动记账为「记一笔」），右侧暂时留空。
 * 「支出 / 收入」仍在正文顶部；底部保留各页原有的主操作（保存），不再另加返回按钮。
 *
 * - 返回走现有的工作区退出逻辑：调用方传进来的 `onBack`（与次级页顶栏同一套 `useGoBack` + `markBack`），协调器按“离开工作区”播放转场。
 * - 材质沿用次级页顶栏（`data-page-nav`）：停在顶部时融在环境里，内容滚到它下面才出现栏面材质（s19/ambient.css），A 不额外浮起。
 * - 标题是这一页的 `h1`（`tabIndex=-1`）：转场后的焦点恢复会找它；视觉上是栏里的小标题。
 * - 高 44px（次级页顶栏是 48px），返回箭头的触控区 44×44，箭头落在内容 24px 的边线上。
 */
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n/index.js";
import { ChevronIcon } from "../Icons.js";

export function WorkspaceTopBar({ title, onBack, actions, children }: {
  readonly title: string;
  readonly onBack: () => void;
  /** 右侧：暂时留空；页面原来带的操作（如果有）放在这里。 */
  readonly actions?: React.ReactNode;
  /** 与次级页顶栏一样，固定在同一个吸顶组里的横幅（同步横幅）。 */
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  const sentinel = useRef<HTMLSpanElement | null>(null);
  const [condensed, setCondensed] = useState(false);

  // 内容滚到栏下面时才出现栏面材质：观察紧跟在栏后面的哨兵（与次级页顶栏同一做法，滚动时不付代价）。
  useEffect(() => {
    const node = sentinel.current;
    if (node === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setCondensed(!entry.isIntersecting && entry.boundingClientRect.top < 64);
    }, { rootMargin: "-48px 0px 0px 0px", threshold: 0 });
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, []);

  return (
    <>
      <div
        data-page-nav=""
        data-workspace-nav=""
        data-condensed={condensed ? "true" : "false"}
        className={`sticky top-0 z-30 border-b pt-[env(safe-area-inset-top,0px)] transition-[background-color,border-color] duration-200 ${
          condensed ? "border-line bg-canvas/90 backdrop-blur-md" : "border-transparent bg-canvas"
        }`}
      >
        {children}
        <nav aria-label={t("nav.page.nav")} className="relative mx-auto flex h-11 w-full max-w-md items-center justify-between px-3">
          <button
            type="button"
            data-back-control=""
            aria-label={t("nav.page.back")}
            onClick={onBack}
            className="flex size-11 shrink-0 items-center justify-center rounded-field text-brand-dark transition hover:bg-brand-soft active:bg-brand-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
          >
            <ChevronIcon direction="left" className="size-5" />
          </button>
          <h1 tabIndex={-1} className="pointer-events-none absolute inset-x-14 truncate text-center text-section-title text-ink outline-none">
            {title}
          </h1>
          {/* 右侧暂时留空（与左侧等宽，标题保持居中）；页面原来带的操作放这里。 */}
          {actions === undefined || actions === null ? <span className="size-11 shrink-0" aria-hidden="true" /> : <div className="relative flex shrink-0 items-center gap-1">{actions}</div>}
        </nav>
      </div>
      <span ref={sentinel} aria-hidden="true" className="block h-0" />
    </>
  );
}
