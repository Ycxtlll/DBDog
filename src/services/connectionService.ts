import { invoke } from '@tauri-apps/api/core';
import type { ConnectionConfig, ConnectionSummary, ConnectionInfo } from '../types/connection';

export const connectionService = {
  test: (config: ConnectionConfig) => invoke<void>('test_connection', { config }),

  save: (config: ConnectionConfig) => invoke<string>('save_connection', { config }),

  list: () => invoke<ConnectionSummary[]>('list_connections'),

  delete: (id: string) => invoke<void>('delete_connection', { id }),

  connect: (id: string) => invoke<ConnectionInfo>('connect', { id }),

  disconnect: (id: string) => invoke<void>('disconnect', { id }),
};
