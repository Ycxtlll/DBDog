CREATE TABLE IF NOT EXISTS query_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    connection_name TEXT NOT NULL,
    database_name TEXT,
    sql TEXT NOT NULL,
    duration_ms INTEGER,
    row_count INTEGER,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_query_history_connection ON query_history(connection_id);
CREATE INDEX IF NOT EXISTS idx_query_history_created ON query_history(created_at DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    folder TEXT,
    tags TEXT, -- JSON array
    sql TEXT NOT NULL,
    placeholders TEXT, -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);

CREATE TABLE IF NOT EXISTS schema_snapshots (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    database_name TEXT NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    snapshot_json TEXT NOT NULL,
    FOREIGN KEY (connection_id) REFERENCES query_history(connection_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_connection ON schema_snapshots(connection_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_database ON schema_snapshots(database_name);
