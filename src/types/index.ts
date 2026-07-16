export interface ConnectionConfig {
  id: string;
  name: string;
  type: "mysql" | "memcached" | "zookeeper";
  host: string;
  port: number;
  username: string;
  password?: string;
  database?: string;
  maxConnections?: number;
  sslMode?: "disabled" | "required" | "verify-ca" | "verify-full";
  sslCertPath?: string;
  group?: string;
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
  /** When set, the result grid enables inline editing for this table */
  editableTable?: { database: string; table: string; primaryKeyColumns: string[] };
}

export interface QueryHistoryItem {
  sql: string;
  timestamp: number;
  status: "success" | "error";
  error?: string;
  elapsedMs?: number;
  rowsCount?: number;
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
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
