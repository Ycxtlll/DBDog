import type { ColumnInfo } from './query';

export interface TableInfo {
  name: string;
  schema: string;
  table_type: string;
  row_count?: number;
  comment?: string;
}

export interface TableDetail {
  table: TableInfo;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
  create_sql: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
}

export interface ForeignKeyInfo {
  name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  on_delete: string;
  on_update: string;
}

export interface TriggerInfo {
  name: string;
  event: string;
  timing: string;
  statement: string;
}

export interface ProcessInfo {
  id: number;
  user: string;
  host: string;
  db?: string;
  command: string;
  time: number;
  state?: string;
  info?: string;
}

export interface StatusVariable {
  name: string;
  value: string;
}

export interface SystemVariable {
  name: string;
  value: string;
  is_global: boolean;
  is_session: boolean;
}

export interface InnodbStatus {
  raw_text: string;
  active_transactions?: number;
  lock_waits?: number;
  buffer_pool_hits?: number;
  buffer_pool_reads?: number;
}

export interface SchemaSearchHit {
  database: string;
  object_type: string;
  object_name: string;
  parent?: string;
  match_field: string;
}
