import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Primary call-to-action rendered under the text. */
  action?: { label: string; onClick: () => void };
  /** Smaller paddings/type for narrow panels (e.g. the sidebar). */
  compact?: boolean;
  className?: string;
}

/**
 * Unified empty-state placeholder: an icon chip, one line of text and an
 * optional primary action — replaces the bare gray sentences that used to
 * stand in for "nothing here yet".
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`h-full w-full flex flex-col items-center justify-center gap-1 text-center p-4 select-none ${className}`}
    >
      {icon && (
        <div
          className={`${
            compact ? "w-9 h-9 mb-1.5" : "w-12 h-12 mb-2"
          } rounded-full bg-muted flex items-center justify-center text-muted-foreground [&>svg]:opacity-80`}
        >
          {icon}
        </div>
      )}
      <div className={`font-medium text-foreground ${compact ? "text-xs" : "text-sm"}`}>
        {title}
      </div>
      {description && (
        <div className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
          {description}
        </div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
