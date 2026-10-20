/**
 * 导入完成时的轻量 Toast（S15-B 完成页）。
 *
 * 仓库没有全局 Toast 系统，这里也不建一个：完成页是唯一需要“刚刚发生了什么”的地方，
 * 页面本身已经展示累计与批次卡片，Toast 只负责**即时反馈**，然后自己消失。
 *
 * 三条规矩：
 *  - **文案与真实写入状态一致**：写在本机队列的笔数必须说“在本机排队，联网后自动同步”，
 *    绝不写成服务器已保存；部分失败不使用全成功文案；全失败不出现“成功”字样。
 *  - **不挡操作**：外层 `pointer-events-none`，视觉上压在内容上方但不接收点击。
 *  - **可测试**：文案由纯函数 `importToastFor` 决定，显示/隐藏由纯 reducer 决定；3 秒
 *    定时器在 `ImportDoneScreen` 里，卸载时清理。
 */

import type { OcrImportOutcome } from "../../lib/ocr/import.js";

/** Toast 的语义色：成功、部分失败、全失败。 */
export type ImportToastTone = "success" | "warning" | "danger";

export interface ImportToastMessage {
  readonly tone: ImportToastTone;
  /** 一句话说清这次导入的结果。 */
  readonly title: string;
  /** 补充事实：失败仍可重试，或有多少笔在本机排队。 */
  readonly detail: string;
}

/** 约 3 秒后自动滑出；不需要用户确认。 */
export const IMPORT_TOAST_MS = 3000;

const TONES: Record<ImportToastTone, string> = {
  success: "bg-brand-soft text-brand-dark",
  warning: "bg-warn-soft text-warn-dark",
  danger: "bg-danger-soft text-danger",
};

const MARKS: Record<ImportToastTone, string> = {
  success: "fill-brand",
  warning: "fill-warn-dark",
  danger: "fill-danger",
};

const GLYPHS: Record<ImportToastTone, string> = {
  success: "M7 12.4 L10.4 15.8 L17 8.6",
  warning: "M12 6.6 V13.6 M12 17.2 V17.3",
  danger: "M8 8 L16 16 M16 8 L8 16",
};

/**
 * 从真实 outcome 得出的 Toast 文案。纯函数：不读存储、不碰计时器。
 *
 * 分支顺序就是优先级：先看有没有“一条都没开始写”的阻塞，再看全失败，再看部分失败，
 * 最后才是成功（成功里还要区分“已经写入账本”和“只在本机排队”）。
 */
export function importToastFor(outcome: OcrImportOutcome): ImportToastMessage {
  const succeeded = outcome.succeeded.length;
  const failed = outcome.failed.length;
  const pending = outcome.succeeded.filter((entry) => entry.pending).length;
  const delivered = succeeded - pending;

  if (outcome.blockers.length > 0) {
    return {
      tone: "danger",
      title: "没有导入任何账目",
      detail: `${String(outcome.blockers.length)} 笔还不能导入，请先核对或标记无效。`,
    };
  }

  if (succeeded === 0) {
    return {
      tone: "danger",
      title: "导入失败",
      detail:
        failed > 0
          ? `${String(failed)} 笔都没有写入，批次仍保留，可以重试。`
          : "这一批没有账目写入。",
    };
  }

  if (failed > 0) {
    return {
      tone: "warning",
      title: `导入完成：成功 ${String(succeeded)} 笔，失败 ${String(failed)} 笔`,
      detail:
        pending > 0
          ? `失败的 ${String(failed)} 笔仍留在批次里；${String(pending)} 笔在本机排队，联网后自动同步。`
          : `失败的 ${String(failed)} 笔仍留在批次里，可以重试。`,
    };
  }

  /*
   * 全部写在本机队列时不说“已成功导入”：那会被读成云端已保存。账确实记下了，但
   * 诚实说法是“在本机排队，联网后自动同步”。
   */
  if (pending > 0 && delivered === 0) {
    return {
      tone: "success",
      title: "账目已在本机排队",
      detail: `${String(pending)} 笔待联网后自动同步，不会丢。`,
    };
  }

  if (pending > 0) {
    return {
      tone: "success",
      title: "账目已成功导入",
      detail: `${String(delivered)} 笔已写入账本，${String(pending)} 笔在本机排队、联网后自动同步。`,
    };
  }

  return {
    tone: "success",
    title: "账目已成功导入",
    detail: `本批 ${String(succeeded)} 笔已写入账本。`,
  };
}

export interface ImportToastState {
  readonly message: ImportToastMessage | null;
  /** false 时滑出屏幕外；内容仍保留，CSS 过渡才有“滑走”可看。 */
  readonly visible: boolean;
}

export const INITIAL_IMPORT_TOAST: ImportToastState = { message: null, visible: false };

export type ImportToastEvent =
  | { readonly type: "show"; readonly message: ImportToastMessage }
  | { readonly type: "hide" };

/**
 * 显示/隐藏的唯一入口：定时器到点、点「返回明细」、点「再识别一批」都只是发 `hide`。
 *
 * 已经隐藏时再 `hide` 返回同一个引用，避免一次无意义的重渲染。
 */
export function importToastReducer(
  state: ImportToastState,
  event: ImportToastEvent,
): ImportToastState {
  if (event.type === "show") return { message: event.message, visible: true };
  return state.visible ? { ...state, visible: false } : state;
}

/**
 * 顶部滑入的反馈条。
 *
 * 容器**始终渲染**（`message` 为空时不显示内容）：入场过渡需要一帧“在屏幕外”的
 * 起始状态，否则元素第一次出现就是终态，CSS transition 不会触发。
 */
export function ImportToast({
  message,
  visible,
}: {
  readonly message: ImportToastMessage | null;
  readonly visible: boolean;
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      data-visible={visible ? "true" : "false"}
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto w-full max-w-md px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] transition-transform duration-300 ease-out motion-reduce:transition-none ${
        visible ? "translate-y-0" : "-translate-y-[150%]"
      }`}
    >
      {message === null ? null : (
        <div
          className={`flex items-start gap-2.5 rounded-field px-4 py-3 shadow-card ${TONES[message.tone]}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 shrink-0">
            <circle cx="12" cy="12" r="11" className={MARKS[message.tone]} />
            <path
              d={GLYPHS[message.tone]}
              fill="none"
              stroke="white"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="min-w-0">
            <p className="text-body font-medium">{message.title}</p>
            <p className="mt-0.5 text-helper-relaxed">{message.detail}</p>
          </div>
        </div>
      )}
    </div>
  );
}
