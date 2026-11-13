import { useRef } from "react";

import { CenterDialog } from "./CenterDialog.js";

import { useI18n } from "../i18n/index.js";

/**
 * Confirmation before anything is destroyed.
 *
 * Three decisions worth stating:
 *  * **The safe choice gets focus.** A stray Enter or an accidental double-tap
 *    must never delete something; the user has to move to the destructive
 *    button deliberately.
 *  * **The consequences are listed explicitly**, not implied by the word
 *    "delete". If data cannot be restored by the user, the dialog says so in
 *    those words.
 *  * Nothing is announced as recoverable unless it really is: archiving says
 *    it can be undone, deleting does not.
 *
 * 弹出面板模板 T3（1.19.58）：外壳与 `ChoiceDialog` 共用 `CenterDialog`——按钮区固定在底部、不随说明滚走，
 * 焦点统一走 `useDialogFocus`（不再另写 Tab 圈），遮罩为对话框档、没有背景模糊。`alertdialog` 语义、
 * “安全选项获得焦点”、Esc 与点遮罩等于取消，都与原来相同。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  consequences = [],
  confirmLabel,
  cancelLabel,
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  /** 1.17.23 起可省略：标题与后果列表已经说清楚时，不再补一句说明。 */
  readonly description?: string;
  readonly consequences?: readonly string[];
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: "danger" | "default";
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /**
   * ⚠️ **Optional fields between the consequences and the buttons** (added for S13's console).
   *
   * A sensitive operation needs a reason and a second password *inside* the dialog — putting
   * them on the page behind it would let the confirmation describe one action while the form
   * collected input for another. Optional, so every existing caller is unchanged.
   *
   * ⚠️ **They were declared here and never rendered until 1.13.02.** The three S13 dialogs
   * (作废邀请码 / 停用账户 / 恢复账户) all pass their reason and password fields as children,
   * and the dialog dropped them — the confirmation appeared with no way to enter either, so
   * the only possible outcome was the validation message "需要填写原因并输入你的密码".
   * A prop that callers rely on must be rendered; the type alone is not a feature.
   */
  readonly children?: React.ReactNode;
}): React.JSX.Element | null {
  const { t } = useI18n();
  /**
   * ⚠️ **Focus the safe choice once, when the dialog opens** — `CenterDialog` focuses it only on the
   * open edge, so typing into a child input (which re-renders the parent and changes `onCancel`)
   * never pulls focus back to 取消.
   */
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <CenterDialog
      open={open}
      role="alertdialog"
      title={title}
      description={description}
      onDismiss={onCancel}
      initialFocusRef={cancelRef}
      actions={
        <div className="flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-field bg-brand-soft px-4 py-3 text-button-lg font-medium text-brand-dark transition hover:bg-brand/20"
          >
            {cancelLabel ?? t("common.action.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`flex-1 rounded-field px-4 py-3 text-button-lg font-medium transition disabled:opacity-45 ${
              tone === "danger"
                ? "bg-danger text-on-danger hover:bg-danger-dark"
                : "bg-brand text-on-brand hover:bg-brand-dark"
            }`}
          >
            {busy ? t("common.status.processing") : (confirmLabel ?? t("common.action.confirm"))}
          </button>
        </div>
      }
    >
      {consequences.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1.5 rounded-field bg-canvas px-4 py-3 text-helper-relaxed text-muted">
          {consequences.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ⚠️ Rendered here, between what will happen and the buttons that do it. */}
      {children}
    </CenterDialog>
  );
}
