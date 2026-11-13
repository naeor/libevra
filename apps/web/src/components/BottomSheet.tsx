import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { useI18n } from "../i18n/index.js";
import { decideClose, useBackGuard } from "../lib/closeGuard.js";
import { useDialogFocus } from "../lib/dialogFocus.js";
import { useSheetDrag, type SheetDragZone } from "../lib/sheetDrag.js";
import { useOverlayExit, useOverlayScrollLock } from "../lib/useOverlayPresentation.js";
import { materialAttributes } from "../s19/material.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { CloseIcon } from "./Icons.js";
import { useKeyboardInset } from "./entry/keyboardInset.js";
import "./panel-template.css";

/**
 * **弹出面板模板：从底部升起的面板外壳**（1.19.58 起是 T1 列表、T2 表单、T4 信息说明、T5 大面积编辑的共同外壳；
 * 规格：docs/specs/design/S19-材质组件与动效设计系统.md「弹出面板模板」）。
 *
 * 结构固定为：拖动条（只在可下拉时出现）→ 标题行（标题 + 右上角 44px ×，可带说明、左侧返回、右侧工具）→
 * 内容滚动区 → 可选的固定底部操作区；安全区留白与软键盘抬升由外壳负责。
 *
 *  * **进出动画**仍是 `sheet-in`（260ms 出弦缓动）与 `sheet-out`（200ms 加速），先播放完退场再调用 `onClose`
 *    卸载，不会在动画半路消失（m06693，所有者要求“从下往上展开、从上往下收回”）。⚠️ `overlayExit.ts` 的
 *    `OVERLAY_EXIT_MS` 必须与 `index.css` 的 `libellum-sheet-out` 200ms 一致。不再套第二层 Presence（规格 §5）。
 *  * **关闭入口一视同仁**：点遮罩、下拉、×、Esc、系统返回走同一个判断（`lib/closeGuard.ts`）：正在保存（`busy`）
 *    时不响应；有改动（`dirty`）时先用中央确认框询问是否放弃；没有改动直接关闭。保存成功后用 `finish` 关闭，不再询问。
 *  * **下拉关闭**（`lib/sheetDrag.ts`）只从拖动条与标题区起手，内容区照常滚动。
 *  * **三档高度**（`detent`，令牌在 `panel-template.css`）：`content` 按内容、最多约半屏（T4）；`half` 约 52%、
 *    内容更短时按内容（T1、T2）；`half-fixed` 固定半屏（账本选择）；`large` 接近全屏（T5）。只在手机宽度生效。
 *  * **宽屏形态暂不改变**（审查 H9 留待以后）：`wide` 保留各面板原来的样子——`center` 是原 BottomSheet
 *    （宽工作区与宽窗口里居中）、`pane` 只在宽工作区里居中（原月份选择）、`bottom` 一直贴底（原选择面板、账本面板）。
 *  * **门禁变体**（`dismissible={false}`）：没有 ×、没有 Esc、点遮罩与下拉都不关，层级最高（`layer="gate"`）。
 *
 * ⚠️ **S18（审查 U04）焦点**：焦点进入面板、Tab 圈在面板里（`useDialogFocus`，各面板不再各写一份 Tab 圈）、
 * 关闭后回到打开它的控件；多层面板时只有最上面那一层响应 Esc。
 * ⚠️ **S18（审查 U07）软键盘**：面板整体抬到键盘之上，高度不超过键盘以上的可视区。
 * ⚠️ **S18 高度单位是 `--lv-vh`**：手机上等于 `dvh`；大屏工作区里是工作区自己的高度，面板只盖住所在工作区。
 * ⚠️ **减少动态**时动画由 CSS 关掉，关闭时机不变。
 */

export type SheetDetent = "content" | "half" | "half-fixed" | "large";
/** 宽屏下暂时保留的原有形态（审查 H9）。 */
export type SheetWideForm = "center" | "pane" | "bottom";

