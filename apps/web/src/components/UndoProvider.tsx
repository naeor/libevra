import { useMemo } from "react";

import { useI18n } from "../i18n/index.js";
import { useToast } from "./toast/ToastProvider.js";

interface UndoRequest {
  readonly message: string;
  readonly onUndo: () => void | Promise<void>;
  /**
   * 提示消失后在哪里还能撤回（WCAG 2.2.1，见 `ToastAction.alternative`）。
   * 默认是删除账目的常设路径；将来有别的调用方时按实际写。
   */
  readonly alternative?: string;
}

interface UndoContextValue {
  /** Offer a short window to take something back. */
  showUndo(request: UndoRequest): void;
}

/** 删除账目后的撤销，常设替代路径：编辑历史 → 已删除账目详情 →「恢复」（`EntryDetailPage`）。 */
const ENTRY_RESTORE_PATH = "编辑历史 → 已删除账目详情 →「恢复」"; // i18n-ignore 开发者注记（ToastAction.alternative），不显示

/**
 * **`useUndo()`：统一提示条（1.19.66）上的薄适配。**
 *
 * 原来的 `UndoProvider` + `UndoBar` 是五套提示实现之一（墨色条、渲染在外壳之外、没有读屏播报、5 秒、
 * 连续删除两笔时计时不重置、撤销失败时静默）。现在撤销走 `useToast()`：
 *
 * - 跨页面保留（`scope: "app"`）：删除一笔后返回列表，撤销仍在——队列挂在 `App.tsx` 原来的位置；
 * - 信息类型 + 一个“撤销”操作，停留 10 秒，悬停 / 聚焦时暂停，有 ×，有读屏播报（“…，可撤销”）；
 * - 连续删除两笔：第二条替换第一条，计时从头开始；第一笔仍可从编辑历史恢复；
 * - 点“撤销”时提示先消失、再执行恢复（与原来一致）。恢复逻辑本身不变。
 *
 * 调用方（`EntryDetailPage`）不用改。
 */
export function useUndo(): UndoContextValue {
  const toast = useToast();
  const { t } = useI18n();

  return useMemo<UndoContextValue>(
    () => ({
      showUndo: ({ message, onUndo, alternative }) => {
        toast.show({
          tone: "info",
          text: message,
          scope: "app",
          action: {
            label: t("common.action.undo"),
            alternative: alternative ?? ENTRY_RESTORE_PATH,
            run: () => onUndo(),
          },
        });
      },
    }),
    [toast, t],
  );
}
