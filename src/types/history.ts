export interface QueryHistoryEntry {
  id: number;
  connectionId: string;
  connectionName: string;
  databaseName?: string;
  sql: string;
  durationMs?: number;
  rowCount?: number;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
}

export interface Bookmark {
  id: number;
  name: string;
  folder?: string;
  tags?: string[];
  sql: string;
  placeholders?: string[];
  createdAt: string;
  updatedAt: string;
}
