import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * **从底部升起的半屏面板 —— 一个负责「进 / 出」两层动画的外壳**（m06693）。
 *
 * 所有者对引用面板的要求很具体：*「像这样从下面弹出来的半屏弹窗，我希望他们都能够做到有从下往上展开，
 * 以及从上往下收回的入场和消失画面」*。所以进出动画不写在每个面板里，而是收在这里一份：
 *
 *  * **入场**用 `sheet-in`（260ms 出弦缓动），从屏幕下缘升上来；
 *  * **退场**用 `sheet-out`（200ms 加速），先播放完再真正调用 `onClose` 卸载，**不会在动画半路消失**；
 *  * 遮罩同进同出（`backdrop-in` / `backdrop-out`），点击遮罩或 Escape 都走同一条关闭路径。
 *
 * ⚠️ **动画时长与 CSS 是两份真相**：`SHEET_EXIT_MS` 必须与 `index.css` 里 `libellum-sheet-out` 的
 * 200ms 保持一致。改一处要改两处——多等 30ms 只是慢，少等则是「关到一半被拔掉」。
 *
 * ⚠️ **减少动态（`prefers-reduced-motion`）时整段动画由 CSS 关掉**（`index.css` 的媒体查询），
 * 但关闭仍然照常经过这里——`onClose` 的时机不受影响，只是没有位移可见。
 */
const SHEET_EXIT_MS = 200;

export function BottomSheet({
  label,
  onClose,
  dialogClassName = "",
  children,
}: {
  /** 无障碍名称：`role="dialog"` 没有可见标题时也必须有名字。 */
  readonly label: string;
  readonly onClose: () => void;
  /** 面板自己的高度/圆角等；动画与结构不在这里改。 */
  readonly dialogClassName?: string;
  /**
   * 面板内容。传函数时拿到 `close`（走同一段退场动画再卸载）；面板里的 × 按钮应当用它，
   * **不要直接调用 `onClose`**，否则面板会在动画开始的那一帧被拔掉。
   */
  readonly children: ReactNode | ((close: () => void) => ReactNode);
}): React.JSX.Element {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    if (closing) return;

    setClosing(true);
    timer.current = setTimeout(onClose, SHEET_EXIT_MS);
  }, [closing, onClose]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") requestClose();
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [requestClose]);

  return (
    <div
      role="presentation"
      onClick={requestClose}
      className={`fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center ${
        closing ? "backdrop-out" : "backdrop-in"
      }`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className={`flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-sheet bg-surface shadow-sheet ${
          closing ? "sheet-out" : "sheet-in"
        } sm:max-h-[80dvh] sm:rounded-card ${dialogClassName}`}
      >
        {typeof children === "function" ? children(requestClose) : children}
      </div>
    </div>
  );
}
