/**
 * 导入完成页的整屏外壳（S15-B）。
 *
 * 拆成单独组件的原因只有一个：**完成态不能再经过 `InnerPage`**。`InnerPage` 无条件
 * 渲染左上「返回」和（本页传入的）右上「重新识别」，而这两者在完成页都要消失。这里
 * 用一个最小的壳替代它：两条全局提示 + 内容，没有返回按钮。
 *
 * 浏览器后退/手势不受影响：这里没有重定向、没有 `replace`，也没有任何提交动作。
 *
 * 完成提示（1.19.66 起走统一提示条，原来是本页自己的顶部滑入 Toast）：
 *  - 进入完成页时把结果交给 `useToast()`（`importDoneToast`：页面作用域、回声），位置在底部按钮栏之上；
 *  - 离开完成页（卸载）时由页面作用域撤下；点三个入口时先撤下，再执行调用方给的导航 / 返回动作。
 */

import { useEffect, useRef } from "react";

import { OfflineStatus } from "../OfflineStatus.js";
import { SyncBanner } from "../SyncBanner.js";
import { useToast } from "../toast/ToastProvider.js";
import { ImportDoneView } from "./ImportDoneView.js";
import { importDoneToast } from "./ImportToast.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";
import type { OcrImportSession } from "../../lib/ocr/importSession.js";

export function ImportDoneScreen({
  outcome,
  session,
  onBackToDetail,
  onAgain,
  onRetry,
}: {
  readonly outcome: OcrImportOutcome;
  readonly session: OcrImportSession;
  readonly onBackToDetail: () => void;
  readonly onAgain: () => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const id = toast.show(importDoneToast(outcome));
    shown.current = id;
    return () => {
      toast.dismiss(id);
    };
  }, [outcome, toast]);

  /** Every exit takes the notice down first: it is feedback for the screen being left. */
  function leave(action: () => void): void {
    if (shown.current !== null) toast.dismiss(shown.current);
    action();
  }

  return (
    <>
      <SyncBanner />
      <OfflineStatus />

      <main className="mx-auto flex min-h-full w-full max-w-md flex-col">
        <ImportDoneView
          outcome={outcome}
          session={session}
          onBackToDetail={() => {
            leave(onBackToDetail);
          }}
          onAgain={() => {
            leave(onAgain);
          }}
          onRetry={() => {
            leave(onRetry);
          }}
        />
      </main>
    </>
  );
}
