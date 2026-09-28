interface SkeletonProps {
  className?: string;
}

/** Shimmering placeholder block. Size it with className. */
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

const CELL_WIDTHS = ["w-20", "w-32", "w-14", "w-24", "w-16", "w-28"];

interface SkeletonTableProps {
  rows?: number;
  cols?: number;
  className?: string;
}

/** Table-shaped skeleton: a muted header bar plus evenly stretched rows of
 *  varied-width cell placeholders — stands in for grids and form tables
 *  while data loads, replacing the old "加载中..." text lines. */
export function SkeletonTable({ rows = 8, cols = 6, className = "" }: SkeletonTableProps) {
  return (
    <div className={`h-full w-full flex flex-col select-none ${className}`} aria-hidden>
      <div className="h-8 shrink-0 border-b border-border bg-muted flex items-center gap-3 px-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-14" />
        ))}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="flex-1 flex items-center gap-3 px-3 border-b border-border/40"
          >
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className={`h-3 ${CELL_WIDTHS[(r + c) % CELL_WIDTHS.length]}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A few stacked text lines — for sidebars and drawers. */
export function SkeletonLines({ lines = 4, className = "" }: { lines?: number } & SkeletonProps) {
  return (
    <div className={`flex flex-col gap-2.5 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
