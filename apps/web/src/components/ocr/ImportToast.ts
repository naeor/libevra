/**
 * 拍照导入完成提示的**文案规则**（S15-B 完成页）。
 *
 * 1.19.66 起提示本身走统一提示条（`components/toast/`）：原来这里自己写的顶部滑入视图、显示 / 隐藏 reducer 与
 * 3 秒计时都删掉了（五套提示实现之一）。完成页本身已经常驻展示累计与批次卡片，提示只是**回声**（`echo`）：
 * 全部失败也只用 polite 播报、按错误回声 8 秒消失；位置从顶部移到底部按钮栏之上（所有者决定第 16 条）。
 *
 * 文案规矩不变：
 *  - **文案与真实写入状态一致**：写在本机队列的笔数必须说“在本机排队，联网后自动同步”，
 *    绝不写成服务器已保存；部分失败不使用全成功文案；全失败不出现“成功”字样。
 *  - **可测试**：文案由纯函数 `importToastFor` 决定；交给提示条的选项由 `importDoneToast` 决定。
 */

import { t } from "../../i18n/index.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";
import type { ToastOptions, ToastTone } from "../../lib/toast/types.js";

/** 提示的语义：成功、部分失败、全失败。 */
export type ImportToastTone = "success" | "warning" | "danger";

export interface ImportToastMessage {
  readonly tone: ImportToastTone;
  /** 一句话说清这次导入的结果。 */
  readonly title: string;
  /** 补充事实：失败仍可重试，或有多少笔在本机排队。 */
  readonly detail: string;
}

const TONE: Record<ImportToastTone, ToastTone> = { success: "success", warning: "warning", danger: "error" };

/**
 * 从真实 outcome 得出的 Toast 文案。纯函数：不读存储、不碰计时器。
 *
 * 分支顺序就是优先级：先看有没有“一条都没开始写”的阻塞，再看全失败，再看部分失败，
 * 最后才是成功（成功里还要区分“已经写入账本”和“只在本机排队”）。
 *
 * 文案按调用时的界面语言生成；提示只显示几秒，不随之后的语言切换重算。
 */
export function importToastFor(outcome: OcrImportOutcome): ImportToastMessage {
  const succeeded = outcome.succeeded.length;
  const failed = outcome.failed.length;
  const pending = outcome.succeeded.filter((entry) => entry.pending).length;
  const delivered = succeeded - pending;

  if (outcome.blockers.length > 0) {
    return {
      tone: "danger",
      title: t("ocr.toast.blockedTitle"),
      detail: t("ocr.toast.blockedDetail", { count: outcome.blockers.length }),
    };
  }

  if (succeeded === 0) {
    return {
      tone: "danger",
      title: t("ocr.toast.failedTitle"),
      detail:
        failed > 0
          ? t("ocr.toast.failedDetail", { count: failed })
          : t("ocr.toast.failedEmpty"),
    };
  }

  if (failed > 0) {
    return {
      tone: "warning",
      title: t("ocr.toast.partialTitle", { succeeded, failed }),
      detail:
        pending > 0
          ? t("ocr.toast.partialPending", { failed, pending })
          : t("ocr.toast.partialDetail", { failed }),
    };
  }

  /*
   * 全部写在本机队列时不说“已成功导入”：那会被读成云端已保存。账确实记下了，但
   * 诚实说法是“在本机排队，联网后自动同步”。
   */
  if (pending > 0 && delivered === 0) {
    return {
      tone: "success",
      title: t("ocr.toast.queuedTitle"),
      detail: t("ocr.toast.queuedDetail", { count: pending }),
    };
  }

  if (pending > 0) {
    return {
      tone: "success",
      title: t("ocr.toast.importedTitle"),
      detail: t("ocr.toast.mixedDetail", { delivered, pending }),
    };
  }

  return {
    tone: "success",
    title: t("ocr.toast.importedTitle"),
    detail: t("ocr.toast.importedDetail", { count: succeeded }),
  };
}

/**
 * 交给统一提示条的选项：页面作用域（离开完成页即撤下）、回声（页面已常驻显示结果）。
 */
export function importDoneToast(outcome: OcrImportOutcome): ToastOptions<never> {
  const message = importToastFor(outcome);
  return { tone: TONE[message.tone], text: message.title, detail: message.detail, scope: "page", echo: true };
}
