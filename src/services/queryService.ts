import { invoke } from '@tauri-apps/api/core';
import type { QueryResult, UpdateResult } from '../types/query';

export const queryService = {
  execute: (connectionId: string, sql: string, limit?: number) =>
    invoke<QueryResult>('execute_query', { connectionId, sql, limit }),

  update: (connectionId: string, sql: string) =>
    invoke<UpdateResult>('execute_update', { connectionId, sql }),

  cancel: (connectionId: string) =>
    invoke<void>('cancel_query', { connectionId }),

  explain: (connectionId: string, sql: string) =>
    invoke<QueryResult>('explain_query', { connectionId, sql }),
};
