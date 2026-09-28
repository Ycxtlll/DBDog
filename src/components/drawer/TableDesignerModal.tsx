import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  PencilRuler,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import * as schemaService from "../../services/schemaService";
import * as queryService from "../../services/queryService";
import { useUiStore } from "../../stores/uiStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { showSuccess, showError } from "../../stores/toastStore";
import { parseTauriError } from "../../lib/error";
import { confirmDialog } from "../../lib/confirm";
import { Checkbox } from "../ui/Checkbox";
import { SkeletonTable } from "../ui/Skeleton";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";
import {
  parseServerColumn,
  parseServerIndex,
  buildAlterStatement,
  validateDesign,
  type DesignColumn,
  type DesignIndex,
} from "../../lib/tableDesign";
import type { TableDetails } from "../../types";

const COMMON_TYPES = [
  "int", "bigint", "smallint", "tinyint", "decimal", "float", "double",
  "varchar", "char", "text", "longtext", "date", "datetime", "timestamp",
  "time", "year", "json", "enum", "blob", "boolean",
];

interface TableDesignerModalProps {
  connectionId: string | null;
}

const cellInput =
  "w-full bg-background border border-border rounded-md px-1.5 py-1 text-xs outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";
const opBtn =
  "p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none";

function newColumn(): DesignColumn {
  return {
    orig: null,
    name: "",
    baseType: "varchar",
    length: "255",
    unsigned: false,
    notNull: false,
    defaultValue: "",
    autoIncrement: false,
    pk: false,
    comment: "",
    onUpdate: "",
  };
}

