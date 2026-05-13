/**
 * 将多语句 SQL 按分号分割为独立语句。
 * 简单处理字符串字面量中的分号，忽略注释中的分号。
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (const char of sql) {
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
