

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
