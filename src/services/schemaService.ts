import { invoke } from '@tauri-apps/api/core';
import type { TableInfo, TableDetail, IndexInfo, ForeignKeyInfo, ProcessInfo } from '../types/schema';
import type { ColumnInfo } from '../types/query';

export const schemaService = {
  listDatabases: (connectionId: string, useCache = true) =>
    invoke<string[]>('list_databases', { connectionId, useCache }),

  listTables: (connectionId: string, database: string, filter?: string, useCache = true) =>
    invoke<TableInfo[]>('list_tables', { connectionId, database, filter, useCache }),

  describeTable: (connectionId: string, database: string, table: string) =>
    invoke<TableDetail>('describe_table', { connectionId, database, table }),

  getCreateTableSql: (connectionId: string, database: string, table: string) =>
    invoke<string>('get_create_table_sql', { connectionId, database, table }),

  refreshSchema: (connectionId: string, database?: string) =>
    invoke<void>('refresh_schema', { connectionId, database }),

  getColumns: (connectionId: string, database: string, table: string, useCache = true) =>
    invoke<ColumnInfo[]>('get_columns', { connectionId, database, table, useCache }),

  getIndexes: (connectionId: string, database: string, table: string) =>
    invoke<IndexInfo[]>('get_indexes', { connectionId, database, table }),

  getForeignKeys: (connectionId: string, database: string, table: string) =>
    invoke<ForeignKeyInfo[]>('get_foreign_keys', { connectionId, database, table }),

  listViews: (connectionId: string, database: string) =>
    invoke<string[]>('list_views', { connectionId, database }),
};

export const healthService = {
  getProcessList: (connectionId: string) =>
    invoke<ProcessInfo[]>('get_process_list', { connectionId }),

  getStatusVariables: (connectionId: string) =>
    invoke<{ name: string; value: string }[]>('get_status_variables', { connectionId }),

  getSystemVariables: (connectionId: string) =>
    invoke<{ name: string; value: string }[]>('get_system_variables', { connectionId }),

  getInnodbStatus: (connectionId: string) =>
    invoke<any>('get_innodb_status', { connectionId }),

  killProcess: (connectionId: string, processId: number) =>
    invoke<void>('kill_process', { connectionId, processId }),
};
