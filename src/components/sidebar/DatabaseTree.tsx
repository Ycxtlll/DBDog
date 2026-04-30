import React, { useState, useEffect, useCallback } from 'react';
import { Database, Table, ChevronRight, ChevronDown, Loader2, Columns, RefreshCw, Copy, Search, LayoutList } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSchemaCacheStore } from '../../stores/schemaCacheStore';
import { useQueryStore } from '../../stores/queryStore';
import { useUIStore } from '../../stores/uiStore';
import { schemaService } from '../../services/schemaService';
import { useTranslation } from 'react-i18next';
import { SchemaSearch } from './SchemaSearch';

interface DatabaseNode {
  type: 'database';
  name: string;
  expanded: boolean;
  loading: boolean;
}

interface TableNode {
  type: 'table';
  database: string;
  name: string;
  expanded: boolean;
  loading: boolean;
}

interface ColumnNode {
  type: 'column';
  database: string;
  table: string;
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  nullable: boolean;
}

type TreeNode = DatabaseNode | TableNode | ColumnNode;

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

type ViewMode = 'tree' | 'search';

const DatabaseTree: React.FC = () => {
  const { activeConnections, activeConnectionId } = useConnectionStore();
  const { setDatabases, setTables, setColumns, getDatabases, getTables, getColumns } = useSchemaCacheStore();
  const { addTab, setActiveTab } = useQueryStore();
  const { sidebarPanel } = useUIStore();
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const { t } = useTranslation(['common', 'connections']);

  const isConnected = activeConnectionId && activeConnections.has(activeConnectionId);

  const loadDatabases = useCallback(async () => {
    if (!activeConnectionId) return;

    try {
      const cached = getDatabases(activeConnectionId);
      if (cached.length > 0) {
        updateTreeWithDatabases(cached);
        return;
      }

      const result = await schemaService.listDatabases(activeConnectionId);
      setDatabases(activeConnectionId, result);
      updateTreeWithDatabases(result);
    } catch (e) {
      console.error('Failed to load databases:', e);
    }
  }, [activeConnectionId, getDatabases, setDatabases]);

  const loadTables = useCallback(async (database: string) => {
    if (!activeConnectionId) return;

    const cached = getTables(activeConnectionId, database);
    if (cached.length > 0) {
      updateTreeWithTables(database, cached);
      return;
    }

    try {
      setTreeNodes(prev => prev.map(n =>
        n.type === 'database' && n.name === database ? { ...n, loading: true } : n
      ));

      const result = await schemaService.listTables(activeConnectionId, database);
      setTables(activeConnectionId, database, result);
      updateTreeWithTables(database, result);
    } catch (e) {
      console.error('Failed to load tables:', e);
      setTreeNodes(prev => prev.map(n =>
        n.type === 'database' && n.name === database ? { ...n, loading: false } : n
      ));
    }
  }, [activeConnectionId, getTables, setTables]);

  const loadColumns = useCallback(async (database: string, table: string) => {
    if (!activeConnectionId) return;

    const cached = getColumns(activeConnectionId, database, table);
    if (cached.length > 0) {
      updateTreeWithColumns(database, table, cached);
      return;
    }

    try {
      setTreeNodes(prev => prev.map(n =>
        n.type === 'table' && n.database === database && n.name === table ? { ...n, loading: true } : n
      ));

      const result = await schemaService.getColumns(activeConnectionId, database, table);
      setColumns(activeConnectionId, database, table, result);
      updateTreeWithColumns(database, table, result);
    } catch (e) {
      console.error('Failed to load columns:', e);
      setTreeNodes(prev => prev.map(n =>
        n.type === 'table' && n.database === database && n.name === table ? { ...n, loading: false } : n
      ));
    }
  }, [activeConnectionId, getColumns, setColumns]);

  const updateTreeWithDatabases = (dbList: string[]) => {
    const newNodes: TreeNode[] = dbList.map(name => ({
      type: 'database',
      name,
      expanded: false,
      loading: false,
    }));
    setTreeNodes(newNodes);
  };

  const updateTreeWithTables = (database: string, tableList: any[]) => {
    setTreeNodes(prev => {
      const dbIndex = prev.findIndex(n => n.type === 'database' && n.name === database);
      if (dbIndex === -1) return prev;

      const newNodes = [...prev];
      const dbNode = newNodes[dbIndex] as DatabaseNode;
      newNodes[dbIndex] = { ...dbNode, loading: false, expanded: true };

      const tableNodes: TreeNode[] = tableList.map(table => ({
        type: 'table',
        database,
        name: table.name,
        expanded: false,
        loading: false,
      }));

      let insertIndex = dbIndex + 1;
      while (insertIndex < newNodes.length) {
        const next = newNodes[insertIndex];
        if (next.type === 'database') break;
        if (next.type === 'table' && next.database === database) {
          newNodes.splice(insertIndex, 1);
        } else if (next.type === 'column' && next.database === database) {
          newNodes.splice(insertIndex, 1);
        } else {
          insertIndex++;
        }
      }
      newNodes.splice(dbIndex + 1, 0, ...tableNodes);
      return newNodes;
    });
  };

  const updateTreeWithColumns = (database: string, table: string, columnList: any[]) => {
    setTreeNodes(prev => {
      const tableIndex = prev.findIndex(n =>
        n.type === 'table' && n.database === database && n.name === table
      );
      if (tableIndex === -1) return prev;

      const newNodes = [...prev];
      const tableNode = newNodes[tableIndex] as TableNode;
      newNodes[tableIndex] = { ...tableNode, loading: false, expanded: true };

      const columnNodes: TreeNode[] = columnList.map(col => ({
        type: 'column',
        database,
        table,
        name: col.name,
        dataType: col.type_name,
        isPrimaryKey: col.is_primary_key,
        nullable: col.nullable,
      }));

      let insertIndex = tableIndex + 1;
      while (insertIndex < newNodes.length) {
        const next = newNodes[insertIndex];
        if (next.type === 'database') break;
        if (next.type === 'table') break;
        if (next.type === 'column' && next.database === database && next.table === table) {
          newNodes.splice(insertIndex, 1);
        } else {
          insertIndex++;
        }
      }
      newNodes.splice(tableIndex + 1, 0, ...columnNodes);
      return newNodes;
    });
  };

  const toggleNode = async (node: TreeNode) => {
    if (node.type === 'database') {
      const isExpanded = treeNodes.some(n =>
        n.type === 'table' && n.database === node.name
      );
      if (isExpanded) {
        setTreeNodes(prev => {
          const filtered: TreeNode[] = [];
          let skip = false;
          for (let i = 0; i < prev.length; i++) {
            const n = prev[i];
            if (n.type === 'database' && n.name === node.name) {
              filtered.push({ ...n, expanded: false });
              skip = true;
            } else if (skip && (n.type === 'table' || n.type === 'column')) {
              continue;
            } else {
              skip = false;
              filtered.push(n);
            }
          }
          return filtered;
        });
      } else {
        await loadTables(node.name);
      }
    } else if (node.type === 'table') {
      const isExpanded = treeNodes.some(n =>
        n.type === 'column' && n.database === node.database && n.table === node.name
      );
      if (isExpanded) {
        setTreeNodes(prev => {
          const filtered: TreeNode[] = [];
          let skip = false;
          for (let i = 0; i < prev.length; i++) {
            const n = prev[i];
            if (n.type === 'table' && n.database === node.database && n.name === node.name) {
              filtered.push({ ...n, expanded: false });
              skip = true;
            } else if (skip && n.type === 'column' && n.database === node.database && n.table === node.name) {
              continue;
            } else {
              skip = false;
              filtered.push(n);
            }
          }
          return filtered;
        });
      } else {
        await loadColumns(node.database, node.name);
      }
    }
  };

  const handleRightClick = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleContextAction = (action: string) => {
    if (!contextMenu) return;
    const { node } = contextMenu;

    if (action === 'selectStar') {
      let sql = '';
      let dbName = '';
      if (node.type === 'table') {
        sql = `SELECT * FROM \`${node.database}\`.\`${node.name}\` LIMIT 100;`;
        dbName = node.database;
      } else if (node.type === 'column') {
        sql = `SELECT \`${node.name}\` FROM \`${node.database}\`.\`${node.table}\` LIMIT 100;`;
        dbName = node.database;
      }
      if (sql && activeConnectionId) {
        const tabId = addTab(activeConnectionId, dbName);
        setTimeout(() => {
          const { tabs, updateTabSql } = useQueryStore.getState();
          const tab = tabs.find(t => t.id === tabId);
          if (tab) {
            updateTabSql(tabId, sql);
            setActiveTab(tabId);
          }
        }, 0);
      }
    } else if (action === 'copyName') {
      navigator.clipboard.writeText(node.name);
    } else if (action === 'describe') {
      if (node.type === 'table' && activeConnectionId) {
        const sql = `DESCRIBE \`${node.database}\`.\`${node.name}\`;`;
        const tabId = addTab(activeConnectionId, node.database);
        setTimeout(() => {
          useQueryStore.getState().updateTabSql(tabId, sql);
          setActiveTab(tabId);
        }, 0);
      }
    }

    setContextMenu(null);
  };

  const refreshAll = async () => {
    if (!activeConnectionId) return;
    try {
      await schemaService.refreshSchema(activeConnectionId);
      await loadDatabases();
    } catch (e) {
      console.error('Failed to refresh:', e);
    }
  };

  useEffect(() => {
    if (isConnected && sidebarPanel === 'connections') {
      loadDatabases();
    }
  }, [isConnected, sidebarPanel, loadDatabases]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-xs p-4" style={{ color: 'var(--text-tertiary)' }}>
        <Database size={48} className="mb-2 opacity-30" />
        <p className="text-center">Connect to a database to browse schema</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-sidebar)' }}>
      {viewMode === 'search' ? (
        <SchemaSearch />
      ) : (
        <>
          <div className="flex items-center justify-between p-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('tree')}
                className="p-1 rounded"
                style={{
                  color: (viewMode as ViewMode) === 'tree' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  background: (viewMode as ViewMode) === 'tree' ? 'var(--bg-active)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if ((viewMode as ViewMode) !== 'tree') e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if ((viewMode as ViewMode) !== 'tree') e.currentTarget.style.background = 'transparent';
                }}
                title="Tree view"
              >
                <LayoutList size={14} />
              </button>
              <button
                onClick={() => setViewMode('search')}
                className="p-1 rounded"
                style={{
                  color: (viewMode as ViewMode) === 'search' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  background: (viewMode as ViewMode) === 'search' ? 'var(--bg-active)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if ((viewMode as ViewMode) !== 'search') e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if ((viewMode as ViewMode) !== 'search') e.currentTarget.style.background = 'transparent';
                }}
                title="Search"
              >
                <Search size={14} />
              </button>
            </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refreshAll}
            className="p-1 rounded"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            title={t('common:refresh')}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-1">
        {treeNodes.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : (
          treeNodes.map((node, index) => {
            const isLoading = (node.type === 'database' || node.type === 'table') && node.loading;
            return (
              <div
                key={index}
                className="flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-xs"
                style={{
                  marginLeft: node.type === 'table' ? 16 : node.type === 'column' ? 32 : 0,
                }}
                onClick={() => toggleNode(node)}
                onContextMenu={(e) => handleRightClick(e, node)}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {isLoading ? (
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
                ) : (
                  (node.type === 'database' || node.type === 'table') && (
                    node.expanded ? <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} /> :
                      <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
                  )
                )}
                {!isLoading && (
                  node.type === 'database' ? <Database size={14} style={{ color: 'var(--text-secondary)' }} /> :
                  node.type === 'table' ? <Table size={14} style={{ color: 'var(--text-secondary)' }} /> :
                  <Columns size={14} style={{
                    color: node.isPrimaryKey ? 'var(--status-connected)' : 'var(--text-tertiary)'
                  }} />
                )}
                <span style={{ color: 'var(--text-primary)' }}>{node.name}</span>
                {node.type === 'column' && (
                  <span className="ml-1" style={{ color: 'var(--text-tertiary)' }}>
                    {node.dataType}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

          {contextMenu && (
            <div
              className="fixed z-50 p-1 rounded shadow-lg"
              style={{
                left: contextMenu.x,
                top: contextMenu.y,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              {contextMenu.node.type === 'table' && (
                <>
                  <button
                    className="block w-full text-left px-3 py-1.5 text-xs rounded"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => handleContextAction('selectStar')}
                  >
                    SELECT *
                  </button>
                  <button
                    className="block w-full text-left px-3 py-1.5 text-xs rounded"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => handleContextAction('describe')}
                  >
                    DESCRIBE
                  </button>
                  <div className="my-1" style={{ borderTop: '1px solid var(--border-primary)' }} />
                </>
              )}
              {contextMenu.node.type === 'column' && (
                <button
                  className="block w-full text-left px-3 py-1.5 text-xs rounded"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  onClick={() => handleContextAction('selectStar')}
                >
                  SELECT column
                </button>
              )}
              <button
                className="block w-full text-left px-3 py-1.5 text-xs rounded"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                onClick={() => handleContextAction('copyName')}
              >
                <div className="flex items-center gap-2">
                  <Copy size={12} />
                  Copy name
                </div>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DatabaseTree;