export interface SheetControls {
  /** 关闭请求：与 ×、遮罩、Esc 相同，有改动时先询问。 */
  readonly close: () => void;
  /** 保存 / 应用成功后关闭：不再询问，也不受 `busy` 阻止。 */
  readonly finish: () => void;
  /** 先播放退场，再执行动作（例如导航），面板不会在动画半路被拔掉。 */
  readonly closeThen: (action: () => void) => void;
}

interface SheetContextValue extends SheetControls {
  readonly drag: SheetDragZone | null;
  readonly dismissible: boolean;
  readonly closeLabel: string;
}

const SheetContext = createContext<SheetContextValue | null>(null);

/** 面板里的自定义部件（例如自己画标题行的筛选表单）取得外壳的关闭入口。不在面板里时返回 null。 */
export function useSheetControls(): SheetControls | null {
  return useContext(SheetContext);
}

export interface BottomSheetProps {
  /** 无障碍名称：`role="dialog"` 没有可见标题时也必须有名字；也用于 × 的名称“关闭{label}”。 */
  readonly label: string;
  /** 可见标题。给了就由外壳画模板标题行（标题 + ×）；需要随内容变化的标题行可在内容里用 `SheetHeader`。 */
  readonly title?: ReactNode;
  /** 标题下的一句说明。 */
  readonly description?: ReactNode;
  /** 标题左侧（例如子页面的返回）。 */
  readonly headerLeading?: ReactNode;
  /** 标题右侧、× 之前的工具。 */
  readonly headerActions?: ReactNode;
  readonly detent?: SheetDetent;
  readonly wide?: SheetWideForm;
  /** 固定在底部、不随内容滚动的操作区。 */
  readonly footer?: ReactNode | ((controls: SheetControls) => ReactNode);
  /** false = 门禁：不能随手关闭（无 ×、无 Esc、点遮罩与下拉不关）。 */
  readonly dismissible?: boolean;
  /** 有尚未保存的改动：关闭前先询问。 */
  readonly dirty?: boolean;
  /** 正在保存：关闭请求一律不响应。 */
  readonly busy?: boolean;
  /** 询问的文案（默认“放弃修改？”）。 */
  readonly discard?: {
    readonly title?: string;
    readonly description?: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
  };
  /** 面板材质用途：默认操作面（规格 §3）；同意书等展示内容用 display。 */
  readonly material?: "chrome" | "display";
  /** gate：层级最高（同意书门禁）。 */
  readonly layer?: "default" | "gate";
  readonly role?: "dialog" | "alertdialog";
  /** 打开时把焦点放到哪里（默认面板本身，避免手机上直接弹出键盘）。 */
  readonly initialFocus?: (panel: HTMLElement) => HTMLElement | null | undefined;
  readonly onClose: () => void;
  /** 面板自己的宽度、宽屏高度等；手机宽度的高度由 `detent` 决定。 */
  readonly dialogClassName?: string;
  /** 内容滚动区的额外类名（内边距等）。 */
  readonly bodyClassName?: string;
  /**
   * 面板内容。传函数时拿到 `close`（走同一段退场动画、有改动时先询问）与完整的 `controls`；
   * 面板里的关闭按钮应当用它们，**不要直接调用 `onClose`**，否则面板会在动画开始的那一帧被拔掉。
   */
  readonly children: ReactNode | ((close: () => void, controls: SheetControls) => ReactNode);
}

const ROOT_CLASS: Record<SheetWideForm, string> = {
  center: "lv-sheet-backdrop items-end sm:items-center",
  pane: "lv-sheet-backdrop items-end",
  bottom: "items-end",
};
/** 宽屏（≥640px）沿用原来的高度上限；手机宽度由 panel-template.css 的档位覆盖。 */
const PANEL_CLASS: Record<SheetWideForm, string> = {
  center: "lv-sheet max-h-[calc(var(--lv-vh)*88_-_var(--lv-sheet-kb,0px))] sm:max-h-[calc(var(--lv-vh)*80_-_var(--lv-sheet-kb,0px))] sm:rounded-card",
  pane: "lv-sheet max-h-[calc(var(--lv-vh)*88_-_var(--lv-sheet-kb,0px))]",
  bottom: "mx-auto max-h-[calc(var(--lv-vh)*100_-_24px_-_var(--lv-sheet-kb,0px))]",
};

