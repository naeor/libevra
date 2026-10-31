/**
 * 两个工作区之间与边缘上的控件：分界线（拖动、收起预览）、跟随／独立胶囊、单区时的「打开 / 恢复辅助
 * 工作区」入口、「在指定工作区打开」拖动时的预览、简短提示。（辅助区的导航在它内部右下角，见
 * `SecondaryNav.tsx`；第二轮移除了辅助区右侧的常驻功能区。）
 *
 * ⚠️ **拖动的每一帧不经过 React。** 指针移动只改外壳元素上的 CSS 变量（`--lv-drag-a`）与
 * `data-collapse`，预览帧、拖动线与侧栏里的分割线都读同一个变量，所以它们不会彼此错位，也不会让两个
 * 工作区里的复杂图表每一帧重排；松手后才把新比例交给状态，工作区重排一次。
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useI18n } from "../i18n/index.js";
import { usePaneIdentity, pageKeyFor, START_PATH } from "./paneTitle.js";
import {
  GUTTER,
  SPLIT_MARGIN,
  dragState,
  keyboardRatio,
  layoutPanes,
  ratioLimits,
  splitAvailable,
  type CollapseSide,
  type Orientation,
  type Rect,
} from "./geometry.js";
import type { FollowMode } from "./model.js";
import { navDrag } from "./navDrag.js";
import { SplitIcon } from "./icons.js";
import { DestinationIcon } from "./SecondaryNav.js";

export interface ResizeController {
  readonly cancel: () => void;
}

const COLLAPSE_MS = 280;
const SNAP_MS = 200;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------
// 分界线
// ---------------------------------------------------------------------------

export function Divider({
  rect,
  orientation,
  ratio,
  area,
  shellRef,
  controller,
  primaryPath,
  secondaryPath,
  primaryLedger,
  secondaryLedger,
  onCommit,
  onCollapse,
  onPromoted,
}: {
  readonly rect: Rect;
  readonly orientation: Orientation;
  readonly ratio: number;
  readonly area: { readonly w: number; readonly h: number };
  readonly shellRef: React.RefObject<HTMLDivElement | null>;
  readonly controller: React.RefObject<ResizeController | null>;
  readonly primaryPath: string;
  readonly secondaryPath: string;
  /** 两侧各自选的账本（`null` = 设备当前账本）：预览上的账本名按各自的来。 */
  readonly primaryLedger: string | null;
  readonly secondaryLedger: string | null;
  readonly onCommit: (ratio: number) => void;
  readonly onCollapse: (side: "primary" | "secondary") => void;
  readonly onPromoted: (title: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState<CollapseSide>(null);
  const session = useRef<{
    pointerId: number;
    start: number;
    collapse: CollapseSide;
    display: number;
    finishing: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const available = splitAvailable(area, orientation);
  const limits = ratioLimits(available, orientation);
  const secondaryIdentity = usePaneIdentity(secondaryPath, secondaryLedger);

  const setVar = useCallback(
    (share: number) => {
      shellRef.current?.style.setProperty("--lv-drag-a", `${String(Math.round(share * available))}px`);
    },
    [available, shellRef],
  );

  const end = useCallback(() => {
    const shell = shellRef.current;
    if (session.current?.timer != null) clearTimeout(session.current.timer);
    session.current = null;
    if (shell !== null) {
      shell.removeAttribute("data-resizing");
      shell.removeAttribute("data-collapse");
      shell.removeAttribute("data-settle");
      shell.style.removeProperty("--lv-drag-a");
    }
    setDragging(false);
    setArmed(null);
  }, [shellRef]);

  const finish = useCallback(
    (commit: boolean) => {
      const current = session.current;
      const shell = shellRef.current;
      if (current === null || current.finishing || shell === null) return;
      current.finishing = true;
      const quick = reducedMotion();

      if (commit && current.collapse !== null) {
        const side = current.collapse;
        shell.setAttribute("data-settle", `collapse-${side}`);
        current.timer = setTimeout(() => {
          onCollapse(side);
          if (side === "primary") onPromoted(secondaryIdentity.title);
          end();
        }, quick ? 0 : COLLAPSE_MS);
        return;
      }

      const target = commit ? Math.min(limits.max, Math.max(limits.min, current.display)) : current.start;
      shell.setAttribute("data-settle", "snap");
      shell.removeAttribute("data-collapse");
      setVar(target);
      current.timer = setTimeout(() => {
        if (commit) onCommit(target);
        end();
      }, quick ? 0 : SNAP_MS);
    },
    [end, limits.max, limits.min, onCollapse, onCommit, onPromoted, secondaryIdentity.title, setVar, shellRef],
  );

  useEffect(() => {
    controller.current = {
      cancel: () => {
        finish(false);
      },
    };
    return () => {
      controller.current = null;
    };
  }, [controller, finish]);

  // 拖动中：Esc 取消、窗口失焦 / 尺寸变化取消，避免停在模糊预览里。
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(false);
    };
    const onBlur = (): void => {
      finish(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [dragging, finish]);

  useEffect(() => () => {
    if (session.current?.timer != null) clearTimeout(session.current.timer);
  }, []);

  const position = (event: React.PointerEvent): number => {
    const areaElement = handleRef.current?.parentElement;
    if (areaElement === null || areaElement === undefined) return ratio;
    const box = areaElement.getBoundingClientRect();
    const offset = orientation === "landscape" ? event.clientX - box.left : event.clientY - box.top;
    return (offset - SPLIT_MARGIN - GUTTER / 2) / available;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || session.current !== null) return;
    if (!event.isPrimary) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 拿不到指针捕获时，拖动仍跟随落在分界线上的移动事件。
    }
    const shell = shellRef.current;
    if (shell === null) return;
    session.current = { pointerId: event.pointerId, start: ratio, collapse: null, display: ratio, finishing: false, timer: null };
    setVar(ratio);
    shell.setAttribute("data-resizing", "true");
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = session.current;
    if (current === null || current.finishing || event.pointerId !== current.pointerId) return;
    const next = dragState(position(event), limits, current.collapse);
    current.display = next.display;
    setVar(next.display);
    if (next.collapse !== current.collapse) {
      current.collapse = next.collapse;
      const shell = shellRef.current;
      if (next.collapse === null) shell?.removeAttribute("data-collapse");
      else shell?.setAttribute("data-collapse", next.collapse);
      setArmed(next.collapse);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = session.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    finish(true);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = session.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    finish(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const next = keyboardRatio(ratio, event.key, limits);
    if (next === null) return;
    event.preventDefault();
    onCommit(next);
  };

  return (
    <>
      <div
        ref={handleRef}
        role="separator"
        tabIndex={0}
        aria-orientation={orientation === "landscape" ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(limits.min * 100)}
        aria-valuemax={Math.round(limits.max * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label={t("workspace.divider.label")}
        aria-describedby={hintId}
        title={t("workspace.divider.hint")}
        className="lv-divider"
        data-orientation={orientation}
        data-dragging={dragging ? "true" : undefined}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={(event) => {
          if (session.current !== null && event.pointerId === session.current.pointerId && !session.current.finishing) finish(true);
        }}
        onKeyDown={onKeyDown}
      >
        <span className="lv-divider-handle" aria-hidden="true" />
      </div>
      <span id={hintId} className="sr-only">
        {t("workspace.divider.hint")}
      </span>
      <span className="sr-only" aria-live="assertive">
        {armed === null ? "" : t("workspace.divider.release")}
      </span>
      {dragging ? (
        <ResizeFrames orientation={orientation} primaryPath={primaryPath} secondaryPath={secondaryPath} primaryLedger={primaryLedger} secondaryLedger={secondaryLedger} />
      ) : null}
    </>
  );
}

/**
 * 调整状态（第二轮）：**两个工作区的真实内容**留在原处、轻度模糊，并按新的分界位置裁切（`clip-path`
 * 读同一个 `--lv-drag-a`，见 workspace.css）；这里只画两样东西——
 * - 内容下面的两个浅色圆角底（某一侧变大时，新增的那一块露出的是底色，而不是空洞）；
 * - 内容上面的身份标签「主工作区 · 明细」，越界时换成「释放以收起此工作区」/「将占据全部空间」。
 * 不再用骨架图与白色遮罩代替内容。
 */
function ResizeFrames({
  orientation,
  primaryPath,
  secondaryPath,
  primaryLedger,
  secondaryLedger,
}: {
  readonly orientation: Orientation;
  readonly primaryPath: string;
  readonly secondaryPath: string;
  readonly primaryLedger: string | null;
  readonly secondaryLedger: string | null;
}): React.JSX.Element {
  return (
    <>
      <div className="lv-frames" data-orientation={orientation} aria-hidden="true">
        <div className="lv-frame" data-side="primary" />
        <div className="lv-frame" data-side="secondary" />
      </div>
      <div className="lv-frames lv-frame-tags" data-orientation={orientation} aria-hidden="true">
        <FrameTag side="primary" path={primaryPath} ledger={primaryLedger} />
        <span className="lv-drag-line" />
        <FrameTag side="secondary" path={secondaryPath} ledger={secondaryLedger} />
      </div>
    </>
  );
}

function FrameTag({ side, path, ledger }: { readonly side: "primary" | "secondary"; readonly path: string; readonly ledger: string | null }): React.JSX.Element {
  const { t } = useI18n();
  const identity = usePaneIdentity(path, ledger);
  const key = pageKeyFor(path);
  const pane = side === "primary" ? t("workspace.pane.primary") : t("workspace.pane.secondary");
  return (
    <div className="lv-frame-slot" data-side={side}>
      <span className="lv-tag">
        <DestinationIcon page={key} className="size-[18px]" />
        <span className="lv-tag-text">{t("workspace.pane.label", { pane, page: identity.title })}</span>
        <span className="lv-frame-release">{t("workspace.divider.release")}</span>
        <span className="lv-frame-expand">{t("workspace.divider.expand")}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 跟随／独立胶囊
// ---------------------------------------------------------------------------

/** 胶囊离分界线端点的距离（横屏：离区域顶边；竖屏：离区域右边，指胶囊中心）。 */
const CAPSULE_TOP = 12;
const CAPSULE_END = 26;

/**
 * **跟随／独立胶囊（第二轮）**：嵌在分界线上的一小段，像是分界线本身的一部分。
 *
 * - 横屏：竖向分界线的顶端，横向胶囊；竖屏：横向分界线的右端，**竖向**胶囊（高大于宽）。
 * - 胶囊外圈一圈区域底色，在两侧工作区的边缘上「挖」出一个浅浅的圆角凹口；本身低对比、几乎无阴影。
 * - 图标是**空心**矩形：跟随 = 一个完整的矩形；独立 = 分开的两块（横屏左右、竖屏上下），两种状态之间
 *   是同一组元素的连续分开 / 合拢，而不是换图。
 */
export function ModeCapsule({
  mode,
  orientation,
  divider,
  area,
  onChange,
}: {
  readonly mode: FollowMode;
  readonly orientation: Orientation;
  readonly divider: Rect;
  readonly area: { readonly w: number; readonly h: number };
  readonly onChange: (mode: FollowMode) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const follow = mode === "follow";
  const style: React.CSSProperties =
    orientation === "landscape"
      ? { left: divider.x + GUTTER / 2, top: SPLIT_MARGIN + CAPSULE_TOP }
      : { left: area.w - SPLIT_MARGIN - CAPSULE_END, top: divider.y + GUTTER / 2 };
  return (
    <button
      type="button"
      className="lv-mode"
      data-mode={mode}
      data-orientation={orientation}
      style={style}
      aria-pressed={follow}
      aria-label={follow ? t("workspace.mode.buttonFollow") : t("workspace.mode.buttonIndependent")}
      title={follow ? t("workspace.mode.follow") : t("workspace.mode.independent")}
      onClick={() => {
        onChange(follow ? "independent" : "follow");
      }}
    >
      <span className="lv-mode-glyph" aria-hidden="true">
        <span className="lv-mode-half" data-side="a" />
        <span className="lv-mode-half" data-side="b" />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 单区时的「打开 / 恢复辅助工作区」
// ---------------------------------------------------------------------------

const OPEN_HINT_KEY = "libevra.workspace.hint.open";
const SPLIT_HINT_KEY = "libevra.workspace.hint.split";

function useOnceHint(key: string): readonly [boolean, () => void] {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(key) === null) {
        const timer = setTimeout(() => {
          setShow(true);
        }, 900);
        return () => {
          clearTimeout(timer);
        };
      }
    } catch {
      // 读不到本机偏好：不打扰。
    }
    return undefined;
  }, [key]);
  const dismiss = useCallback(() => {
    setShow(false);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // 忽略：下次仍可能再提示一次。
    }
  }, [key]);
  return [show, dismiss] as const;
}

export function RestoreTab({
  orientation,
  retainedPath,
  retainedLedger,
  onRestore,
}: {
  readonly orientation: Orientation;
  readonly retainedPath: string | null;
  readonly retainedLedger: string | null;
  readonly onRestore: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const identity = usePaneIdentity(retainedPath ?? START_PATH, retainedLedger);
  const [hint, dismissHint] = useOnceHint(OPEN_HINT_KEY);
  const label =
    retainedPath === null || retainedPath === START_PATH
      ? t("workspace.secondary.open")
      : t("workspace.secondary.restore", { title: identity.title });
  return (
    <>
      <button
        type="button"
        className="lv-restore"
        data-orientation={orientation}
        aria-label={label}
        title={label}
        onClick={() => {
          dismissHint();
          onRestore();
        }}
      >
        <SplitIcon vertical={orientation === "portrait"} className="size-5" />
      </button>
      {hint ? (
        <div className="lv-hint" data-at="restore" data-orientation={orientation} role="note">
          <p>{t("workspace.hint.open")}</p>
          <button type="button" onClick={dismissHint}>
            {t("workspace.hint.dismiss")}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function SplitHint({ orientation, divider }: { readonly orientation: Orientation; readonly divider: Rect }): React.JSX.Element | null {
  const { t } = useI18n();
  const [hint, dismissHint] = useOnceHint(SPLIT_HINT_KEY);
  if (!hint) return null;
  const style: React.CSSProperties =
    orientation === "landscape"
      ? { left: divider.x + GUTTER / 2, top: SPLIT_MARGIN + CAPSULE_TOP + 44 }
      : { right: SPLIT_MARGIN + CAPSULE_END * 2 + 12, top: divider.y + GUTTER / 2 };
  return (
    <div className="lv-hint" data-at="split" data-orientation={orientation} style={style} role="note">
      <p>{t("workspace.hint.split")}</p>
      <button type="button" onClick={dismissHint}>
        {t("workspace.hint.dismiss")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 「在指定工作区打开」：跟手的预览卡片，与单区时的「新建辅助工作区」预留位
// ---------------------------------------------------------------------------

/** 单区时拖到这里会新建辅助工作区：与真正打开后的辅助区同一块位置（按上次的比例）。 */
export function createSlotFor(area: { readonly w: number; readonly h: number }, orientation: Orientation, ratio: number): Rect | null {
  return layoutPanes(area, orientation, true, ratio).secondary;
}

export function DropPreview({
  orientation,
  area,
  ratio,
  splitVisible,
  canSplit,
}: {
  readonly orientation: Orientation;
  readonly area: { readonly w: number; readonly h: number };
  readonly ratio: number;
  readonly splitVisible: boolean;
  readonly canSplit: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const drag = useSyncExternalStore(navDrag.subscribe, navDrag.get, navDrag.get);
  if (!drag.active || drag.payload === null) return null;

  const slot = !splitVisible && canSplit ? createSlotFor(area, orientation, ratio) : null;
  const createLabel = orientation === "landscape" ? t("workspace.drop.right") : t("workspace.drop.below");
  const hint =
    drag.target === "primary"
      ? t("workspace.drop.inPrimary")
      : drag.target === "secondary"
        ? t("workspace.drop.inSecondary")
        : drag.target === "create"
          ? createLabel
          : drag.target === "cancel"
            ? t("workspace.drop.releaseCancel")
            : null;

  return (
    <>
      {slot !== null ? (
        <div
          className="lv-drop-slot"
          data-over={drag.target === "create" ? "true" : "false"}
          style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}
          aria-hidden="true"
        >
          <span className="lv-tag" data-target={drag.target === "create" ? "true" : undefined}>
            <SplitIcon vertical={orientation === "portrait"} className="size-[18px]" />
            <span className="lv-tag-text">{createLabel}</span>
          </span>
        </div>
      ) : null}
      {/* 固定锚点紧跟指针；不因顶部或取消区切换到手指另一侧。 */}
      <div
        className="lv-drag-ghost"
        data-target={drag.target ?? "none"}
        style={{ left: drag.x, top: drag.y }}
        aria-hidden="true"
      >
        <span className="lv-drag-ghost-icon">
          <DestinationIcon page={pageKeyFor(drag.payload.path.split("?")[0] ?? "/")} className="size-5" />
        </span>
        <span className="lv-drag-ghost-text">
          <span className="lv-drag-ghost-title">{drag.payload.title}</span>
          <span className="lv-drag-ghost-hint" style={{ visibility: hint === null ? "hidden" : undefined }}>{hint ?? "\u00a0"}</span>
        </span>
      </div>
      <span className="sr-only" aria-live="polite">
        {hint === null ? "" : `${hint} · ${drag.payload.title}`}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// 简短提示
// ---------------------------------------------------------------------------

export function ShellToast({ toast }: { readonly toast: { readonly id: number; readonly text: string } | null }): React.JSX.Element {
  const [shown, setShown] = useState<{ readonly id: number; readonly text: string } | null>(null);
  useLayoutEffect(() => {
    if (toast === null) return;
    setShown(toast);
    const timer = setTimeout(() => {
      setShown((current) => (current?.id === toast.id ? null : current));
    }, 2600);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);
  return (
    <div className="lv-toast-region" aria-live="polite" role="status">
      {shown === null ? null : (
        <p key={shown.id} className="lv-toast">
          {shown.text}
        </p>
      )}
    </div>
  );
}
