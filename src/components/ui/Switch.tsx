import type { InputHTMLAttributes, ReactNode } from "react";

interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Optional trailing label; clicking it toggles the switch too. */
  children?: ReactNode;
}

/**
 * Custom styled toggle switch (no component library — same approach as
 * Checkbox). Keeps the real <input> visually hidden for keyboard focus,
 * form semantics and screen readers. The track is a direct sibling of the
 * peer input; the knob sits nested inside, so it flips via group-has.
 */
export function Switch({ className = "", style, children, ...props }: SwitchProps) {
  const disabled = "disabled" in props && props.disabled;
  return (
    <label
      className={`group relative inline-flex shrink-0 items-center justify-center gap-2 align-middle ${
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
      } ${className}`}
      style={style}
    >
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        className={`relative w-9 h-5 rounded-full border border-border bg-muted flex items-center transition-colors duration-150
          ${disabled ? "" : "group-hover:border-primary/50"}
          peer-checked:bg-primary peer-checked:border-primary
          peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 peer-focus-visible:border-primary`}
      >
        <span
          className="absolute left-0.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border border-border bg-card shadow-sm transition-transform duration-150
            group-has-[:checked]:translate-x-4 group-has-[:checked]:border-transparent"
        />
      </span>
      {children && <span className="select-none">{children}</span>}
    </label>
  );
}
