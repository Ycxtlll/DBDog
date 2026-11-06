
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
