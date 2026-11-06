import type { TableBrowseState } from "../types";

/**
 * 将多语句 SQL 按分号分割为独立语句。
 * 处理字符串字面量与反引号标识符中的分号，跳过注释（行注释与块注释）中的分号。
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";
  let escaped = false;

  const chars = [...sql];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const next = chars[i + 1] ?? "";

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (inString) {
      current += char;
      if (char === stringChar) {
        inString = false;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }
    // Line comments: `-- ` (MySQL requires whitespace after --), `#`.
    if (
      (char === "-" && next === "-" && /\s/.test(chars[i + 2] ?? " ")) ||
      char === "#"
    ) {
      while (i < chars.length && chars[i] !== "\n") {
        current += chars[i];
        i++;
      }
      if (i < chars.length) current += "\n";
      continue;
    }
    // Block comment.
    if (char === "/" && next === "*") {
      current += "/*";
      i++;
      while (i < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) {
        current += chars[i];
        i++;
      }
      current += "*/";
      i++;
      continue;
    }
    if (char === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

export interface StatementRange {
  start: number;
  end: number;
  text: string;
}

/**
 * Locate the statement containing `pos` (CodeMirror-style UTF-16 offset),
 * using the same string/comment-aware semicolon splitting as
 * splitSqlStatements. Returns the raw (untrimmed) range; `text` is trimmed.
 * Returns null when the containing statement is empty.
 */
export function statementRangeAt(sqlText: string, pos: number): StatementRange | null {
  const boundaries: number[] = [];
  let inString = false;
  let stringChar = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const next = sqlText[i + 1] ?? "";

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inString) {
      if (char === stringChar) inString = false;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      inString = true;
      stringChar = char;
      continue;
    }
    if (char === "-" && next === "-" && /\s/.test(sqlText[i + 2] ?? " ")) {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "#") {
      inLineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (char === ";") boundaries.push(i + 1);
  }

  let start = 0;
  for (const b of boundaries) {
    if (b <= pos) start = b;
    else break;
  }
  // A boundary sits just past its `;` — step back one so the statement text
  // excludes the terminating semicolon.
  const nextB = boundaries.find((b) => b > pos);
  const end = nextB !== undefined ? nextB - 1 : sqlText.length;
  const text = sqlText.slice(start, end).trim();
  // Comments/whitespace-only "statements" (e.g. between stray semicolons)
  // are not executable.
  if (/^[\s;]*$/.test(text)) return null;
  return { start, end, text };
}

/**
 * True when the statement carries a WHERE clause at the TOP level — i.e.
 * outside string literals, comments and parenthesized subqueries. Used to
 * warn before running an UPDATE/DELETE that would hit every row.
 */
