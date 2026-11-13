import { useRef } from "react";

import { CenterDialog } from "./CenterDialog.js";

/**
 * A dialog that offers a small number of named ways forward.
 *
 * Separate from `ConfirmDialog` because that one asks a yes/no question, and
 * this one asks a "which of these" question. Forcing three choices into a
 * primary/cancel pair would mean inventing a default nobody asked for.
 *
 * **The owner's rule, and the reason this exists**: when recognition fails,
 * *do not decide for the user*. The first version of that fix sent them straight
 * to the manual form, which silently removed the two options they might have
 * preferred — trying again, or going back and choosing a different picture. What
 * a failure needs is the choices, not a decision made on the user's behalf.
 *
 * Three properties worth stating:
 *
 *  * **Every option is a button, stacked.** Side by side they would be narrow
 *    enough on a phone to mis-tap, and these options differ in what happens
 *    next — a mis-tap costs a screen, not a colour.
 *  * **Dismissal is one of the options**, not an extra affordance. A dialog with
 *    a close button *and* a "cancel" option presents the same choice twice and
 *    invites the question of whether they differ.
 *  * **Escape and the backdrop do the dismissing thing**, which is the option
 *    marked `dismissive` — so a keyboard or a stray tap behaves like the choice
 *    that means "leave this alone".
 */
export interface Choice<Id extends string> {
  readonly id: Id;
  readonly label: string;
  /** One line under the label, for the option whose consequence is not obvious. */
  readonly hint?: string;
  /** Rendered in the theme colour; at most one should be primary. */
  readonly primary?: boolean;
  /** What Escape and a backdrop tap do. Exactly one option should be dismissive. */
  readonly dismissive?: boolean;
}

export function ChoiceDialog<Id extends string>({
  open,
  title,
  description,
  choices,
  onChoose,
}: {
  readonly open: boolean;
  readonly title: string;
  /** 1.17.23 起可省略：选项本身已经说清楚时，不再补一句说明。 */
  readonly description?: string;
  readonly choices: readonly Choice<Id>[];
  readonly onChoose: (id: Id) => void;
}): React.JSX.Element | null {
  const firstRef = useRef<HTMLButtonElement>(null);
  const dismiss = choices.find((choice) => choice.dismissive === true);

  /**
   * 弹出面板模板 T3（1.19.58）：与 `ConfirmDialog` 共用 `CenterDialog`，选项固定在底部、不随说明滚走；
   * 焦点统一走 `useDialogFocus`。
   *
   * Focus the first option rather than the dismissive one: unlike a destructive confirmation,
   * nothing here can lose data, and the first option is the one most people want.
   */
  return (
    <CenterDialog
      open={open}
      role="dialog"
      title={title}
      description={description}
      onDismiss={dismiss === undefined ? undefined : () => { onChoose(dismiss.id); }}
      initialFocusRef={firstRef}
      actions={
        <div className="flex flex-col gap-2.5">
          {choices.map((choice, index) => (
            <button
              key={choice.id}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              onClick={() => {
                onChoose(choice.id);
              }}
              className={`w-full rounded-field px-4 py-3 text-left transition ${
                choice.primary === true
                  ? "bg-brand text-on-brand hover:bg-brand-dark"
                  : "bg-brand-soft text-brand-dark hover:bg-brand/20"
              }`}
            >
              <span className="block text-button-lg font-medium">{choice.label}</span>
              {choice.hint === undefined ? null : (
                <span
                  className={`mt-0.5 block text-xs ${
                    choice.primary === true ? "text-on-brand/80" : "text-brand-dark/75"
                  }`}
                >
                  {choice.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      }
    />
  );
}
