export interface ConnectionConfig {
  id: string;
  name: string;
  type: "mysql" | "postgresql" | "memcached" | "zookeeper";
  host: string;
  port: number;
  username: string;
  password?: string;
  /** Opaque stored-credential marker echoed back by the backend (never the
   *  plaintext password) — lets the UI know a password is saved. */
  passwordHash?: string;
  database?: string;
  maxConnections?: number;
  sslMode?: "disabled" | "required" | "verify-ca" | "verify-full";
  sslCertPath?: string;
  group?: string;
  /** SSH tunnel (system `ssh -N -L`, key/agent auth only). */
  sshEnabled?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
  /** Safety switch: the engine rejects every write on this connection. */
  readOnly?: boolean;
}

/** One staged grid modification, applied later in a single transaction. */
export interface PendingChange {
  id: string;
  kind: "update" | "delete" | "insert";
  sql: string;
  /** Reverse statement (recorded to history when the batch applies). */
  rollbackSql: string;
  /** Fully qualified target table. */
  table: string;
  database: string;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface ServerInfo {
  version: string;
  connectionId: string;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  totalCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface UpdateResult {
  rowsAffected: number;
  lastInsertId?: number;
  elapsedMs: number;
}

/** Per-statement execution report from `execute_script`. */
export interface StatementOutcome {
  kind: string;
  sql: string;
  rowsAffected: number;
  elapsedMs: number;
}

/** Result of backend-guarded script execution (MySQL). */
export interface ScriptExecutionResult {
  statements: StatementOutcome[];
  finalResult?: QueryResult;
  finalIsQuery: boolean;
  finalRowsAffected: number;
  totalRows: number;
  /** Effective database after any USE statements in the script. */
  lastDatabase?: string;
  elapsedMs: number;
}

/** Logical foreign key sources, highest confidence first. */
export type RelationshipSource = "declared" | "imported" | "adjudicated" | "inferred";

/** One logical link: childTable.childColumn → parentTable.parentColumn. */
export interface TableRelationship {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
  source: RelationshipSource;
  /** 0–1; declared/adjudicated are 1, inferred carries the probe hit rate. */
  confidence: number;
  joinHint: "left" | "right" | null;
}

/** A child table referencing the browsed table (reverse direction). */
export interface ReverseReference {
  childTable: string;
  childColumn: string;
  /** Column of OUR table being referenced (usually the primary key). */
  parentColumn: string;
  source: RelationshipSource;
  /** Inferred only: share of sampled keys found in the child column. */
  confidence: number;
}

export interface RelationshipsOverview {
  relationships: TableRelationship[];
  referencedBy: ReverseReference[];
}

export interface RelationshipImportResult {
  imported: number;
  skipped: number;
  errors: { line: number; reason: string }[];
}

export interface Database {
  name: string;
  charset?: string;
  collation?: string;
}

export interface Table {
  name: string;
  engine?: string;
  rows?: number;
  sizeMb?: number;
  comment?: string;
}

export interface Column {
  name: string;
  ordinalPosition: number;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  defaultValue?: string;
  comment?: string;
  maxLength?: number;
  /** Raw Extra from SHOW FULL COLUMNS: "auto_increment", "DEFAULT_GENERATED", "on update current_timestamp()"... */
  extra?: string;
}

export interface Index {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  indexType: string;
}

export interface ForeignKey {
  name: string;
  column: string;
  referencedTable?: string;
  referencedColumn?: string;
  updateRule?: string;
  deleteRule?: string;
}

export interface Trigger {
  name: string;
  event: string;
  timing: string;
  statement: string;
}

export interface TableDetails {
  columns: Column[];
  indexes: Index[];
  foreignKeys: ForeignKey[];
  triggers: Trigger[];
  createTableSql: string;
}

export interface SearchResult {
  database: string;
  objectType: string;
  objectName: string;
  columnName?: string;
}

/** database → table → column names, for SQL editor completion. */
export type CompletionSchema = Record<string, Record<string, string[]>>;

export interface QueryTab {
  id: string;
  name: string;
  sql: string;
  result?: QueryResult | UpdateResult;
  isExecuting: boolean;
  isCancelled: boolean;
  error?: string;
  selectedDatabase?: string;
  isQueryResult?: boolean;
  /** The exact SQL that produced the current result — used for grid refresh. */
  executedSql?: string;
  /** The row limit used for executedSql. */
  executedLimit?: number;
  /** Staged grid modifications, applied later in one transaction (M4). */
  pendingChanges?: PendingChange[];
  /** Rollback statements of the last applied changeset — Ctrl+Z target. */
  lastAppliedRollbacks?: string[];
  /** When set, this tab is browsing a table with server-side pagination.
   *  Also enables inline cell editing for the browsed table. */
  tableBrowse?: TableBrowseState;
}

export interface TableBrowseState {
  database: string;
  table: string;
  primaryKeyColumns: string[];
  /** Server-side page size (rows per fetch). */
  pageSize: number;
  /** 1-based page number. */
  page: number;
  /** Total row count from COUNT(*). Unknown while loading or if the count failed. */
  totalRows?: number;
  /** Server-side sort for browsing (header click). Null/undefined = primary-key order. */
  sort?: { col: string; dir: "asc" | "desc" } | null;
  /** What the grid is currently showing. Structured replacement for the old
   *  "executedSql === generated select" string comparison:
   *  browse = paged plain SELECT (pager visible, filters/sort can search);
   *  filterSearch = the generated filter SQL; custom = arbitrary user SQL. */
  browseMode?: "browse" | "filterSearch" | "custom";
  /** Full-table search SQL generated from the grid's column filters,
   *  while that search is what the tab is showing. */
  filterSql?: string;
}

export interface QueryHistoryItem {
  sql: string;
  timestamp: number;
  status: "success" | "error";
  error?: string;
  elapsedMs?: number;
  rowsCount?: number;
  /** Reverse statement generated after an inline cell edit / row delete. */
  kind?: "rollback";
}

export interface AppSettings {
  theme: "light" | "dark" | "system" | import("../lib/themes").SkinId;
  language: "en" | "zh";
  editor: {
    tabSize: 2 | 4 | 8;
    fontSize: number;
    vimMode: boolean;
    autoComplete: boolean;
    wordWrap: boolean;
  };
  query: {
    defaultLimit: number;
    cancelOnNavigate: boolean;
  };
  performance: {
    connectionTimeoutSecs: number;
    schemaCacheTtlSecs: number;
    maxPoolSize: number;
  };
}

// ── ZooKeeper ──

export interface ZkNode {
  path: string;
  data: string;
  dataLength: number;
  numChildren: number;
  czxid: number;
  mzxid: number;
  ctime: number;
  mtime: number;
  version: number;
  childVersion: number;
  aclVersion: number;
  ephemeralOwner: number;
  pzxid: number;
}

export interface ZkChildList {
  path: string;
  children: string[];
  totalChildren: number;
  truncated: boolean;
}

export interface ZkTreeNode {
  name: string;
  path: string;
  numChildren: number;
  isEphemeral: boolean;
  children?: ZkTreeNode[];
}

export interface ZkServerInfo {
  mode: string;
  version: string;
  znodeCount: number;
  connections: number;
  outstanding: number;
  latencyAvg: number;
  latencyMin: number;
  latencyMax: number;
  received: number;
  sent: number;
}

// ── Memcached ──

export interface MemcachedEntry {
  key: string;
  flags: number;
  sizeBytes: number;
  expiration: number | null;
  value: string | null;
}

export interface MemcachedKeyList {
  keys: string[];
  totalKeys: number;
  truncated: boolean;
}

export interface MemcachedServerInfo {
  version: string;
  uptimeSeconds: number;
  currItems: number;
  totalItems: number;
  bytesUsed: number;
  limitMaxbytes: number;
  currConnections: number;
  totalConnections: number;
}

// ── MySQL server panel ──

export interface ProcessRow {
  id: number;
  user: string;
  host: string;
  db: string | null;
  command: string;
  timeSecs: number;
  state: string | null;
  info: string | null;
}

export interface ServerVariable {
  name: string;
  value: string | null;
}

export interface DiagnosticStep {
  /** Machine key: resolve | tcp | handshake | auth | grants. */
  name: string;
  ok: boolean;
  detail: string;
  latencyMs: number | null;
}

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
}

// ── Structure comparison ──

export interface CompareColumnDiff {
  name: string;
  /** "added" = only in source, "removed" = only in target, "changed" = both. */
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

export interface StructureDiffReport {
  sourceDatabase: string;
  targetDatabase: string;
  tablesOnlyInSource: string[];
  tablesOnlyInTarget: string[];
  changedTables: CompareTableDiff[];
  identicalTables: string[];
}
