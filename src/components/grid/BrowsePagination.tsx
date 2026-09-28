import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ChevronDown,
  RefreshCw,
} from "lucide-react";

export const BROWSE_PAGE_SIZES = [50, 100, 200, 500, 1000];

interface BrowsePaginationProps {
  page: number;
  pageSize: number;
  /** Total rows from COUNT(*); undefined = count unavailable yet. */
  totalRows?: number;
  /** Rows on the current page — used to detect "no next page" when the count is unknown. */
  rowsOnPage: number;
  loading: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onRefresh: () => void;
}

const iconBtn =
  "p-1 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none text-muted-foreground hover:text-foreground transition-colors";

export function BrowsePagination({
  page,
  pageSize,
  totalRows,
  rowsOnPage,
  loading,
  onPage,
  onPageSize,
  onRefresh,
}: BrowsePaginationProps) {
  const { t } = useTranslation("query");
  const [pageInput, setPageInput] = useState("");

  const totalPages =
    totalRows !== undefined ? Math.max(1, Math.ceil(totalRows / pageSize)) : undefined;
  const hasPrev = page > 1;
  const hasNext = totalPages !== undefined ? page < totalPages : rowsOnPage >= pageSize;

  const commitPageInput = () => {
    const n = Number(pageInput);
    if (Number.isInteger(n) && n >= 1 && (totalPages === undefined || n <= totalPages)) {
      if (n !== page) onPage(n);
    }
    setPageInput("");
  };

  return (
    <div className="flex items-center justify-between px-3 py-1 text-xs border-t border-border bg-muted select-none">
      <div className="flex items-center gap-2 text-muted-foreground">
        <button
          className={iconBtn}
          disabled={loading}
          onClick={onRefresh}
          title={t("refresh")}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <div className="relative">
          <select
            className="appearance-none bg-background border border-border rounded-md pl-2 pr-6 py-1 text-xs outline-none cursor-pointer hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {BROWSE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {t("rowsPerPage", { size })}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
          />
        </div>
        <span>
          {totalRows !== undefined
            ? t("totalRowsInfo", { count: totalRows })
            : t("totalRowsUnknown")}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className={iconBtn}
          disabled={!hasPrev || loading}
          onClick={() => onPage(1)}
          title={t("agFirstPage")}
        >
          <ChevronsLeft size={13} />
        </button>
        <button
          className={iconBtn}
          disabled={!hasPrev || loading}
          onClick={() => onPage(page - 1)}
          title={t("agPrevPage")}
        >
          <ChevronLeft size={13} />
        </button>
        <span className="flex items-center gap-1 text-muted-foreground">
          {t("pageLabel")}
          <input
            className="w-10 bg-background border border-border rounded-md px-1 py-0.5 text-xs text-center outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            value={pageInput !== "" ? pageInput : String(page)}
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={commitPageInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            title={t("goToPage")}
          />
          {totalPages !== undefined ? t("pageOf", { total: totalPages }) : ""}
        </span>
        <button
          className={iconBtn}
          disabled={!hasNext || loading}
          onClick={() => onPage(page + 1)}
          title={t("agNextPage")}
        >
          <ChevronRight size={13} />
        </button>
        <button
          className={iconBtn}
          disabled={totalPages === undefined || page >= totalPages || loading}
          onClick={() => totalPages !== undefined && onPage(totalPages)}
          title={t("agLastPage")}
        >
          <ChevronsRight size={13} />
        </button>
      </div>
    </div>
  );
}
