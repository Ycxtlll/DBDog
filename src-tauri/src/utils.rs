/// Escapes a MySQL identifier (database name, table name, column name)
/// by wrapping it in backticks and doubling any existing backticks.
///
/// This follows the standard MySQL identifier escaping rule:
/// a single backtick (`) inside an identifier becomes two backticks (``).
pub fn escape_mysql_identifier(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

/// Validates that a MySQL thread ID is non-zero.
/// A thread ID of 0 is invalid for KILL QUERY operations.
pub fn validate_thread_id(id: u64) -> Result<u64, String> {
    if id == 0 {
        Err("Invalid thread ID: 0".to_string())
    } else {
        Ok(id)
    }
}
