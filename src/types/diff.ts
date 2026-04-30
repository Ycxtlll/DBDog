import { TableDetail, TableInfo, TriggerInfo, ColumnInfo, IndexInfo, ForeignKeyInfo } from './schema';

export interface DatabaseSnapshot {
  id: string;
  connection_id: string;
  database_name: string;
  captured_at: string;
  tables: TableDetail[];
  views: TableInfo[];
  triggers: TriggerInfo[];
}

export type SchemaChange =
  | { TableAdded: { table: TableDetail } }
  | { TableDropped: { table: TableInfo } }
  | { TableModified: { table_name: string; columns_added: ColumnInfo[]; columns_dropped: ColumnInfo[]; columns_modified: ColumnInfo[]; indexes_added: IndexInfo[]; indexes_dropped: IndexInfo[]; foreign_keys_added: ForeignKeyInfo[]; foreign_keys_dropped: ForeignKeyInfo[] } }
  | { ViewAdded: { view: TableInfo } }
  | { ViewDropped: { view: TableInfo } }
  | { TriggerAdded: { trigger: TriggerInfo } }
  | { TriggerDropped: { trigger: TriggerInfo } };

export interface SchemaDiff {
  from_snapshot_id: string;
  to_snapshot_id: string;
  changes: SchemaChange[];
}