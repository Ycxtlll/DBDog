import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { QueryResult, ReverseReference, TableBrowseState, TableRelationship } from "../../types";
import * as relationshipService from "../../services/relationshipService";
import * as queryService from "../../services/queryService";
import { useQueryStore } from "../../stores/queryStore";
import { showError, showSuccess } from "../../stores/toastStore";
import { parseTauriError } from "../../lib/error";
import { escapeMysqlIdentifier, formatSqlValue } from "../../lib/sql";

interface UseGridRelationshipsArgs {
  tabId: string;
  /** Browsed table info; relationship features only run in table browse mode. */
  browse: TableBrowseState | undefined;
  result: unknown;
  isQueryResult: boolean;
  activeConnectionId: string | null;
  /** Table currently shown in the row-detail modal (jump targets fetch on demand). */
  detailTableName?: string;
  openRowDetail: (
    row: Record<string, unknown>,
    focusColumn?: string,
    tableName?: string,
  ) => void;
}

/**
 * Everything FK/relationship related for the result grid: declared +
 * inferred forward links, reverse references, the relationship editor state,
 * FK jump navigation and per-table caches. Probes are cached/negative-cached
 * per table so page flips never hammer the production DB.
 */
export function useGridRelationships({
  tabId,
  browse,
  result,
  isQueryResult,
  activeConnectionId,
  detailTableName,
  openRowDetail,
}: UseGridRelationshipsArgs) {
  const { t } = useTranslation("query");
  // Logical foreign keys for the browsed table (M2 关系分析器).
  const [relationships, setRelationships] = useState<TableRelationship[]>([]);
  const [referencedBy, setReferencedBy] = useState<ReverseReference[]>([]);
  // Cache per table so the row modal can show jump buttons for parent rows
  // too (the modal's displayed table changes with each FK jump).
  const tableRelsRef = useRef<Map<string, TableRelationship[]>>(new Map());
  const [modalRels, setModalRels] = useState<TableRelationship[]>([]);
  /** Column whose relationship editor is open (manual link management). */
  const [relModalCol, setRelModalCol] = useState<string | null>(null);

  // child column → relationship, for cell rendering and click routing.
  useEffect(() => {
    if (!browse) return;
    tableRelsRef.current.set(`${browse.database}|${browse.table}`, relationships);
  }, [relationships, browse]);

  const fkByColumn = useMemo(() => {
    const map = new Map<string, TableRelationship>();
    for (const rel of relationships) map.set(rel.childColumn, rel);
    return map;
  }, [relationships]);
  const fkByColumnRef = useRef(fkByColumn);
  fkByColumnRef.current = fkByColumn;
  // Forward negative cache (tableKey → probed-without-hit column names) and
  // the once-per-table reverse scan guard. Column-keyed, NOT value-keyed:
  // the candidate set comes from the schema, so a column that missed on one
  // page misses on every page — per-fingerprint caching would re-probe on
  // each flip. DDL events clear both (a column may become a real FK).
  const fwdNegativeRef = useRef<Map<string, Set<string>>>(new Map());
  const revRanRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const reset = () => {
      fwdNegativeRef.current.clear();
      revRanRef.current.clear();
    };
    window.addEventListener("dbdog-schema-changed", reset);
    return () => window.removeEventListener("dbdog-schema-changed", reset);
  }, []);

  // Declared/adjudicated links load once per browsed table (cheap — no
  // probing); re-browsing the same table keeps what inference has merged.
  const relTableKeyRef = useRef("");
  const relFetchIdRef = useRef(0);
  useEffect(() => {
    const key = browse ? `${browse.database}|${browse.table}` : "";
    if (key === relTableKeyRef.current) return;
    relTableKeyRef.current = key;
    setRelationships([]);
    setReferencedBy([]);
    revRanRef.current.delete(key); // re-opening a table rescans reverse refs
    if (!browse || !activeConnectionId) return;
    const fetchId = ++relFetchIdRef.current;
    relationshipService
      .getRelationships(activeConnectionId, browse.database, browse.table)
      .then((overview) => {
        if (fetchId === relFetchIdRef.current) {
          setRelationships(overview.relationships);
          setReferencedBy(overview.referencedBy);
        }
      })
      .catch(() => {
        /* analyzer unavailable or non-MySQL — grid renders without links */
      });
  }, [browse, activeConnectionId]);

  // Inference pass: sample distinct values from the loaded page (zero extra
  // child-side queries) and let the backend probe parent primary keys.
  // Runs per new result while the grid shows this table's browse data.
  // Negative cache: a (column, samples) combo that produced no link is never
  // re-probed — page flips must not hammer the production DB with probes.
  useEffect(() => {
    if (!browse || !activeConnectionId || !result || !isQueryResult) return;
    const current = useQueryStore.getState().tabs.find((tt) => tt.id === tabId);
    if (!current) return;
    const plainBrowse = browse.browseMode !== "custom";
    if (!plainBrowse) return;
    const qr = result as QueryResult;
    const tableKey = `${browse.database}|${browse.table}`;
    const negative = fwdNegativeRef.current.get(tableKey) ?? new Set<string>();
    const samples: Record<string, unknown[]> = {};
    const sampledColumns: string[] = [];
    qr.columns.forEach((col, colIdx) => {
      if (fkByColumnRef.current.has(col.name)) return;
      if (negative.has(col.name)) return;
      const vals: unknown[] = [];
      const seen = new Set<string>();
      for (const row of qr.rows) {
        const v = row[colIdx];
        if (v === null || v === undefined || v === "") continue;
        const key = String(v);
        if (seen.has(key)) continue;
        seen.add(key);
        vals.push(v);
        if (vals.length >= 50) break;
      }
      if (vals.length === 0) return;
      sampledColumns.push(col.name);
      samples[col.name] = vals;
    });
    if (Object.keys(samples).length === 0) return;
    let stale = false;
    relationshipService
      .inferRelationships(activeConnectionId, browse.database, browse.table, samples)
      .then((inferred) => {
        if (stale) return;
        const linked = new Set(inferred.map((r) => r.childColumn));
        for (const colName of sampledColumns) {
          if (!linked.has(colName)) negative.add(colName);
        }
        fwdNegativeRef.current.set(tableKey, negative);
        if (inferred.length === 0) return;
        setRelationships((prev) => {
          const merged = [...prev];
          for (const rel of inferred) {
            const dup = merged.some(
              (r) =>
                r.childColumn === rel.childColumn &&
                r.parentTable === rel.parentTable &&
                r.parentColumn === rel.parentColumn,
            );
            if (!dup) merged.push(rel);
          }
          return merged;
        });
      })
      .catch(() => {
        /* probing failed (permissions, timeout) — links just stay absent */
      });
    return () => {
      stale = true;
    };
  }, [result, browse, activeConnectionId, isQueryResult, tabId]);

  // Reverse inference (the safety net): which indexed child columns reference
  // this table's primary key. Declared-only lists stay empty on schemas
  // without physical FKs (bitanswer) — this lights the menu up there.
  // Samples are the page's PK values; runs once per browsed table.
  useEffect(() => {
    if (!browse || !activeConnectionId || !result || !isQueryResult) return;
    const current = useQueryStore.getState().tabs.find((tt) => tt.id === tabId);
    if (!current) return;
    const plainBrowse = browse.browseMode !== "custom";
    if (!plainBrowse) return;
    const pkCol = browse.primaryKeyColumns[0];
    if (!pkCol) return;
    const tableKey = `${browse.database}|${browse.table}`;
    if (revRanRef.current.has(tableKey)) return;
    const qr = result as QueryResult;
    const idx = qr.columns.findIndex((c) => c.name === pkCol);
    if (idx < 0) return;
    const vals: unknown[] = [];
    const seen = new Set<string>();
    for (const row of qr.rows) {
      const v = row[idx];
      if (v === null || v === undefined || v === "") continue;
      const key = String(v);
      if (seen.has(key)) continue;
      seen.add(key);
      vals.push(v);
      if (vals.length >= 50) break;
    }
    if (vals.length < 3) return;
    revRanRef.current.add(tableKey);
    let stale = false;
    relationshipService
      .inferReverseReferences(activeConnectionId, browse.database, browse.table, pkCol, vals)
      .then((refs) => {
        if (stale || refs.length === 0) return;
        setReferencedBy((prev) => {
          const merged = [...prev];
          for (const ref of refs) {
            const dup = prev.some(
              (x) =>
                x.childTable === ref.childTable &&
                x.childColumn === ref.childColumn &&
                x.parentColumn === ref.parentColumn,
            );
            if (!dup) merged.push(ref);
          }
          return merged;
        });
      })
      .catch(() => {
        /* reverse probing failed — menu just stays declared-only */
      });
    return () => {
      stale = true;
    };
  }, [result, browse, activeConnectionId, isQueryResult, tabId]);

  // Relationships for the table the row modal is currently showing — the
  // browsed table comes from cache, others (jump targets) fetch on demand.
  useEffect(() => {
    const tableName = detailTableName;
    if (!tableName || !activeConnectionId || !browse) return;
    const key = `${browse.database}|${tableName}`;
    const cached = tableRelsRef.current.get(key);
    if (cached) {
      setModalRels(cached);
      return;
    }
    let stale = false;
    relationshipService
      .getRelationships(activeConnectionId, browse.database, tableName)
      .then((overview) => {
        if (stale) return;
        tableRelsRef.current.set(key, overview.relationships);
        setModalRels(overview.relationships);
      })
      .catch(() => {
        if (!stale) setModalRels([]);
      });
    return () => {
      stale = true;
    };
  }, [detailTableName, activeConnectionId, browse]);

  /** FK link click → fetch the parent row and show it in the row modal. */
  const handleFkJump = useCallback(
    async (rel: TableRelationship, value: unknown) => {
      if (!activeConnectionId || !browse) return;
      try {
        const res = await queryService.executeQuery(
          activeConnectionId,
          `SELECT * FROM ${escapeMysqlIdentifier(browse.database)}.${escapeMysqlIdentifier(rel.parentTable)} WHERE ${escapeMysqlIdentifier(rel.parentColumn)} = ${formatSqlValue(value)} LIMIT 1;`,
          undefined,
          browse.database,
        );
        if (res.rows.length === 0) {
          showError(t("fkParentNotFound"));
          return;
        }
        const row: Record<string, unknown> = {};
        res.columns.forEach((c, i) => {
          row[c.name] = res.rows[0][i] ?? null;
        });
        openRowDetail(row, rel.parentColumn, rel.parentTable);
      } catch (err) {
        showError(parseTauriError(err));
      }
    },
    [activeConnectionId, browse, t, openRowDetail],
  );

  /** Reverse reference: run the child-side query in this tab. */
  const viewReferencingRows = useCallback(
    (ref: ReverseReference, value: unknown) => {
      if (!browse || !activeConnectionId) return;
      const sql = `SELECT * FROM ${escapeMysqlIdentifier(browse.database)}.${escapeMysqlIdentifier(ref.childTable)} WHERE ${escapeMysqlIdentifier(ref.childColumn)} = ${formatSqlValue(value)} LIMIT 200;`;
      void useQueryStore.getState().execute(activeConnectionId, tabId, undefined, sql);
    },
    [browse, activeConnectionId, tabId],
  );

  /** Persist a verdict on an inferred link and update the local view. */
  const adjudicateRel = useCallback(
    (rel: TableRelationship, confirm: boolean) => {
      if (!activeConnectionId) return;
      relationshipService
        .adjudicateRelationship(
          activeConnectionId,
          {
            childTable: rel.childTable,
            childColumn: rel.childColumn,
            parentTable: rel.parentTable,
            parentColumn: rel.parentColumn,
          },
          confirm,
        )
        .then(() => {
          showSuccess(t("fkAdjudicated"));
          setRelationships((prev) =>
            confirm
              ? prev.map((r) =>
                  r === rel ? { ...r, source: "adjudicated" as const, confidence: 1 } : r,
                )
              : prev.filter((r) => r !== rel),
          );
        })
        .catch((err) => showError(parseTauriError(err)));
    },
    [activeConnectionId, t],
  );

  // Sample values of the relationship-editor column from the loaded page —
  // live probe fuel for the manual link editor.
  const relModalSamples = useMemo(() => {
    if (!relModalCol || !result || !isQueryResult) return [];
    const qr = result as QueryResult;
    const idx = qr.columns.findIndex((c) => c.name === relModalCol);
    if (idx < 0) return [];
    const vals: unknown[] = [];
    const seen = new Set<string>();
    for (const row of qr.rows) {
      const v = row[idx];
      if (v === null || v === undefined || v === "") continue;
      const key = String(v);
      if (seen.has(key)) continue;
      seen.add(key);
      vals.push(v);
      if (vals.length >= 50) break;
    }
    return vals;
  }, [relModalCol, result, isQueryResult]);

  return {
    relationships,
    setRelationships,
    referencedBy,
    setReferencedBy,
    modalRels,
    relModalCol,
    setRelModalCol,
    fkByColumn,
    fkByColumnRef,
    tableRelsRef,
    relModalSamples,
    handleFkJump,
    viewReferencingRows,
    adjudicateRel,
  };
}
