import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

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
 * It follows the existing bottom-sheet grammar (`BookManageSheet`, `BookSwitcherSheet`): the same
 * overlay, top radius, drag handle, 44px+ rows and close control. The two actions are deliberately
 * ordinary user actions, not a developer console: copy the diagnostic text, or open the separate
 * runtime-information screen.
 */
export function UpdateMoreSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { offline, reason } = useAccountOffline();
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    setPhase("idle");
    setError(null);
    closeButton.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearCloseTimer();
    };
  }, [open, onClose, clearCloseTimer]);

  if (!open) return null;

  async function copyReport(): Promise<void> {
    setPhase("copying");
    setError(null);

    try {
      const snapshot = await readRuntimeSnapshot(queryClient, offline, reason);
      const outcome = await copyText(formatRuntimeReport(snapshot));

      if (outcome === "copied") {
        setPhase("copied");
        clearCloseTimer();
        closeTimer.current = window.setTimeout(onClose, 1_500);
        return;
      }

      setPhase("manual");
    } catch {
      setPhase("failed");
      setError(t("update.more.failed"));
    }
  }

  function openRuntime(): void {
    onClose();
    void navigate("/update/runtime");
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-overlay-soft backdrop-in"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("update.more.label")}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-t-sheet border border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-sheet sheet-in"
      >
        <div className="flex justify-center pt-3 pb-1">
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" />
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pt-2 pb-3">
          <span className="text-base font-medium text-ink">{t("update.more.title")}</span>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label={t("update.more.close")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted outline-none transition hover:bg-canvas hover:text-ink focus-visible:ring-4 focus-visible:ring-focus-ring"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

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
              className="flex min-h-14 w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition hover:bg-canvas"
            >
              <span className="text-muted">
                <InfoIcon className="size-5" />
              </span>
              <span className="min-w-0 flex-1 text-body text-ink">{t("update.more.runtime")}</span>
              <ChevronIcon direction="right" className="size-4 text-muted/70" />
            </button>
          </li>
        </ul>

        <div className="px-5 py-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 w-full items-center rounded-field px-1 text-body text-muted transition hover:bg-canvas hover:text-ink"
          >
            {t("update.more.dismiss")}
          </button>
        </div>
      </div>
    </>
  );
}
