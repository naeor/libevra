import { GuestModeBadge } from "./GuestModeBadge.js";
import { useCollapsingHeader } from "../lib/useCollapsingHeader.js";

/** 一级页共用顶栏，同一组标题 / 操作节点避免收缩时重挂载和焦点丢失。 */
export function TabPageHeader({ title, subtitle, action, expanded, className = "bg-brand text-on-brand" }: {
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: React.ReactNode;
  /** 我的页保留头像资料版式，紧凑态显示标题行。 */
  readonly expanded?: React.ReactNode;
  readonly className?: string;
}): React.JSX.Element {
  const ref = useCollapsingHeader();
  return (
    <header ref={ref} className={`tab-page-header ${expanded ? "tab-page-header-profile" : ""} ${className}`}>
      <div className="tab-page-header-row flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-2 text-page-title">
            <span className="truncate">{title}</span>
            <GuestModeBadge className="shrink-0" />
          </h1>
          {!expanded && subtitle ? <div data-header-extra className="tab-page-header-extra"><p className="mt-1.5 text-body-relaxed">{subtitle}</p></div> : null}
        </div>
        {action ? <div className="tab-page-header-actions">{action}</div> : null}
      </div>
      {expanded ? <div data-header-extra className="tab-page-header-extra">{expanded}</div> : null}
    </header>
  );
}
