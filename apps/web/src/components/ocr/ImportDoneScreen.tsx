/**
 * 导入完成页的整屏外壳（S15-B）。
 *
 * 拆成单独组件的原因只有一个：**完成态不能再经过 `InnerPage`**。`InnerPage` 无条件
 * 渲染左上「返回」和（本页传入的）右上「重新识别」，而这两者在完成页都要消失。这里
 * 用一个最小的壳替代它：两条全局提示 + 内容 + Toast，没有返回按钮。
 *
 * 浏览器后退/手势不受影响：这里没有重定向、没有 `replace`，也没有任何提交动作。
 *
 * Toast 的生命周期放在这里：
 *  - 首帧先以“屏幕外”渲染，下一帧再显示，CSS transition 才有滑入可看；
 *  - `IMPORT_TOAST_MS` 后自动隐藏，卸载/隐藏时清理定时器；
 *  - 点两个入口时先隐藏，再执行调用方给的导航/返回动作。
 */

import { useEffect, useReducer } from "react";

import { OfflineStatus } from "../OfflineStatus.js";
import { SyncBanner } from "../SyncBanner.js";
import { ImportDoneView } from "./ImportDoneView.js";
import {
  IMPORT_TOAST_MS,
  ImportToast,
  importToastFor,
  importToastReducer,
  type ImportToastState,
} from "./ImportToast.js";
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
  const [toast, dispatchToast] = useReducer(importToastReducer, {
    message: importToastFor(outcome),
    visible: false,
  } satisfies ImportToastState);

  // One frame hidden, then shown: a transition needs a rendered "before" state.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      dispatchToast({ type: "show", message: importToastFor(outcome) });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [outcome]);

  useEffect(() => {
    if (!toast.visible) return undefined;

    const timer = setTimeout(() => {
      dispatchToast({ type: "hide" });
    }, IMPORT_TOAST_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [toast.visible, toast.message]);

  /** Every exit hides the toast first: it is feedback for the screen being left. */
  function leave(action: () => void): void {
    dispatchToast({ type: "hide" });
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

      <ImportToast message={toast.message} visible={toast.visible} />
    </>
  );
}
