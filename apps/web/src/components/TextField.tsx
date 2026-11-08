import { useId, type InputHTMLAttributes } from "react";
import { materialAttributes } from "../s19/material.js";
import "../s19/material-components.css";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly label: string;
  readonly hint?: string;
  /** 显式字段错误；不传时保持原来的外观和 aria-invalid 行为。 */
  readonly error?: string;
}

export function TextField({
  label,
  hint,
  error,
  className = "",
  ...props
}: TextFieldProps): React.JSX.Element {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-card-title text-ink">
        {label}
      </label>
      <input
        id={id}
        {...props}
        {...materialAttributes("field")}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={[props["aria-describedby"], hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
        className={`lv-material w-full rounded-field border ${error ? "border-danger focus:border-danger" : "border-line focus:border-brand"} bg-surface px-3.5 py-3 text-base text-ink transition outline-none placeholder:text-muted/80 focus:ring-4 focus:ring-focus-ring disabled:opacity-45 ${className}`}
      />
      {hint ? <p id={`${id}-hint`} className="text-helper-relaxed text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-helper-relaxed text-danger">{error}</p> : null}
    </div>
  );
}
