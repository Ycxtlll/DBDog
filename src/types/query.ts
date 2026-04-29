export interface ColumnInfo {
  name: string;
  ordinal: number;
  type_name: string;
  nullable: boolean;
  is_primary_key: boolean;
  auto_increment: boolean;
  default_value?: string;
  comment?: string;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  execution_time_ms: number;
}

export interface UpdateResult {
  rows_affected: number;
  last_insert_id?: number;
  execution_time_ms: number;
}

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  result?: QueryResult;
  updateResult?: UpdateResult;
  isExecuting: boolean;
  error?: string;
  connectionId?: string;
  database?: string;
}
