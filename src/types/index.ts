export interface ConnectionConfig {
  id: string;
  name: string;
  type: "mysql";
  host: string;
  port: number;
  username: string;
  password?: string;
  database?: string;
  maxConnections?: number;
  sslMode?: "disabled" | "required" | "verify-ca" | "verify-full";
  sslCertPath?: string;
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
  referencedTable: string;
  referencedColumn: string;
  updateRule: string;
  deleteRule: string;
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
