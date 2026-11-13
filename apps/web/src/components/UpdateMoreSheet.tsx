import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { BottomSheet, useSheetControls } from "./BottomSheet.js";
import { InfoIcon } from "./InfoHint.js";
import { ChevronIcon, CopyIcon } from "./Icons.js";
import { useI18n } from "../i18n/index.js";
import { copyText } from "../lib/clipboard.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { formatRuntimeReport, readRuntimeSnapshot } from "../lib/runtimeInfo.js";

type CopyPhase = "idle" | "copying" | "copied" | "manual" | "failed";

/**
 * The three-dot menu of the update screen.
 *
 * 弹出面板模板 T1（1.19.59）：与账本管理、账本选择同一个 `BottomSheet` 外壳——遮罩、拖动条与下拉关闭、
 * 模板标题行与右上角 ×、焦点与 Esc、滚动锁都由外壳负责；列表底部重复的「关闭」去掉。宽屏下仍一直贴底。
 * The two actions are deliberately ordinary user actions, not a developer console: copy the diagnostic
 * text, or open the separate runtime-information screen.
 */
export function UpdateMoreSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <BottomSheet
      label={t("update.more.label")}
      title={t("update.more.title")}
      wide="bottom"
      initialFocus={(panel) => panel.querySelector<HTMLButtonElement>("[data-sheet-close]")}
      onClose={onClose}
    >
      <UpdateMoreActions onClose={onClose} />
    </BottomSheet>
  );
}

function UpdateMoreActions({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sheet = useSheetControls();
  const { offline, reason } = useAccountOffline();
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const closeTimer = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  async function copyReport(): Promise<void> {
    setPhase("copying");
    setError(null);

    try {
      const snapshot = await readRuntimeSnapshot(queryClient, offline, reason);
      const outcome = await copyText(formatRuntimeReport(snapshot));

      if (outcome === "copied") {
        setPhase("copied");
        clearCloseTimer();
        // 复制成功后稍等再收起：走外壳的关闭（播放退场），与 × 相同。
        closeTimer.current = window.setTimeout(() => {
          if (sheet === null) onClose();
          else sheet.close();
        }, 1_500);
        return;
      }

      setPhase("manual");
    } catch {
      setPhase("failed");
      setError(t("update.more.failed"));
    }
  }

  function openRuntime(): void {
    const go = (): void => {
      onClose();
      void navigate("/update/runtime");
    };
    // 先播放退场再导航：协调器不把正在收起的面板当作“有弹窗”，转场照常播放。
    if (sheet === null) go();
    else sheet.closeThen(go);
  }

  return (
    <>
      {phase === "copied" ? (
        <p role="status" className="mx-5 mb-3 rounded-field bg-brand-soft px-4 py-3 text-body text-brand-dark">
          {t("update.more.copied")}
        </p>
      ) : null}

      {phase === "manual" ? (
        <p role="status" className="mx-5 mb-3 rounded-field bg-brand-soft px-4 py-3 text-body text-brand-dark">
          {t("update.more.manual")}
        </p>
      ) : null}

      {phase === "failed" && error !== null ? (
        <p role="alert" className="mx-5 mb-3 rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      <ul className="border-t border-line">
        <li>
          <button
            type="button"
            disabled={phase === "copying"}
            onClick={() => void copyReport()}
            className="flex min-h-14 w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition hover:bg-canvas disabled:opacity-45"
          >
            <span className="text-muted">
              <CopyIcon className="size-5" />
            </span>
            <span className="min-w-0 flex-1 text-body text-ink">
              {phase === "copying" ? t("update.more.copying") : t("update.more.copy")}
            </span>
            <ChevronIcon direction="right" className="size-4 text-muted/70" />
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={openRuntime}
            className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-canvas"
          >
            <span className="text-muted">
              <InfoIcon className="size-5" />
            </span>
            <span className="min-w-0 flex-1 text-body text-ink">{t("update.more.runtime")}</span>
            <ChevronIcon direction="right" className="size-4 text-muted/70" />
          </button>
        </li>
      </ul>
    </>
  );
}
