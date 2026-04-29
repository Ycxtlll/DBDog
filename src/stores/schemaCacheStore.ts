import { create } from 'zustand';
import type { ColumnInfo } from '../types/query';
import type { TableInfo } from '../types/schema';

interface SchemaEntry {
  databases: string[];
  tables: Record<string, TableInfo[]>; // database -> tables
  columns: Record<string, ColumnInfo[]>; // "database.table" -> columns
}

interface SchemaCacheState {
  caches: Record<string, SchemaEntry>; // connectionId -> schema

  setDatabases: (connectionId: string, databases: string[]) => void;
  setTables: (connectionId: string, database: string, tables: TableInfo[]) => void;
  setColumns: (connectionId: string, database: string, table: string, columns: ColumnInfo[]) => void;
  getDatabases: (connectionId: string) => string[];
  getTables: (connectionId: string, database: string) => TableInfo[];
  getColumns: (connectionId: string, database: string, table: string) => ColumnInfo[];
  getAllTableNames: (connectionId: string, database: string) => string[];
  getAllColumnNames: (connectionId: string, database: string, table: string) => string[];
  clearConnection: (connectionId: string) => void;
}

const getOrCreate = (caches: Record<string, SchemaEntry>, connectionId: string): SchemaEntry => {
  if (!caches[connectionId]) {
    caches[connectionId] = { databases: [], tables: {}, columns: {} };
  }
  return caches[connectionId];
};

export const useSchemaCacheStore = create<SchemaCacheState>((set, get) => ({
  caches: {},

  setDatabases: (connectionId, databases) => {
    set((s) => {
      const caches = { ...s.caches };
      const entry = getOrCreate(caches, connectionId);
      caches[connectionId] = { ...entry, databases };
      return { caches };
    });
  },

  setTables: (connectionId, database, tables) => {
    set((s) => {
      const caches = { ...s.caches };
      const entry = getOrCreate(caches, connectionId);
      caches[connectionId] = { ...entry, tables: { ...entry.tables, [database]: tables } };
      return { caches };
    });
  },

  setColumns: (connectionId, database, table, columns) => {
    set((s) => {
      const key = `${database}.${table}`;
      const caches = { ...s.caches };
      const entry = getOrCreate(caches, connectionId);
      caches[connectionId] = { ...entry, columns: { ...entry.columns, [key]: columns } };
      return { caches };
    });
  },

  getDatabases: (connectionId) => get().caches[connectionId]?.databases || [],
  getTables: (connectionId, database) => get().caches[connectionId]?.tables[database] || [],
  getColumns: (connectionId, database, table) =>
    get().caches[connectionId]?.columns[`${database}.${table}`] || [],

  getAllTableNames: (connectionId, database) =>
    get().caches[connectionId]?.tables[database]?.map((t) => t.name) || [],

  getAllColumnNames: (connectionId, database, table) =>
    get().caches[connectionId]?.columns[`${database}.${table}`]?.map((c) => c.name) || [],

  clearConnection: (connectionId) => {
    set((s) => {
      const { [connectionId]: _, ...rest } = s.caches;
      return { caches: rest };
    });
  },
}));
