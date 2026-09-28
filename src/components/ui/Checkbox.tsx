import { Check } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Optional trailing text; clicking it toggles the checkbox too. */
  children?: ReactNode;
}

/**
 * Custom styled checkbox replacing the native one (native renders dated and
 * inconsistently across platforms). Keeps the real <input> visually hidden
 * for keyboard focus, form semantics and screen readers.
 */
export function Checkbox({ className = "", style, children, ...props }: CheckboxProps) {
  const disabled = "disabled" in props && props.disabled;
  return (
    <label
      className={`group relative inline-flex shrink-0 items-center justify-center gap-1.5 align-middle ${
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
      } ${className}`}
      style={style}
    >
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        className={`relative w-4 h-4 rounded-[5px] border border-border bg-background flex items-center justify-center transition-colors duration-150
          ${disabled ? "" : "group-hover:border-primary/50"}
          peer-checked:bg-primary peer-checked:border-primary
          peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 peer-focus-visible:border-primary`}
      >
        <Check
          size={11}
          strokeWidth={3.5}
          className="absolute inset-0 m-auto text-primary-foreground scale-0 opacity-0 transition-all duration-150 group-has-[:checked]:scale-100 group-has-[:checked]:opacity-100"
        />
      </span>
      {children && <span className="select-none">{children}</span>}
    </label>
  );
}