export function BottomSheet({
  label,
  title,
  description,
  headerLeading,
  headerActions,
  detent = "half",
  wide = "center",
  footer,
  dismissible = true,
  dirty = false,
  busy = false,
  discard,
  material = "chrome",
  layer = "default",
  role = "dialog",
  initialFocus,
  onClose,
  dialogClassName = "",
  bodyClassName = "",
  children,
}: BottomSheetProps): React.JSX.Element {
  const { t } = useI18n();
  const { closing, requestClose: exit, afterExit } = useOverlayExit(onClose);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focus = useDialogFocus(panelRef);
  const keyboard = useKeyboardInset(rootRef);
  useOverlayScrollLock(rootRef);
  const [asking, setAsking] = useState(false);

  /** 最新的改动 / 保存状态：关闭请求可能来自旧闭包（Esc 监听、拖动回调）。 */
  const latest = useRef({ dirty, busy });
  latest.current = { dirty, busy };

  /** 所有关闭入口的共同判断；返回是否真的开始关闭（下拉据此决定弹回）。 */
  const request = useCallback((): boolean => {
    if (!dismissible) return false;
    const decision = decideClose(latest.current);
    if (decision === "ask") {
      setAsking(true);
      return false;
    }
    if (decision === "ignore") return false;
    exit();
    return true;
  }, [dismissible, exit]);

  const controls = useMemo<SheetControls>(() => ({
    close: () => { request(); },
    finish: () => { exit(); },
    closeThen: (action: () => void) => { afterExit(action); },
  }), [request, exit, afterExit]);

  const drag = useSheetDrag(panelRef, dismissible && !closing, request);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !focus.owns(event)) return;
      // 门禁也吞掉这次 Esc：下面的层不应被关掉。
      event.preventDefault();
      request();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [focus, request]);

  // 系统返回：有改动时同样先询问（只在主工作区；没有改动时保持原来的返回行为）。
  useBackGuard(dismissible && dirty && !closing, () => {
    if (!latest.current.busy) setAsking(true);
  });

  const initialFocusRef = useRef(initialFocus);
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    initialFocusRef.current?.(panel)?.focus({ preventScroll: true });
  }, []);

  const closeLabel = t("nav.sheet.close", { title: label });
  const context = useMemo<SheetContextValue>(
    () => ({ ...controls, drag, dismissible, closeLabel }),
    [controls, drag, dismissible, closeLabel],
  );

  return (
    <div
      ref={rootRef}
      data-overlay-root="sheet"
      data-overlay-state={closing ? "closing" : "open"}
      data-overlay-scrim={detent === "large" ? "dialog" : "sheet"}
      role="presentation"
      onClick={(event) => {
        // 只有遮罩本身算“点背景”：里面的确认框、面板内容冒泡上来的点击不关闭。
        if (event.target === event.currentTarget) request();
      }}
      style={keyboard > 0 ? { paddingBottom: keyboard } : undefined}
      className={`fixed inset-0 flex justify-center ${layer === "gate" ? "z-[80]" : "z-50"} ${ROOT_CLASS[wide]}`}
    >
      <div
        ref={panelRef}
        data-overlay-surface="sheet"
        data-overlay-state={closing ? "closing" : "open"}
        data-sheet-detent={detent}
        data-sheet-wide={wide}
        data-sheet-gate={dismissible ? undefined : "true"}
        {...(material === "display" ? materialAttributes("display") : {})}
        inert={closing}
        role={role}
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === "libellum-sheet-in") {
            event.currentTarget.dataset.overlayEntered = "true";
          }
        }}
        style={{ "--lv-sheet-kb": `${String(keyboard)}px` } as React.CSSProperties}
        className={`relative z-0 flex w-full max-w-md flex-col rounded-t-sheet bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-sheet outline-none ${PANEL_CLASS[wide]} ${
          closing ? "sheet-out" : "sheet-in"
        } ${dialogClassName}`}
      >
        <SheetContext.Provider value={context}>
          {drag === null ? null : (
            <div data-sheet-handle aria-hidden="true" {...drag}>
              <span />
            </div>
          )}
          {title === undefined ? null : (
            <HeaderRow
              title={title}
              description={description}
              leading={headerLeading}
              actions={headerActions}
              drag={drag}
              closable={dismissible}
              onClose={controls.close}
              closeLabel={closeLabel}
              compact={drag !== null}
            />
          )}
          <div data-sheet-body className={`flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain ${bodyClassName}`}>
            {typeof children === "function" ? children(controls.close, controls) : children}
          </div>
          {footer === undefined || footer === null ? null : (
            <div data-sheet-footer className="shrink-0 border-t border-line px-5 pt-3 pb-3">
              {typeof footer === "function" ? footer(controls) : footer}
            </div>
          )}
        </SheetContext.Provider>
      </div>

      {/* 关闭前询问（T3 确认框）：渲染在遮罩里、面板旁边，不受面板位移影响，仍在所属工作区内。 */}
      <ConfirmDialog
        open={asking}
        title={discard?.title ?? t("nav.sheet.discardTitle")}
        description={discard?.description ?? t("nav.sheet.discardBody")}
        confirmLabel={discard?.confirmLabel ?? t("nav.sheet.discardConfirm")}
        cancelLabel={discard?.cancelLabel ?? t("nav.sheet.discardKeep")}
        onConfirm={() => {
          setAsking(false);
          exit();
        }}
        onCancel={() => {
          setAsking(false);
        }}
      />
    </div>
  );
}

