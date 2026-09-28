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
 * Orders by primary key when available so OFFSET paging is stable.
 */
export function buildTableSelect(
  database: string,
  table: string,
  primaryKeyColumns: string[],
  offset: number,
  pageSize: number,
): string {
  const from = `SELECT * FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)}`;
  const order = primaryKeyColumns.length
    ? ` ORDER BY ${primaryKeyColumns.map(escapeMysqlIdentifier).join(", ")}`
    : "";
  return `${from}${order} LIMIT ${offset}, ${pageSize};`;
}

/** Build the exact row-count query for a table browse session. */
export function buildCountSql(database: string, table: string): string {
  return `SELECT COUNT(*) FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)};`;
}
