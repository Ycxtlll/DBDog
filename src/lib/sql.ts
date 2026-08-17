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

/**
 * Escape a MySQL identifier (database/table/column) for inline SQL by
 * wrapping it in backticks and doubling any embedded backticks.
 */
export function escapeMysqlIdentifier(ident: string): string {
  return "`" + ident.replace(/`/g, "``") + "`";
}
