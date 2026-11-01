/**
 * **主展示区 + 情境辅助栏。**
 *
 * 辅助栏是当前任务的延伸（选中账目的详情、选中图表的说明），不是 iPad 那种有独立导航历史的第二工作区。
 * 没有辅助内容时它完全消失；有内容但窗口太窄时，内容改在主展示区里显示（覆盖在列表之上、带返回），
 * 列表本身不卸载，搜索、筛选与滚动位置都保留。
 *
 * 分界线平时只是一条很浅的细线；鼠标移到附近变成左右调整光标，可拖动、可用方向键调整，双击或 Enter
 * 恢复默认宽度。宽度记在本机。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n/index.js";
import { DesktopSurfaceProvider } from "./surface.js";
import { clampPanel, PANEL_DEFAULT, PANEL_MIN, readPanelWidth, splitLayout, writePanelWidth } from "./split.js";

export function useElementWidth<T extends HTMLElement>(): { readonly ref: React.RefObject<T | null>; readonly width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, width };
}

export function DesktopSplit({
  children,
  panel,
  panelLabel,
  onClosePanel,
  whenNarrow = "overlay",
  panelDisabled = false,
  disabledMessage,
}: {
  readonly children: React.ReactNode;
  /**
   * 放不下并排时：`overlay` 把辅助内容放进主展示区（选中某一项的详情）；`hide` 直接收起
   * （常驻的补充信息，例如协作页右侧的留言）。
   */
  readonly whenNarrow?: "overlay" | "hide";
  /** 辅助栏内容；`null` 时辅助栏完全不出现。 */
  readonly panel: React.ReactNode | null;
  readonly panelLabel: string;
  readonly onClosePanel?: () => void;
  /** 批量操作时保留面板及草稿，只暂停交互。 */
  readonly panelDisabled?: boolean;
  readonly disabledMessage?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const box = useElementWidth<HTMLDivElement>();
  const [preferred, setPreferred] = useState(readPanelWidth);
  const [dragging, setDragging] = useState(false);
  const layout = splitLayout(box.width, preferred);
  const drag = useRef<{ readonly startX: number; readonly startWidth: number; readonly pointerId: number } | null>(null);
  const latest = useRef(preferred);
  latest.current = preferred;

  const commit = useCallback((width: number) => {
    const next = clampPanel(width);
    setPreferred(next);
    writePanelWidth(next);
  }, []);

  const hasPanel = panel !== null && (layout.fits || whenNarrow === "overlay");
  const stacked = hasPanel && !layout.fits;

  return (
    <div ref={box.ref} className="lv-desk-split" data-dragging={dragging ? "true" : undefined}>
      <div className="lv-desk-split-main" inert={stacked && !panelDisabled} aria-hidden={stacked && !panelDisabled ? true : undefined}>
        {children}
      </div>
      {!hasPanel ? null : stacked ? (
        // 放不下并排：辅助内容覆盖在主展示区上，用桌面式详情 + 返回；下面的列表原样保留。
        <section className="lv-desk-split-overlay" aria-label={panelLabel} hidden={panelDisabled} inert={panelDisabled}>
          <DesktopSurfaceProvider surface="main" {...(onClosePanel === undefined ? {} : { onBack: onClosePanel })}>
            {panel}
          </DesktopSurfaceProvider>
        </section>
      ) : (
        <>
          <div
            role="separator"
            tabIndex={panelDisabled ? -1 : 0}
            aria-disabled={panelDisabled || undefined}
            aria-orientation="vertical"
            aria-label={t("desktop.panel.resize")}
            aria-valuemin={PANEL_MIN}
            aria-valuemax={layout.maxPanel}
            aria-valuenow={layout.panelWidth}
            title={t("desktop.panel.resizeHint")}
            className="lv-desk-splitter"
            onPointerDown={(event) => {
              if (panelDisabled || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { startX: event.clientX, startWidth: layout.panelWidth, pointerId: event.pointerId };
              setDragging(true);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (panelDisabled || current === null || current.pointerId !== event.pointerId) return;
              // 分界线往左拖，辅助栏变宽。
              setPreferred(Math.min(layout.maxPanel, clampPanel(current.startWidth + (current.startX - event.clientX))));
            }}
            onPointerUp={(event) => {
              if (drag.current?.pointerId !== event.pointerId) return;
              drag.current = null;
              setDragging(false);
              commit(latest.current);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(false);
            }}
            onDoubleClick={() => { if (!panelDisabled) commit(PANEL_DEFAULT); }}
            onKeyDown={(event) => {
              if (panelDisabled) return;
              const step = event.shiftKey ? 48 : 16;
              if (event.key === "ArrowLeft") commit(Math.min(layout.maxPanel, layout.panelWidth + step));
              else if (event.key === "ArrowRight") commit(layout.panelWidth - step);
              else if (event.key === "Enter") commit(PANEL_DEFAULT);
              else return;
              event.preventDefault();
            }}
          />
          <aside className="lv-desk-panel" aria-label={panelLabel} aria-disabled={panelDisabled || undefined} style={{ width: layout.panelWidth }}>
            {panelDisabled ? <div className="lv-desk-panel-disabled-note" role="status"><span>{disabledMessage}</span></div> : null}
            <div className="lv-desk-panel-content" inert={panelDisabled}>
            <DesktopSurfaceProvider surface="panel" {...(onClosePanel === undefined ? {} : { onClose: onClosePanel })}>
              {panel}
            </DesktopSurfaceProvider>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
