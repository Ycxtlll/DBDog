/**
 * UI state shape for the visual table designer: parse server column metadata
 * into the editable shape the designer forms work with. The algorithm half
 * (ALTER diff/generation, validation) lives in Rust — schema/alter_gen.rs —
 * and is invoked via schemaService.designerPrepareAlter / designerValidate.
 */
import type { Column, Index } from "../types";

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
