import React, { useState, useEffect, useCallback } from 'react';
import { Database, Table, ChevronRight, ChevronDown, Loader2, Columns, RefreshCw, Copy, Search, LayoutList, ArrowUpRight, Eye, FileCode } from 'lucide-react';
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

  const handleDoubleClick = (node: TreeNode) => {
    if (node.type === 'table') {
      const sql = `SELECT * FROM \`${node.database}\`.\`${node.name}\` LIMIT 100;`;
      if (activeConnectionId) {
        const tabId = addTab(activeConnectionId, node.database);
        setTimeout(() => {
          const { tabs, updateTabSql } = useQueryStore.getState();
          const tab = tabs.find(t => t.id === tabId);
          if (tab) {
            updateTabSql(tabId, sql);
            setActiveTab(tabId);
          }
        }, 0);
      }
    } else if (node.type === 'database') {
      toggleNode(node);
    }
  };

  const handleDragStart = (e: React.DragEvent, node: TreeNode) => {
    if (node.type === 'table') {
      e.dataTransfer.setData('text/plain', `\`${node.database}\`.\`${node.name}\``);
      e.dataTransfer.setData('application/dbdog-table', JSON.stringify({
        database: node.database,
        table: node.name,
        type: 'table'
      }));
      e.dataTransfer.effectAllowed = 'copy';
    } else if (node.type === 'column') {
      e.dataTransfer.setData('text/plain', `\`${node.name}\``);
      e.dataTransfer.setData('application/dbdog-column', JSON.stringify({
        database: node.database,
        table: node.table,
        column: node.name,
        type: 'column'
      }));
      e.dataTransfer.effectAllowed = 'copy';
    }
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
      <div className="empty-state h-full">
        <div className="empty-state-icon">
          <Database size={24} />
        </div>
        <div className="empty-state-title">{t('common:no_database_connection')}</div>
        <div className="empty-state-desc">{t('common:connect_to_browse')}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {(viewMode as ViewMode) === 'search' ? (
        <SchemaSearch />
      ) : (
        <>
          <div className="panel-header">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('tree')}
                className={`toolbar-btn p-1 ${(viewMode as ViewMode) === 'tree' ? 'bg-accent-subtle text-accent' : 'text-muted'}`}
                title={t('common:tree_view')}
              >
                <LayoutList size={16} strokeWidth={(viewMode as ViewMode) === 'tree' ? 2.2 : 1.8} />
              </button>
              <button
                onClick={() => setViewMode('search')}
                className={`toolbar-btn p-1 ${(viewMode as ViewMode) === 'search' ? 'bg-accent-subtle text-accent' : 'text-muted'}`}
                title={t('common:search_schema')}
              >
                <Search size={16} strokeWidth={(viewMode as ViewMode) === 'search' ? 2.2 : 1.8} />
              </button>
            </div>
            <button
              onClick={refreshAll}
              className="toolbar-btn p-1 text-muted"
              title={t('common:refresh') || 'Refresh'}
            >
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-2">
            {treeNodes.length === 0 ? (
              <div className="empty-state">
                <Loader2 size={24} className="animate-spin text-tertiary" />
                <div className="empty-state-title">{t('common:schema_loading')}</div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {treeNodes.map((node, index) => {
                  const isLoading = (node.type === 'database' || node.type === 'table') && node.loading;
                  return (
                    <div
                      key={index}
                      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all hover:bg-hover ${
                        node.type === 'table' ? 'ml-3' : node.type === 'column' ? 'ml-6' : ''
                      }`}
                      onClick={() => toggleNode(node)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleDoubleClick(node);
                      }}
                      onContextMenu={(e) => handleRightClick(e, node)}
                      draggable={node.type === 'table' || node.type === 'column'}
                      onDragStart={(e) => handleDragStart(e, node)}
                    >
                      {isLoading ? (
                        <Loader2 size={14} className="animate-spin text-tertiary flex-shrink-0" />
                      ) : (
                        (node.type === 'database' || node.type === 'table') && (
                          <div className="flex-shrink-0 text-tertiary">
                            {node.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </div>
                        )
                      )}
                      {!isLoading && (
                        <div className="flex-shrink-0">
                          {node.type === 'database' ? (
                            <Database size={14} className="text-secondary" />
                          ) : node.type === 'table' ? (
                            <Table size={14} className="text-secondary" />
                          ) : (
                            <Columns size={14} className={node.isPrimaryKey ? 'text-success' : 'text-tertiary'} />
                          )}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-primary truncate">{node.name}</span>
                          {node.type === 'column' && node.isPrimaryKey && (
                            <span className="badge badge-success text-[10px] px-1">PK</span>
                          )}
                          {node.type === 'column' && node.nullable && (
                            <span className="badge badge-secondary text-[10px] px-1">NULL</span>
                          )}
                        </div>
                        {node.type === 'column' && (
                          <div className="text-[11px] text-tertiary mt-0.5">{node.dataType}</div>
                        )}
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Copy size={13} className="text-tertiary" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {contextMenu && (
            <div
              className="context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              {contextMenu.node.type === 'table' && (
                <>
                  <button className="context-menu-item" onClick={() => handleContextAction('selectStar')}>
                    <ArrowUpRight size={14} />
                    SELECT *
                  </button>
                  <button className="context-menu-item" onClick={() => handleContextAction('describe')}>
                    <Eye size={14} />
                    DESCRIBE
                  </button>
                  <div className="context-menu-divider" />
                </>
              )}
              {contextMenu.node.type === 'column' && (
                <button className="context-menu-item" onClick={() => handleContextAction('selectStar')}>
                  <FileCode size={14} />
                  SELECT column
                </button>
              )}
              <button className="context-menu-item" onClick={() => handleContextAction('copyName')}>
                <Copy size={14} />
                {t('common:copy_name')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DatabaseTree;