export function TableDesignerModal({ connectionId }: TableDesignerModalProps) {
  const { t } = useTranslation("schema");
  const { drawer, closeDrawer } = useLayoutStore();
  const resolvedTheme = useUiStore((s) => s.resolvedTheme);

  const [details, setDetails] = useState<TableDetails | null>(null);
  const [origColumns, setOrigColumns] = useState<DesignColumn[]>([]);
  const [columns, setColumns] = useState<DesignColumn[]>([]);
  const [origIndexes, setOrigIndexes] = useState<DesignIndex[]>([]);
  const [indexes, setIndexes] = useState<DesignIndex[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const params = drawer.params;
  const db = typeof params?.database === "string" ? params.database : undefined;
  const table = typeof params?.table === "string" ? params.table : undefined;

  // Keep the db/table identity available while the exit animation plays
  // (drawer.params are already gone by then).
  const ctxRef = useRef<{ db: string; table: string }>({ db: "", table: "" });
  const open = drawer.type === "tableDesign";
  if (open && db && table) ctxRef.current = { db, table };
  const ctx = db && table ? { db, table } : ctxRef.current;

  const applyDetails = useCallback((data: TableDetails) => {
    const parsedCols = data.columns.map(parseServerColumn);
    const parsedIdx = data.indexes.filter((i) => !i.isPrimary).map(parseServerIndex);
    setDetails(data);
    setOrigColumns(parsedCols);
    setColumns(parsedCols.map((c) => ({ ...c })));
    setOrigIndexes(parsedIdx);
    setIndexes(parsedIdx.map((i) => ({ ...i })));
  }, []);

  useEffect(() => {
    async function load() {
      if (drawer.type === "tableDesign" && connectionId && db && table) {
        setLoading(true);
        setLoadError(null);
        try {
          const data = await schemaService.getTableDetails(connectionId, db, table);
          applyDetails(data);
        } catch (err) {
          const msg = parseTauriError(err);
          setLoadError(msg);
          console.error("Failed to load table details:", err);
        } finally {
          setLoading(false);
        }
      }
    }
    load();
  }, [drawer.type, connectionId, db, table, applyDetails]);

  const { sql: alterSql } = useMemo(
    () =>
      buildAlterStatement(
        ctx.db,
        ctx.table,
        origColumns,
        columns,
        origIndexes,
        indexes,
      ),
    [ctx.db, ctx.table, origColumns, columns, origIndexes, indexes],
  );

  const validation = useMemo(() => validateDesign(columns, indexes), [columns, indexes]);

  const hasEdits = alterSql !== null;

  const handleClose = useCallback(async () => {
    if (hasEdits && !(await confirmDialog(t("confirmDiscard"), t("designTable")))) return;
    closeDrawer();
  }, [hasEdits, t, closeDrawer]);

  const panelRef = useRef<HTMLDivElement>(null);
  // Esc goes through handleClose (confirms when there are unsaved edits).
  useModalFocus(panelRef, {
    active: drawer.type === "tableDesign",
    onEscape: handleClose,
  });

  const updateColumn = (i: number, patch: Partial<DesignColumn>) => {
    setColumns((cols) => cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  const addColumn = () => {
    setColumns((cols) => [...cols, newColumn()]);
  };

  const removeColumn = (i: number) => {
    setColumns((cols) => cols.filter((_, j) => j !== i));
  };

  const moveColumn = (i: number, dir: -1 | 1) => {
    setColumns((cols) => {
      const j = i + dir;
      if (j < 0 || j >= cols.length) return cols;
      const next = [...cols];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const updateIndex = (i: number, patch: Partial<DesignIndex>) => {
    setIndexes((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  const addIndex = () => {
    setIndexes((list) => [
      ...list,
      { orig: null, name: "", columnsText: "", unique: false },
    ]);
  };

  const removeIndex = (i: number) => {
    setIndexes((list) => list.filter((_, j) => j !== i));
  };

  const handleApply = async () => {
    if (!connectionId || !db || !table || !alterSql || validation || applying) return;
    setApplying(true);
    try {
      await queryService.executeUpdate(connectionId, alterSql, db);
      showSuccess(t("structureUpdated", { table }));
      await schemaService.refreshSchema(connectionId, db);
      window.dispatchEvent(
        new CustomEvent("dbdog-schema-changed", { detail: { database: db } }),
      );
      // Reload from the server so the editor reflects the applied structure.
      const fresh = await schemaService.getTableDetails(connectionId, db, table);
      applyDetails(fresh);
    } catch (err) {
      const msg = parseTauriError(err);
      showError(msg);
      console.error("Failed to apply table structure changes:", err);
    } finally {
      setApplying(false);
    }
  };

  const show = useDelayedUnmount(open);
  const closing = show && !open;
  if (!show || !connectionId) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
    >
      <div
        ref={panelRef}
        className={`w-[1040px] max-w-[95vw] max-h-[88vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col ${closing ? "animate-modal-out" : "animate-modal-in"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted shrink-0">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <PencilRuler size={16} className="text-primary" />
              {t("designTable")}
            </h3>
            <div className="text-xs text-muted-foreground">
              {ctx.db}.{ctx.table}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("cancel")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-5">
          {loadError && (
            <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border border-border rounded-md">
              {t("loadDetailsFailed", { msg: loadError })}
            </div>
          )}
          {loading && (
            <div className="h-72 shrink-0">
              <SkeletonTable rows={8} cols={6} />
            </div>
          )}
          {!loading && details && (
            <>
              {/* Columns */}
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t("columns")}
                  </h4>
                  <button
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border bg-background hover:bg-accent hover:border-primary/50 transition-colors"
                    onClick={addColumn}
                  >
                    <Plus size={12} />
                    {t("addColumn")}
                  </button>
                </div>
                <div className="border border-border rounded-md overflow-x-auto">
                  <table className="w-full text-xs min-w-[980px]">
                    <thead>
                      <tr className="bg-muted text-muted-foreground text-left">
                        <th className="px-2 py-1.5 font-medium w-40">{t("colName")}</th>
                        <th className="px-2 py-1.5 font-medium w-32">{t("colType")}</th>
                        <th className="px-2 py-1.5 font-medium w-24">{t("colLength")}</th>
                        <th className="px-2 py-1.5 font-medium w-14 text-center">{t("colUnsigned")}</th>
                        <th className="px-2 py-1.5 font-medium w-14 text-center">{t("colNotNull")}</th>
                        <th className="px-2 py-1.5 font-medium w-36">{t("colDefault")}</th>
                        <th className="px-2 py-1.5 font-medium w-12 text-center">{t("colAutoInc")}</th>
                        <th className="px-2 py-1.5 font-medium w-12 text-center">{t("colPk")}</th>
                        <th className="px-2 py-1.5 font-medium min-w-48">{t("colComment")}</th>
                        <th className="px-2 py-1.5 font-medium w-20 text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((col, i) => (
                        <tr key={col.origName ?? `new-${i}`} className="border-t border-border/50">
                          <td className="px-2 py-1">
                            <input
                              className={cellInput}
                              value={col.name}
                              onChange={(e) => updateColumn(i, { name: e.target.value })}
                              placeholder={col.origName ? "" : t("colName")}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className={cellInput}
                              value={col.baseType}
                              list="dbdog-col-types"
                              onChange={(e) => updateColumn(i, { baseType: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className={cellInput}
                              value={col.length}
                              onChange={(e) => updateColumn(i, { length: e.target.value })}
                              placeholder="—"
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Checkbox
                              checked={col.unsigned}
                              onChange={(e) => updateColumn(i, { unsigned: e.target.checked })}
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Checkbox
                              checked={col.notNull}
                              onChange={(e) => updateColumn(i, { notNull: e.target.checked })}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className={cellInput}
                              value={col.defaultValue}
                              onChange={(e) => updateColumn(i, { defaultValue: e.target.value })}
                              placeholder="—"
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Checkbox
                              checked={col.autoIncrement}
                              onChange={(e) => updateColumn(i, { autoIncrement: e.target.checked })}
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Checkbox
                              checked={col.pk}
                              onChange={(e) => updateColumn(i, { pk: e.target.checked })}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className={cellInput}
                              value={col.comment}
                              onChange={(e) => updateColumn(i, { comment: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center justify-center gap-0.5">
                              <button
                                className={opBtn}
                                disabled={i === 0}
                                onClick={() => moveColumn(i, -1)}
                                title={t("moveUp")}
                              >
                                <ChevronUp size={13} />
                              </button>
                              <button
                                className={opBtn}
                                disabled={i === columns.length - 1}
                                onClick={() => moveColumn(i, 1)}
                                title={t("moveDown")}
                              >
                                <ChevronDown size={13} />
                              </button>
                              <button
                                className={`${opBtn} hover:text-destructive`}
                                onClick={() => removeColumn(i)}
                                title={t("remove")}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <datalist id="dbdog-col-types">
                    {COMMON_TYPES.map((type) => (
                      <option key={type} value={type} />
                    ))}
                  </datalist>
                </div>
              </section>

              {/* Indexes */}
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t("indexes")}
                  </h4>
                  <button
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border bg-background hover:bg-accent hover:border-primary/50 transition-colors"
                    onClick={addIndex}
                  >
                    <Plus size={12} />
                    {t("addIndex")}
                  </button>
                </div>
                {indexes.length === 0 ? (
                  <div className="border border-border rounded-md px-3 py-2 text-xs text-muted-foreground">
                    {t("noIndexes")}
                  </div>
                ) : (
                  <div className="border border-border rounded-md overflow-x-auto">
                    <table className="w-full text-xs min-w-[560px]">
                      <thead>
                        <tr className="bg-muted text-muted-foreground text-left">
                          <th className="px-2 py-1.5 font-medium w-48">{t("idxName")}</th>
                          <th className="px-2 py-1.5 font-medium">{t("idxColumns")}</th>
                          <th className="px-2 py-1.5 font-medium w-16 text-center">{t("idxUnique")}</th>
                          <th className="px-2 py-1.5 font-medium w-12 text-center"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {indexes.map((idx, i) => (
                          <tr key={idx.origName ?? `new-idx-${i}`} className="border-t border-border/50">
                            <td className="px-2 py-1">
                              <input
                                className={cellInput}
                                value={idx.name}
                                onChange={(e) => updateIndex(i, { name: e.target.value })}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                className={cellInput}
                                value={idx.columnsText}
                                onChange={(e) => updateIndex(i, { columnsText: e.target.value })}
                                placeholder="col1, col2"
                              />
                            </td>
                            <td className="px-2 py-1 text-center">
                              <Checkbox
                                checked={idx.unique}
                                onChange={(e) => updateIndex(i, { unique: e.target.checked })}
                              />
                            </td>
                            <td className="px-2 py-1 text-center">
                              <button
                                className={`${opBtn} hover:text-destructive`}
                                onClick={() => removeIndex(i)}
                                title={t("remove")}
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* SQL preview */}
              <section>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  {t("sqlPreview")}
                </h4>
                <div className="border border-border rounded-md overflow-hidden">
                  <CodeMirror
                    value={alterSql ?? t("noChanges")}
                    editable={false}
                    theme={resolvedTheme === "dark" ? vscodeDark : vscodeLight}
                    extensions={[sql()]}
                    height="150px"
                    basicSetup={{
                      lineNumbers: false,
                      foldGutter: false,
                      highlightActiveLine: false,
                    }}
                    className="text-xs"
                  />
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted shrink-0">
          <div className="text-xs text-destructive">
            {validation ? t(validation.key, validation.params) : ""}
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 text-xs rounded-md border border-border bg-background hover:bg-accent hover:border-primary/50 transition-colors"
              onClick={handleClose}
            >
              {t("cancel")}
            </button>
            <button
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1"
              disabled={!alterSql || !!validation || applying}
              onClick={handleApply}
            >
              {applying && <Loader2 size={12} className="animate-spin" />}
              {applying ? t("applying") : t("apply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
