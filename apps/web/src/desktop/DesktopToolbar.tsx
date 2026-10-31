import { ChevronIcon } from "../components/Icons.js";
import { useI18n } from "../i18n/index.js";

/**
 * 电脑版页面顶部的稳定工具栏：标题、可选的返回、页面工具与动作。高度固定，滚动时不收缩、不变色
 * （与手机的绿色大标题不同）。
 */
export function DesktopToolbar({
  title,
  meta,
  onBack,
  children,
  actions,
  level = "page",
}: {
  readonly title: React.ReactNode;
  readonly meta?: React.ReactNode;
  readonly onBack?: (() => void) | undefined;
  /** 标题右侧的页面工具（月份、搜索等），占据中间的可伸缩空间。 */
  readonly children?: React.ReactNode;
  readonly actions?: React.ReactNode;
  /** `page`：主展示区页面标题；`section`：较小的区块标题。 */
  readonly level?: "page" | "section";
}): React.JSX.Element {
  const { t } = useI18n();
  const Heading = level === "page" ? "h1" : "h2";
  return (
    <div className="lv-desk-toolbar" data-level={level}>
      {onBack === undefined ? null : (
        <button type="button" className="lv-desk-icon-btn -ml-2" onClick={onBack} aria-label={t("desktop.page.back")}>
          <ChevronIcon direction="left" className="size-5" />
        </button>
      )}
      <div className="lv-desk-toolbar-title">
        <Heading className={`truncate text-ink ${level === "page" ? "text-page-title" : "text-section-title"}`}>{title}</Heading>
        {meta === undefined || meta === null ? null : <div className="truncate text-helper text-muted">{meta}</div>}
      </div>
      <div className="lv-desk-toolbar-center">{children}</div>
      {actions === undefined || actions === null ? null : <div className="lv-desk-toolbar-actions">{actions}</div>}
    </div>
  );
}
