export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  max_connections?: number;
  ssl_mode?: string;
  ssl_cert?: string;
}

export interface ConnectionSummary {
  id: string;
  name: string;
  db_type: string;
  host: string;
  port: number;
  user: string;
  database?: string;
}

export interface ConnectionInfo {
  id: string;
  name: string;
  server_version: string;
  db_type: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
