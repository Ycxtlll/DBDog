//! Authoritative SQL statement parsing and safety guards.
//!
//! Backend port of the frontend helpers (src/lib/sql.ts / queryStore.ts):
//! statement splitting, top-level WHERE detection and the LIMIT wrapper.
//! The frontend copies stay as UX pre-flight (confirm dialogs, cursor
//! statement location); THESE are the versions that decide what actually
//! runs — every execution path validates here before touching the driver.

/// Split a multi-statement script on top-level semicolons. String literals
/// (`'`, `"`, backtick identifiers), escaped characters and comments
/// (`-- `, `#`, `/* */`) never terminate a statement. Faithful port of
/// `splitSqlStatements`.
pub fn split_statements(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut statements: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut string_char = '\0';
    let mut escaped = false;

    let mut i = 0usize;
    while i < chars.len() {
        let char = chars[i];
        let next = chars.get(i + 1).copied().unwrap_or('\0');

        if escaped {
            current.push(char);
            escaped = false;
            i += 1;
            continue;
        }
        if char == '\\' {
            current.push(char);
            escaped = true;
            i += 1;
            continue;
        }
        if in_string {
            current.push(char);
            if char == string_char {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if char == '\'' || char == '"' || char == '`' {
            in_string = true;
            string_char = char;
            current.push(char);
            i += 1;
            continue;
        }
        // Line comments: `-- ` (MySQL requires whitespace after --, missing
        // trailing input counts as whitespace), `#`.
        let next2_ws = chars.get(i + 2).copied().map_or(true, |c| c.is_whitespace());
        if char == '-' && next == '-' && next2_ws {
            while i < chars.len() && chars[i] != '\n' {
                current.push(chars[i]);
                i += 1;
            }
            if i < chars.len() {
                current.push('\n');
                i += 1; // the for-loop in the TS original consumed the newline
            }
            continue;
        }
        if char == '#' {
            while i < chars.len() && chars[i] != '\n' {
                current.push(chars[i]);
                i += 1;
            }
            if i < chars.len() {
                current.push('\n');
                i += 1;
            }
            continue;
        }
        // Block comment.
        if char == '/' && next == '*' {
            current.push_str("/*");
            i += 2;
            while i < chars.len()
                && !(chars[i] == '*' && chars.get(i + 1).copied() == Some('/'))
            {
                current.push(chars[i]);
                i += 1;
            }
            current.push_str("*/");
            i += 2;
            continue;
        }
        if char == ';' {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                statements.push(trimmed);
            }
            current.clear();
            i += 1;
            continue;
        }
        current.push(char);
        i += 1;
    }

    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        statements.push(trimmed);
    }
    statements
}

