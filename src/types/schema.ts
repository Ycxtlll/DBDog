export interface TableInfo {
  name: string;
  schema: string;
  table_type: string;
  row_count?: number;
  comment?: string;
}

export interface TableDetail {
  table: TableInfo;
  columns: import('./query').ColumnInfo[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
  create_sql: string;
}

export interface ForeignKeyInfo {
  name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  on_delete: string;
  on_update: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
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

export interface SchemaSearchHit {
  database: string;
  object_type: string;
  object_name: string;
  parent?: string;
  match_field: string;
}
