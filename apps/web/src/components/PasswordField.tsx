import { useId, useState, type InputHTMLAttributes } from "react";

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  readonly label: string;
  readonly hint?: string;
  /** Inline problem with this field (e.g. the two passwords do not match). */
  readonly error?: string;
}

/**
 * A password input with an explicit show/hide control.
 *
 * ⚠️ **The control is a real button, not an eye icon with a click handler.** It is reachable by
 * keyboard, announces its state (`aria-pressed`) and says what it will do next (`aria-label`), which
 * is what makes "show the characters I just typed" usable for the people who need it most — on a
 * phone keyboard, hiding the last character is how a typo becomes a failed sign-in.
 *
 * The input keeps the same classes as `TextField` on purpose: two fields that sit beside each other
 * in one form should not be two different-looking controls.
 */
export function PasswordField({
  label,
  hint,
  error,
  className = "",
  ...props
}: PasswordFieldProps): React.JSX.Element {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    error === undefined && hint === undefined
      ? undefined
      : [error === undefined ? null : errorId, hint === undefined ? null : hintId]
          .filter((value): value is string => value !== null)
          .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          {...props}
          type={visible ? "text" : "password"}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          className={`w-full rounded-field border bg-surface py-3 pr-12 pl-3.5 text-base text-ink transition outline-none placeholder:text-muted/80 focus:ring-4 focus:ring-focus-ring ${
            error === undefined ? "border-line focus:border-brand" : "border-danger focus:border-danger"
          } ${className}`}
        />
        <button
          type="button"
          onClick={() => {
            setVisible((current) => !current);
          }}
          aria-label={visible ? "隐藏密码" : "显示密码"}
          aria-pressed={visible}
          className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-muted transition hover:text-ink focus-visible:ring-4 focus-visible:ring-focus-ring focus-visible:outline-none"
        >
          <EyeIcon hidden={visible} />
        </button>
      </div>
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-helper-relaxed text-danger">
          {error}
        </p>
      )}
      {hint === undefined ? null : (
        <p id={hintId} className="text-helper-relaxed text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A stroke eye, not a filled one: at 16–20px a filled glyph blurs into a blob, while two thin
 * curves stay readable (the lesson the small gear icon already taught in 1.10.09).
 */
function EyeIcon({ hidden }: { readonly hidden: boolean }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
      {hidden ? <path d="M4 20 20 4" /> : null}
    </svg>
  );
}