/// True when the statement carries a WHERE clause at the TOP level — outside
/// string literals, comments and parenthesized subqueries. Faithful port of
/// `hasTopLevelWhere`.
pub fn has_top_level_where(stmt: &str) -> bool {
    let chars: Vec<char> = stmt.chars().collect();
    let mut in_string = false;
    let mut string_char = '\0';
    let mut escaped = false;
    let mut depth = 0usize;
    let mut word = String::new();

    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied().unwrap_or('\0');

        if escaped {
            escaped = false;
            i += 1;
            continue;
        }
        if c == '\\' {
            escaped = true;
            i += 1;
            continue;
        }
        if in_string {
            if c == string_char {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if c == '\'' || c == '"' || c == '`' {
            in_string = true;
            string_char = c;
            i += 1;
            continue;
        }
        let next2_ws = chars.get(i + 2).copied().map_or(true, |c| c.is_whitespace());
        if c == '-' && next == '-' && next2_ws {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '#' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && next == '*' {
            i += 2;
            while i < chars.len()
                && !(chars[i] == '*' && chars.get(i + 1).copied() == Some('/'))
            {
                i += 1;
            }
            i += 1;
            continue;
        }
        if c == '(' {
            depth += 1;
            i += 1;
            continue;
        }
        if c == ')' {
            depth = depth.saturating_sub(1);
            i += 1;
            continue;
        }
        if depth > 0 {
            i += 1;
            continue;
        }
        if c.is_ascii_alphanumeric() || c == '_' || c == '$' {
            word.push(c);
            i += 1;
            continue;
        }
        if word.to_ascii_uppercase() == "WHERE" {
            return true;
        }
        word.clear();
        i += 1;
    }
    word.to_ascii_uppercase() == "WHERE"
}

/// Standalone word tokens, lowercased (identifiers keep digits/_/$ like the
/// frontend's word regex).
fn words(stmt: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in stmt.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '$' {
            cur.push(c.to_ascii_lowercase());
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Wrap an unbounded SELECT/WITH in `SELECT * FROM (...) LIMIT n`. Kept
/// deliberately naive like the frontend original: any standalone `limit`
/// word (even inside a string literal) counts as bounded, and FOR
/// UPDATE/SHARE statements are left alone. Conservative direction — the
/// wrapper never makes a query read MORE rows.
pub fn limit_guard(stmt: &str, limit: u32) -> String {
    let n = limit.max(1);
    let ws = words(stmt);
    match ws.first().map(|w| w.as_str()) {
        Some("select") | Some("with") => {}
        _ => return stmt.to_string(),
    }
    if ws.contains(&"limit".to_string()) {
        return stmt.to_string();
    }
    for pair in ws.windows(2) {
        if pair[0] == "for" && (pair[1] == "update" || pair[1] == "share") {
            return stmt.to_string();
        }
    }
    let trimmed = stmt.trim_end_matches(|c: char| c.is_whitespace() || c == ';');
    format!("SELECT * FROM (\n{trimmed}\n) _dbdog_limited LIMIT {n}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatementKind {
    /// `USE <db>` with the parsed database name.
    Use(String),
    /// SELECT / SHOW / DESCRIBE / DESC / EXPLAIN / WITH.
    Query,
    /// Anything else (DML/DDL) — `kind` is the first word, uppercased.
    Update(String),
}

/// Classify a statement by its first word (faithful port of the frontend's
/// head-word check, including the "comment prefix makes it an Update"
/// behavior).
pub fn classify_statement(stmt: &str) -> StatementKind {
    let head = stmt
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    match head.as_str() {
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "WITH" => StatementKind::Query,
        "USE" => {
            // ^USE\s+`?([^`\s]+)`?$
            let rest = stmt[3..].trim();
            let name = rest.trim_matches('`');
            if !name.is_empty() && !name.contains(['`', ' ', '\t', '\n', '\r']) {
                StatementKind::Use(name.to_string())
            } else {
                StatementKind::Update("USE".to_string())
            }
        }
        other => StatementKind::Update(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_respects_strings_and_comments() {
        let sql = "SELECT 1; SELECT 'a;b' AS x; -- c;omment\nSELECT `ta;ble` FROM t /* ; */";
        let out = split_statements(sql);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], "SELECT 1");
        assert_eq!(out[1], "SELECT 'a;b' AS x");
        // The leading line comment stays part of the statement text (TS does
        // the same); the semicolon inside the block comment must not split.
        assert!(out[2].contains("SELECT `ta;ble` FROM t /* ; */"));
    }

    #[test]
    fn split_handles_escaped_quote_and_empty_parts() {
        let out = split_statements("SELECT 'it\\'s'; ; ; SELECT 2;");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], "SELECT 'it\\'s'");
    }

    #[test]
    fn split_dash_dash_requires_whitespace() {
        // "a--b" is NOT a comment in MySQL; "a-- b" is.
        assert_eq!(split_statements("SELECT a--b; SELECT 1").len(), 2);
        let out = split_statements("SELECT a-- b\nSELECT 1");
        assert_eq!(out.len(), 1);
        assert!(out[0].contains("-- b\nSELECT 1"));
    }

    #[test]
    fn classify_use_with_space_backticked_is_not_use() {
        // A database name containing a space cannot be parsed by the
        // frontend's regex either — such scripts stay unclassified (Update).
        assert_eq!(
            classify_statement("USE `my db`"),
            StatementKind::Update("USE".into())
        );
        assert_eq!(classify_statement("USE `mydb`"), StatementKind::Use("mydb".into()));
    }

    #[test]
    fn top_level_where_basics() {
        assert!(has_top_level_where("UPDATE t SET a = 1 WHERE id = 2"));
        assert!(has_top_level_where("delete from t where x is not null"));
        assert!(!has_top_level_where("UPDATE t SET a = 1"));
        // WHERE inside a subquery does not count (matches frontend behavior).
        assert!(!has_top_level_where(
            "UPDATE t SET a = (SELECT b FROM x WHERE x.id = 1)"
        ));
        // WHERE inside a string literal does not count.
        assert!(!has_top_level_where("UPDATE t SET a = 'where'"));
    }

    #[test]
    fn top_level_where_skips_comments() {
        assert!(!has_top_level_where("UPDATE t SET a = 1 -- WHERE marker\n"));
        assert!(has_top_level_where("UPDATE /* where */ t SET a = 1 WHERE id = 1"));
    }

    #[test]
    fn limit_guard_wraps_unbounded_select() {
        let out = limit_guard("SELECT * FROM t", 1000);
        assert!(out.starts_with("SELECT * FROM (\nSELECT * FROM t\n) _dbdog_limited LIMIT 1000"));
    }

    #[test]
    fn limit_guard_passthrough_cases() {
        assert_eq!(limit_guard("SELECT * FROM t LIMIT 10", 1000), "SELECT * FROM t LIMIT 10");
        assert_eq!(limit_guard("SELECT * FROM t FOR UPDATE", 1000), "SELECT * FROM t FOR UPDATE");
        assert_eq!(limit_guard("UPDATE t SET a = 1", 1000), "UPDATE t SET a = 1");
        // Trailing semicolon is stripped before wrapping.
        let out = limit_guard("SELECT 1;", 10);
        assert!(out.ends_with("LIMIT 10"));
        assert!(!out.contains(";"));
    }

    #[test]
    fn classify_use_query_update() {
        assert_eq!(classify_statement("USE `mydb`"), StatementKind::Use("mydb".into()));
        assert_eq!(classify_statement("use test"), StatementKind::Use("test".into()));
        assert_eq!(classify_statement("SELECT 1"), StatementKind::Query);
        assert_eq!(classify_statement("  with c as (select 1) select * from c"), StatementKind::Query);
        assert_eq!(
            classify_statement("UPDATE t SET a = 1"),
            StatementKind::Update("UPDATE".into())
        );
        assert_eq!(classify_statement("SET @x = 1"), StatementKind::Update("SET".into()));
    }
}
