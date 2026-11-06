import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import type { TableRelationship } from "../../types";

interface FkJumpButtonProps {
  rel: TableRelationship;
  /** Grid uses event delegation via [data-fk-jump]; the row modal passes
   *  an explicit handler. Value nullish/0 never renders (caller filters). */
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * The FK jump affordance shared by the result grid cells and the row-data
 * modal: a small pill button with a generous hit area (p-1 + ml-1 spacing
 * from the cell text), clearly visible on both themes.
 */
export function FkJumpButton({ rel, onClick }: FkJumpButtonProps) {
  const { t } = useTranslation("query");
  const inferred = rel.source === "inferred";
  return (
    <span
      data-fk-jump="1"
      onClick={(e) => onClick?.(e)}
      title={`${t(`source_${rel.source}`)} · ${t("fkJumpTitle", {
        table: rel.parentTable,
        confidence: Math.round(rel.confidence * 100),
      })}`}
      className={`inline-flex shrink-0 cursor-pointer items-center rounded-md ml-1 px-1 py-0.5 transition-colors ${
        inferred ? "text-muted-foreground bg-muted/70" : "text-primary/80 bg-primary/5"
      } hover:bg-primary/15 hover:text-primary`}
    >
      <Link2 size={14} />
    </span>
  );
}