/**
 * 模板标题行：标题（+ 说明）在左，44px × 在右上角；整行也是下拉起手区。
 * 外壳给了 `title` 时自动画；标题需要随面板内部状态变化时（筛选、预设库）在内容里直接用它。
 */
export function SheetHeader({
  title,
  description,
  leading,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
}): React.JSX.Element {
  const sheet = useContext(SheetContext);
  return (
    <HeaderRow
      title={title}
      description={description}
      leading={leading}
      actions={actions}
      drag={sheet?.drag ?? null}
      closable={sheet?.dismissible ?? false}
      onClose={sheet?.close ?? (() => undefined)}
      closeLabel={sheet?.closeLabel ?? ""}
      compact={sheet?.drag !== null && sheet?.drag !== undefined}
    />
  );
}

/** 统一的右上角关闭按钮：44px 圆形点击区、同一个细线 × 图标。 */
export function SheetCloseButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      data-sheet-close
      onClick={onClick}
      aria-label={label}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
    >
      <CloseIcon className="size-[18px]" />
    </button>
  );
}

function HeaderRow({
  title,
  description,
  leading,
  actions,
  drag,
  closable,
  onClose,
  closeLabel,
  compact,
}: {
  readonly title: ReactNode;
  readonly description: ReactNode | undefined;
  readonly leading: ReactNode | undefined;
  readonly actions: ReactNode | undefined;
  readonly drag: SheetDragZone | null;
  readonly closable: boolean;
  readonly onClose: () => void;
  readonly closeLabel: string;
  /** 上面已经有拖动条：标题行上边距收小。 */
  readonly compact: boolean;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <div
      data-sheet-header
      {...(drag ?? {})}
      className={`flex shrink-0 items-start gap-1 px-3 pb-1 ${compact ? "pt-0.5" : "pt-3"}`}
    >
      {leading}
      <div className={`min-w-0 flex-1 py-2.5 ${leading === undefined || leading === null ? "pl-2" : ""}`}>
        <h2 id={titleId} className="text-section-title text-ink">{title}</h2>
        {description === undefined || description === null ? null : (
          <div className="mt-1 text-helper-relaxed text-muted">{description}</div>
        )}
      </div>
      {actions === undefined || actions === null ? null : <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      {closable ? <SheetCloseButton label={closeLabel} onClick={onClose} /> : null}
    </div>
  );
}
