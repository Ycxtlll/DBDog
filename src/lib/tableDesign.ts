/**
 * Pure logic behind the visual table designer: parse server column metadata
 * into an editable shape and diff it against user edits to produce one
 * multi-clause ALTER TABLE statement. No React, no invoke — easy to reason about.
 */
import type { Column, Index } from "../types";
import { escapeMysqlIdentifier } from "./sql";

export interface DesignColumn {
  /** Present when the column exists on the server (identity across renames). */
  origName?: string;
  /** Server-side snapshot for diffing; null for brand-new columns. */
  orig: Column | null;
  name: string;
  /** Base type without length/attributes, e.g. "int", "varchar", "enum". */
  baseType: string;
  /** Content inside the parentheses, e.g. "255", "10,2", "'a','b'". */
  length: string;
  unsigned: boolean;
  notNull: boolean;
  /** "" = no DEFAULT clause; "NULL" = DEFAULT NULL; function/expression kept raw. */
  defaultValue: string;
  autoIncrement: boolean;
  pk: boolean;
  comment: string;
  /** Argument of the server-side ON UPDATE clause, e.g. "current_timestamp()". */
  onUpdate: string;
}

export interface DesignIndex {
  origName?: string;
  orig: Index | null;
  name: string;
  /** Comma-separated column list as edited by the user. */
  columnsText: string;
  unique: boolean;
}

export function parseServerColumn(col: Column): DesignColumn {
  const m = /^([a-zA-Z]+)\s*(?:\((.*)\))?\s*(unsigned)?\s*(zerofill)?\s*$/.exec(
    col.dataType.trim(),
  );
  const extra = col.extra ?? "";
  const onUpdateMatch = /on update (.+)$/i.exec(extra);
  return {
    origName: col.name,
    orig: col,
    name: col.name,
    baseType: (m?.[1] ?? col.dataType.trim()).toLowerCase(),
    length: m?.[2]?.trim() ?? "",
    unsigned: !!m?.[3],
    notNull: !col.nullable,
    defaultValue: col.defaultValue ?? "",
    autoIncrement: col.isAutoIncrement,
    pk: col.isPrimaryKey,
    comment: col.comment ?? "",
    onUpdate: onUpdateMatch ? onUpdateMatch[1].trim() : "",
  };
}

export function parseServerIndex(idx: Index): DesignIndex {
  return {
    origName: idx.name,
    orig: idx,
    name: idx.name,
    columnsText: idx.columns.join(", "),
    unique: idx.isUnique,
  };
}

/** Escape a string literal for inline SQL (single-quote doubling). */
export function escapeMysqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function typeText(c: DesignColumn): string {
  let t = c.baseType.trim().toLowerCase();
  const len = c.length.trim();
  if (len !== "") t += `(${len})`;
  if (c.unsigned) t += " unsigned";
  return t;
}

function defaultClause(c: DesignColumn): string {
  const dv = c.defaultValue.trim();
  if (dv === "") return "";
  if (dv.toUpperCase() === "NULL") return "DEFAULT NULL";
  // Function-call-looking defaults (now(), current_timestamp(), ...) stay raw.
  if (/^[a-z0-9_]+\s*\(.*\)$/i.test(dv)) return `DEFAULT ${dv}`;
  if (/^-?\d+(\.\d+)?$/.test(dv)) return `DEFAULT ${dv}`;
  // Expression defaults reported by MySQL 8 keep their original raw form.
  if (c.orig?.extra?.includes("DEFAULT_GENERATED") && c.orig.defaultValue?.trim() === dv) {
    return `DEFAULT ${dv}`;
  }
  return `DEFAULT '${escapeMysqlString(dv)}'`;
}

/**
 * Full column definition (everything after the column name).
 * `forceNotNull` marks columns that are part of the primary key — MySQL
 * requires PK columns to be NOT NULL, and an explicit NULL in the same
 * ALTER statement as ADD PRIMARY KEY is unreliable.
 */
export function buildColumnDefinition(c: DesignColumn, forceNotNull = false): string {
  const parts: string[] = [typeText(c)];
  parts.push(forceNotNull || c.notNull ? "NOT NULL" : "NULL");
  const dv = defaultClause(c);
  if (dv) parts.push(dv);
  if (c.onUpdate.trim()) parts.push(`ON UPDATE ${c.onUpdate.trim()}`);
  if (c.autoIncrement) parts.push("AUTO_INCREMENT");
  if (c.comment.trim()) parts.push(`COMMENT '${escapeMysqlString(c.comment.trim())}'`);
  return parts.join(" ");
}

