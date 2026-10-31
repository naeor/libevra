import { GuestModeBadge } from "./GuestModeBadge.js";
import { useCollapsingHeader } from "../lib/useCollapsingHeader.js";
import { DesktopTabHeader } from "../desktop/DesktopFrames.js";
import { useDesktopSurface } from "../desktop/surface.js";

type TabPageHeaderProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: React.ReactNode;
  readonly expanded?: React.ReactNode;
  readonly className?: string;
};

/** 电脑版外壳里换成稳定的桌面工具栏（不收缩、没有绿色背景），见 `desktop/DesktopFrames.tsx`。 */
export function TabPageHeader(props: TabPageHeaderProps): React.JSX.Element {
  return useDesktopSurface() === null ? <MobileTabPageHeader {...props} /> : <DesktopTabHeader title={props.title} subtitle={props.subtitle} action={props.action} />;
}

function MobileTabPageHeader({ title, subtitle, action, expanded, className = "bg-brand text-on-brand" }: TabPageHeaderProps): React.JSX.Element {
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
