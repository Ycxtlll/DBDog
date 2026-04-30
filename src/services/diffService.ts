import { invoke } from '@tauri-apps/api/core';
import type { DatabaseSnapshot, SchemaDiff } from '../types/diff';

export const diffService = {
  captureSnapshot: (connectionId: string, database: string, name?: string) =>
    invoke<DatabaseSnapshot>('capture_snapshot', { connectionId, database, name }),

  listSnapshots: (connectionId?: string) =>
    invoke<DatabaseSnapshot[]>('list_snapshots', { connectionId }),

  deleteSnapshot: (id: string) =>
    invoke<void>('delete_snapshot', { id }),

  compareSnapshots: (fromId: string, toId: string) =>
    invoke<SchemaDiff>('compare_snapshots', { fromId, toId }),

  generateMigrationSql: (diff: SchemaDiff) =>
    invoke<string[]>('generate_migration_sql', { diff }),
};