function pkSetOf(columns: DesignColumn[]): string[] {
  return columns.filter((c) => c.pk).map((c) => c.origName ?? c.name);
}

function samePk(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
}

function parseIndexColumns(columnsText: string): string[] {
  return columnsText
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export interface AlterBuildResult {
  sql: string | null;
  /** True when final PK differs from the original one. */
  pkChanged: boolean;
}

/**
 * Diff the working column/index lists against the server snapshots and build
 * a single multi-clause ALTER TABLE. Clause order matters (MySQL applies them
 * sequentially): new columns first, then column redefinitions (an AUTO_INCREMENT
 * drop must precede DROP PRIMARY KEY), then PK / index reshaping, and column
 * drops last — so dropping a PK or indexed column never races the implicit
 * shrink MySQL would otherwise perform on the constraint.
 */
export function buildAlterStatement(
  database: string,
  table: string,
  origColumns: DesignColumn[],
  columns: DesignColumn[],
  origIndexes: DesignIndex[],
  indexes: DesignIndex[],
): AlterBuildResult {
  const addClauses: string[] = [];
  const changeClauses: string[] = [];
  const pkClauses: string[] = [];
  const indexClauses: string[] = [];
  const dropColumnClauses: string[] = [];

  const origPk = pkSetOf(origColumns);
  const finalPk = pkSetOf(columns);
  const pkChanged = !samePk(origPk, finalPk);
  const finalPkNames = new Set(finalPk);

  // Column identity across edits: origName for existing columns, name for new.
  const keptOrigNames = new Set(
    columns.map((c) => c.origName).filter((n): n is string => !!n),
  );
  const identity = (c: DesignColumn) => c.origName ?? c.name;

  const defOf = (c: DesignColumn) =>
    buildColumnDefinition(c, finalPkNames.has(identity(c)));

  // 1. New columns (in final order, positioned after the preceding row).
  columns.forEach((c, i) => {
    if (c.origName) return;
    const prev = i > 0 ? columns[i - 1] : null;
    const position = prev ? `AFTER ${escapeMysqlIdentifier(prev.origName ?? prev.name)}` : "FIRST";
    addClauses.push(
      `ADD COLUMN ${escapeMysqlIdentifier(c.name)} ${defOf(c)} ${position}`,
    );
  });

  // 2. Changed / renamed / moved existing columns. Position changes are
  // detected on the relative order of *surviving original columns* only —
  // dropping a neighbor or inserting a new column between two existing ones
  // must not emit repositioning CHANGEs.
  const finalSurvivorSeq = columns
    .filter((c) => c.origName)
    .map((c) => c.origName!);
  const survivingSet = new Set(finalSurvivorSeq);
  const origSurvivorSeq = origColumns
    .filter((o) => survivingSet.has(o.origName!))
    .map((o) => o.origName!);
  const orderChanged =
    JSON.stringify(finalSurvivorSeq) !== JSON.stringify(origSurvivorSeq);

  columns.forEach((c) => {
    if (!c.origName) return;
    const orig = origColumns.find((o) => o.origName === c.origName);
    if (!orig) return;
    const nameChanged = c.name !== c.origName;
    const defChanged = defOf(c) !== buildColumnDefinition(orig, origPk.includes(orig.origName!));
    let positionChanged = false;
    if (orderChanged) {
      let prevSurvivor: DesignColumn | undefined;
      for (const row of columns) {
        if (row === c) break;
        if (row.origName) prevSurvivor = row;
      }
      const origIdx = origColumns.indexOf(orig);
      let origPrevSurvivor: DesignColumn | undefined;
      for (let j = origIdx - 1; j >= 0; j--) {
        if (survivingSet.has(origColumns[j].origName!)) {
          origPrevSurvivor = origColumns[j];
          break;
        }
      }
      positionChanged =
        (prevSurvivor?.origName ?? null) !== (origPrevSurvivor?.origName ?? null);
    }
    if (!nameChanged && !defChanged && !positionChanged) return;
    let position = "";
    if (positionChanged) {
      let prevSurvivor: DesignColumn | undefined;
      for (const row of columns) {
        if (row === c) break;
        if (row.origName) prevSurvivor = row;
      }
      position = prevSurvivor
        ? ` AFTER ${escapeMysqlIdentifier(prevSurvivor.origName ?? prevSurvivor.name)}`
        : " FIRST";
    }
    changeClauses.push(
      `CHANGE COLUMN ${escapeMysqlIdentifier(c.origName)} ${escapeMysqlIdentifier(c.name)} ${defOf(c)}${position}`,
    );
  });

  // 3./4. Primary key changes (before column drops: dropping a PK column must
  // not shrink the constraint implicitly first).
  if (pkChanged) {
    if (origPk.length > 0) pkClauses.push("DROP PRIMARY KEY");
    if (finalPk.length > 0) {
      pkClauses.push(`ADD PRIMARY KEY (${finalPk.map(escapeMysqlIdentifier).join(", ")})`);
    }
  }

  // 5./6. Index changes (drops before column drops, adds after).
  const finalByOrig = new Map<string, DesignIndex>();
  for (const idx of indexes) {
    if (idx.origName) finalByOrig.set(idx.origName, idx);
  }
  const indexChanged = (idx: DesignIndex, orig: DesignIndex | undefined): boolean => {
    if (!orig) return true;
    const cols = parseIndexColumns(idx.columnsText);
    return (
      JSON.stringify(cols) !== JSON.stringify(orig.orig?.columns ?? []) ||
      idx.unique !== orig.unique ||
      idx.name !== idx.origName
    );
  };
  for (const orig of origIndexes) {
    if (orig.origName === "PRIMARY") continue;
    const cur = finalByOrig.get(orig.origName!);
    if (!cur || indexChanged(cur, orig)) {
      indexClauses.push(`DROP INDEX ${escapeMysqlIdentifier(orig.origName!)}`);
    }
  }
  for (const idx of indexes) {
    const cols = parseIndexColumns(idx.columnsText);
    if (idx.origName) {
      const orig = origIndexes.find((o) => o.origName === idx.origName);
      if (orig && indexChanged(idx, orig)) {
        indexClauses.push(
          `${idx.unique ? "ADD UNIQUE INDEX" : "ADD INDEX"} ${escapeMysqlIdentifier(idx.name)} (${cols.map(escapeMysqlIdentifier).join(", ")})`,
        );
      }
    } else {
      indexClauses.push(
        `${idx.unique ? "ADD UNIQUE INDEX" : "ADD INDEX"} ${escapeMysqlIdentifier(idx.name)} (${cols.map(escapeMysqlIdentifier).join(", ")})`,
      );
    }
  }

  // 7. Dropped columns, last.
  for (const orig of origColumns) {
    if (!keptOrigNames.has(orig.origName!)) {
      dropColumnClauses.push(`DROP COLUMN ${escapeMysqlIdentifier(orig.origName!)}`);
    }
  }

  const clauses = [...addClauses, ...changeClauses, ...pkClauses, ...indexClauses, ...dropColumnClauses];
  if (clauses.length === 0) return { sql: null, pkChanged };

  const sql = `ALTER TABLE ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)}\n  ${clauses.join(",\n  ")};`;
  return { sql, pkChanged };
}

/** Frontend sanity checks; returns i18n keys + params for the first problem found. */
export type DesignError = { key: string; params?: Record<string, string> };

export function validateDesign(
  columns: DesignColumn[],
  indexes: DesignIndex[],
): DesignError | null {
  const names = new Set<string>();
  for (const c of columns) {
    const name = c.name.trim();
    if (!name) return { key: "errNameRequired" };
    if (/`/.test(name)) return { key: "errNameInvalid", params: { name } };
    if (names.has(name)) return { key: "errNameDuplicate", params: { name } };
    names.add(name);
    if (!c.baseType.trim()) return { key: "errTypeRequired", params: { name } };
  }
  const aiCols = columns.filter((c) => c.autoIncrement);
  if (aiCols.length > 1) return { key: "errMultiAutoInc" };
  for (const c of aiCols) {
    if (!c.pk) return { key: "errAutoIncPk", params: { name: c.name } };
  }
  const idxNames = new Set<string>(["PRIMARY"]);
  for (const idx of indexes) {
    const name = idx.name.trim();
    if (!name) return { key: "errIdxNameRequired" };
    if (idxNames.has(name)) return { key: "errIdxDuplicate", params: { name } };
    idxNames.add(name);
    if (parseIndexColumns(idx.columnsText).length === 0) {
      return { key: "errIdxColumnsRequired", params: { name } };
    }
  }
  return null;
}