export function hasTopLevelWhere(stmt: string): boolean {
  let inString = false;
  let stringChar = "";
  let escaped = false;
  let depth = 0;
  let word = "";
  const chars = [...stmt];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (inString) {
      if (c === stringChar) inString = false;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === "-" && next === "-" && /\s/.test(chars[i + 2] ?? " ")) {
      while (i < chars.length && chars[i] !== "\n") i++;
      continue;
    }
    if (c === "#") {
      while (i < chars.length && chars[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (c === "(") {
      depth++;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    if (/[A-Za-z0-9_$]/.test(c)) {
      word += c;
      continue;
    }
    if (word.toUpperCase() === "WHERE") return true;
    word = "";
  }
  return word.toUpperCase() === "WHERE";
}

/**
 * Escape a MySQL identifier (database/table/column) for inline SQL by
 * wrapping it in backticks and doubling any embedded backticks.
 */
export function escapeMysqlIdentifier(ident: string): string {
  return "`" + ident.replace(/`/g, "``") + "`";
}

/**
 * Build the paged SELECT used by table browsing (server-side pagination).
 * Orders by primary key when available so OFFSET paging is stable. With an
 * explicit sort, the sort column leads and primary keys follow so paging
 * stays stable within equal sort values.
 */
export function buildTableSelect(
  database: string,
  table: string,
  primaryKeyColumns: string[],
  offset: number,
  pageSize: number,
  sort?: { col: string; dir: "asc" | "desc" } | null,
): string {
  const from = `SELECT * FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)}`;
  let order = "";
  if (sort) {
    const parts = [
      `${escapeMysqlIdentifier(sort.col)} ${sort.dir === "desc" ? "DESC" : "ASC"}`,
      ...primaryKeyColumns
        .filter((c) => c !== sort.col)
        .map((c) => `${escapeMysqlIdentifier(c)} ASC`),
    ];
    order = ` ORDER BY ${parts.join(", ")}`;
  } else if (primaryKeyColumns.length) {
    order = ` ORDER BY ${primaryKeyColumns.map(escapeMysqlIdentifier).join(", ")}`;
  }
  return `${from}${order} LIMIT ${offset}, ${pageSize};`;
}

/**
 * The paged browse SELECT a table-browse state currently points at — the
 * single source for "is the grid showing plain browse data" comparisons
 * (pager visibility, filter applicability), including its server-side sort.
 */
export function browseStateSelectSql(browse: TableBrowseState): string {
  return buildTableSelect(
    browse.database,
    browse.table,
    browse.primaryKeyColumns,
    (browse.page - 1) * browse.pageSize,
    browse.pageSize,
    browse.sort,
  );
}

/**
 * Build INSERT statements for the given rows — grid "copy as INSERT" today,
 * the changeset workflow later. Identifiers escaped, values formatted via
 * formatSqlValue (NULL/number/bool/string/JSON aware).
 */
export function buildInsertStatements(
  database: string,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  const cols = columns.map(escapeMysqlIdentifier).join(", ");
  const target = `${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)}`;
  return rows
    .map((row) => {
      const values = columns.map((c) => formatSqlValue(row[c])).join(", ");
      return `INSERT INTO ${target} (${cols}) VALUES (${values});`;
    })
    .join("\n");
}

/** Build the exact row-count query for a table browse session. */
export function buildCountSql(database: string, table: string): string {
  return `SELECT COUNT(*) FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)};`;
}

/**
 * Quote a MySQL string literal: single quotes with backslash and quote
 * escaped. LIKE wildcards (% _) are deliberately left alone — users type
 * them as wildcards.
 */
export function escapeMysqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Format a decoded cell value as a SQL literal for generated statements
 * (UPDATE/INSERT from the grid). NULL stays NULL, numbers/booleans are
 * unquoted, objects (JSON columns) are serialized before quoting.
 */
export function formatSqlValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "bigint") return String(val);
  if (typeof val === "boolean") return val ? "1" : "0";
  if (typeof val === "object") return escapeMysqlString(JSON.stringify(val));
  return escapeMysqlString(String(val));
}

/** WHERE clause matching one row by its primary-key values. */
function buildPkWhereClause(
  pkColumns: string[],
  row: Record<string, unknown>,
): string {
  return pkColumns
    .map((col) => {
      const val = row[col];
      return val === null || val === undefined
        ? `${escapeMysqlIdentifier(col)} IS NULL`
        : `${escapeMysqlIdentifier(col)} = ${formatSqlValue(val)}`;
    })
    .join(" AND ");
}

/**
 * Reverse statement for an inline cell edit: restore the column's previous
 * value, matched by primary key. `rowDataBefore` must be the row as it was
 * BEFORE the edit (the grid's snapshot).
 */
export function buildRollbackForUpdate(
  database: string,
  table: string,
  pkColumns: string[],
  rowDataBefore: Record<string, unknown>,
  columnName: string,
): string {
  const set = `${escapeMysqlIdentifier(columnName)} = ${formatSqlValue(rowDataBefore[columnName])}`;
  return `UPDATE ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)} SET ${set} WHERE ${buildPkWhereClause(pkColumns, rowDataBefore)} LIMIT 1;`;
}

/**
 * Reverse statement for a row delete: re-insert the full row (including its
 * primary key) with the values as they were BEFORE the delete.
 */
export function buildRollbackForDelete(
  database: string,
  table: string,
  columns: string[],
  rowDataBefore: Record<string, unknown>,
): string {
  const cols = columns.map(escapeMysqlIdentifier).join(", ");
  const values = columns.map((c) => formatSqlValue(rowDataBefore[c])).join(", ");
  return `INSERT INTO ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)} (${cols}) VALUES (${values});`;
}

// ── Structure comparison → ALTER generation ──

export interface CompareColumnDiff {
  name: string;
  kind: "added" | "removed" | "changed";
  sourceType: string | null;
  targetType: string | null;
  sourceNullable: boolean | null;
  targetNullable: boolean | null;
  sourceDefault: string | null;
  targetDefault: string | null;
  sourceExtra: string | null;
  targetExtra: string | null;
}

export interface CompareIndexDiff {
  name: string;
  kind: "added" | "removed" | "changed";
  sourceColumns: string[];
  targetColumns: string[];
  sourceUnique: boolean | null;
  targetUnique: boolean | null;
}

export interface CompareTableDiff {
  table: string;
  sourceRows: number | null;
  targetRows: number | null;
  columnDiffs: CompareColumnDiff[];
  indexDiffs: CompareIndexDiff[];
}

/** One column's fragment for ADD/MODIFY COLUMN. */
function columnDefinition(
  type: string | null | undefined,
  nullable: boolean | null | undefined,
  def: string | null | undefined,
  extra: string | null | undefined,
): string {
  let s = type ?? "";
  if (nullable === false) s += " NOT NULL";
  if (def != null && def !== "") {
    const upper = def.toUpperCase();
    s +=
      upper === "CURRENT_TIMESTAMP" || upper === "NULL"
        ? ` DEFAULT ${upper}`
        : ` DEFAULT ${escapeMysqlString(def)}`;
  }
  if (extra && extra.includes("auto_increment")) s += " AUTO_INCREMENT";
  return s;
}

/**
 * ALTER statements that reshape the TARGET table to match the SOURCE side
 * of a structure diff (source wins). Column changes fold into one ALTER;
 * each index change is its own statement. Returns [] when nothing to do.
 */
export function buildAlterStatements(
  database: string,
  diff: CompareTableDiff,
): string[] {
  const table = `${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(diff.table)}`;
  const out: string[] = [];

  const colClauses: string[] = [];
  for (const c of diff.columnDiffs) {
    const name = escapeMysqlIdentifier(c.name);
    if (c.kind === "added") {
      colClauses.push(
        `ADD COLUMN ${name} ${columnDefinition(c.sourceType, c.sourceNullable, c.sourceDefault, c.sourceExtra)}`,
      );
    } else if (c.kind === "removed") {
      colClauses.push(`DROP COLUMN ${name}`);
    } else if (c.kind === "changed") {
      colClauses.push(
        `MODIFY COLUMN ${name} ${columnDefinition(c.sourceType, c.sourceNullable, c.sourceDefault, c.sourceExtra)}`,
      );
    }
  }
  if (colClauses.length > 0) {
    out.push(`ALTER TABLE ${table} ${colClauses.join(", ")};`);
  }

  for (const ix of diff.indexDiffs) {
    const ixName = escapeMysqlIdentifier(ix.name);
    if (ix.name === "PRIMARY") {
      if (ix.kind === "removed") {
        out.push(`ALTER TABLE ${table} DROP PRIMARY KEY;`);
      } else {
        out.push(
          `ALTER TABLE ${table} DROP PRIMARY KEY, ADD PRIMARY KEY (${ix.sourceColumns.map(escapeMysqlIdentifier).join(", ")});`,
        );
      }
      continue;
    }
    const addClause = `ADD ${ix.sourceUnique ? "UNIQUE " : ""}INDEX ${ixName} (${ix.sourceColumns.map(escapeMysqlIdentifier).join(", ")})`;
    if (ix.kind === "added") {
      out.push(`ALTER TABLE ${table} ${addClause};`);
    } else if (ix.kind === "removed") {
      out.push(`ALTER TABLE ${table} DROP INDEX ${ixName};`);
    } else {
      out.push(`ALTER TABLE ${table} DROP INDEX ${ixName}, ${addClause};`);
    }
  }

  return out;
}

/** One condition of an AG Grid column filter (fields we consume). */
export interface AgGridFilterCondition {
  filterType?: string;
  type?: string;
  filter?: string | number | null;
  filterTo?: string | number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

/** One column's AG Grid filter model: a condition, or two joined by an operator. */
export interface AgGridFilterModelEntry extends AgGridFilterCondition {
  operator?: string;
  condition1?: AgGridFilterCondition;
  condition2?: AgGridFilterCondition;
}

/**
 * Turn an AG Grid filter model into a full-table `SELECT ... WHERE ...` so
 * a column search runs against the whole table instead of only the rows
 * already loaded in the grid. Returns null for an empty model or when no
 * condition translates to SQL.
 */
export function buildTableSearchSql(
  database: string,
  table: string,
  filterModel: Record<string, AgGridFilterModelEntry | null | undefined>,
): string | null {
  const conds: string[] = [];
  for (const [field, entry] of Object.entries(filterModel)) {
    const cond = entry ? buildFilterColumnCondition(field, entry) : null;
    if (cond) conds.push(cond);
  }
  if (conds.length === 0) return null;
  return `SELECT * FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)} WHERE ${conds.join(" AND ")};`;
}

function buildFilterColumnCondition(
  field: string,
  entry: AgGridFilterModelEntry,
): string | null {
  const col = escapeMysqlIdentifier(field);
  if (entry.operator && entry.condition1 && entry.condition2) {
    const join = entry.operator.toUpperCase() === "OR" ? "OR" : "AND";
    const a = buildFilterSimpleCondition(col, entry.condition1);
    const b = buildFilterSimpleCondition(col, entry.condition2);
    if (a && b) return `(${a} ${join} ${b})`;
    return a ?? b;
  }
  return buildFilterSimpleCondition(col, entry);
}

function buildFilterSimpleCondition(
  col: string,
  c: AgGridFilterCondition,
): string | null {
  switch (c.filterType) {
    case "text": {
      const v = c.filter === null || c.filter === undefined ? "" : String(c.filter);
      switch (c.type) {
        case "contains":
          return `${col} LIKE ${escapeMysqlString(`%${v}%`)}`;
        case "notContains":
          return `${col} NOT LIKE ${escapeMysqlString(`%${v}%`)}`;
        case "equals":
          return `${col} = ${escapeMysqlString(v)}`;
        case "notEqual":
          return `${col} <> ${escapeMysqlString(v)}`;
        case "startsWith":
          return `${col} LIKE ${escapeMysqlString(`${v}%`)}`;
        case "endsWith":
          return `${col} LIKE ${escapeMysqlString(`%${v}`)}`;
        case "blank":
          return `(${col} IS NULL OR ${col} = '')`;
        case "notBlank":
          return `(${col} IS NOT NULL AND ${col} <> '')`;
        default:
          return null;
      }
    }
    case "number": {
      const v = Number(c.filter);
      const vTo = Number(c.filterTo);
      const ok = (n: number) => Number.isFinite(n);
      switch (c.type) {
        case "equals":
          return ok(v) ? `${col} = ${v}` : null;
        case "notEqual":
          return ok(v) ? `${col} <> ${v}` : null;
        case "lessThan":
          return ok(v) ? `${col} < ${v}` : null;
        case "lessThanOrEqual":
          return ok(v) ? `${col} <= ${v}` : null;
        case "greaterThan":
          return ok(v) ? `${col} > ${v}` : null;
        case "greaterThanOrEqual":
          return ok(v) ? `${col} >= ${v}` : null;
        case "inRange":
          return ok(v) && ok(vTo) ? `${col} BETWEEN ${v} AND ${vTo}` : null;
        case "blank":
          return `${col} IS NULL`;
        case "notBlank":
          return `${col} IS NOT NULL`;
        default:
          return null;
      }
    }
    case "date": {
      // Day-granular comparisons so the same SQL matches DATE and DATETIME
      // columns alike (the whole day [d 00:00:00, d+1 00:00:00)).
      const asDate = (d: unknown): string =>
        d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "");
      const from = asDate(c.dateFrom);
      const dayAfter = (d: string) => `DATE_ADD(${escapeMysqlString(d)}, INTERVAL 1 DAY)`;
      switch (c.type) {
        case "equals":
          return from
            ? `(${col} >= ${escapeMysqlString(from)} AND ${col} < ${dayAfter(from)})`
            : null;
        case "notEqual":
          return from
            ? `NOT (${col} >= ${escapeMysqlString(from)} AND ${col} < ${dayAfter(from)})`
            : null;
        case "lessThan":
          return from ? `${col} < ${escapeMysqlString(from)}` : null;
        case "lessThanOrEqual":
          return from ? `${col} < ${dayAfter(from)}` : null;
        case "greaterThan":
          return from ? `${col} >= ${dayAfter(from)}` : null;
        case "greaterThanOrEqual":
          return from ? `${col} >= ${escapeMysqlString(from)}` : null;
        case "inRange":
          return from && c.dateTo
            ? `(${col} >= ${escapeMysqlString(from)} AND ${col} < ${dayAfter(asDate(c.dateTo))})`
            : null;
        case "blank":
          return `${col} IS NULL`;
        case "notBlank":
          return `${col} IS NOT NULL`;
        default:
          return null;
      }
    }
    default:
      return null;
  }
}
