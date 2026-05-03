import React, { useState, useEffect, useCallback } from 'react';
import { ReactFlow, Node, Edge, Background, Controls, MiniMap, useNodesState, useEdgesState, addEdge, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSchemaCacheStore } from '../../stores/schemaCacheStore';
import { schemaService } from '../../services/schemaService';
import { Database, Loader2, GitGraph } from 'lucide-react';

interface TableNodeData {
  database: string;
  table: string;
  columns: { name: string; type: string; primaryKey: boolean }[];
  [key: string]: unknown;
}

const TableNode = ({ data }: { data: TableNodeData }) => {
  return (
    <div
      className="rounded-xl shadow-md border overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-primary)',
        minWidth: '220px',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: 'var(--accent-primary)', width: 8, height: 8 }} />
      <div
        className="px-4 py-2.5 border-b flex items-center gap-2"
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border-primary)',
          color: 'var(--text-primary)',
        }}
      >
        <Database size={13} className="text-accent" />
        <span className="text-xs font-semibold">{data.table}</span>
      </div>
      <div className="p-2">
        {data.columns.map((col) => (
          <div
            key={col.name}
            className="flex items-center gap-2 px-3 py-1 rounded-md text-xs"
            style={{
              color: col.primaryKey ? 'var(--success)' : 'var(--text-secondary)',
            }}
          >
            <span className={`font-medium ${col.primaryKey ? 'font-semibold' : ''}`}>{col.name}</span>
            <span className="text-tertiary text-[10px] ml-auto">{col.type}</span>
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--accent-primary)', width: 8, height: 8 }} />
    </div>
  );
};

const nodeTypes = {
  table: TableNode,
};

export const ErDiagramView: React.FC = () => {
  const { activeConnectionId, activeConnections } = useConnectionStore();
  const { getDatabases } = useSchemaCacheStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const databases = activeConnectionId ? getDatabases(activeConnectionId) : [];

  const loadSchema = useCallback(async (database: string) => {
    if (!activeConnectionId) return;

    setLoading(true);
    try {
      const tables = await schemaService.listTables(activeConnectionId, database);

      const tableNodes: Node<TableNodeData>[] = [];
      const tableEdges: Edge[] = [];
      let x = 50;
      let y = 50;

      for (const table of tables) {
        try {
          const columns = await schemaService.getColumns(activeConnectionId, database, table.name);
          const foreignKeys = await schemaService.getForeignKeys(activeConnectionId, database, table.name);

          tableNodes.push({
            id: `${database}.${table.name}`,
            type: 'table',
            position: { x, y },
            data: {
              database,
              table: table.name,
              columns: columns.map((col: any) => ({
                name: col.name,
                type: col.type_name,
                primaryKey: col.is_primary_key,
              })),
            },
          });

          for (const fk of foreignKeys) {
            tableEdges.push({
              id: `${database}.${table.name}-${fk.referenced_table}`,
              source: `${database}.${table.name}`,
              target: `${database}.${fk.referenced_table}`,
              markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-tertiary)' },
              style: { stroke: 'var(--border-secondary)', strokeWidth: 1.5 },
              type: 'smoothstep',
            });
          }

          x += 260;
          if (x > 1200) {
            x = 50;
            y += 320;
          }
        } catch (e) {
          console.error(`Failed to load table ${table.name}`, e);
        }
      }

      setNodes(tableNodes);
      setEdges(tableEdges);
    } catch (e) {
      console.error('Failed to load schema', e);
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  useEffect(() => {
    if (selectedDatabase && activeConnectionId) {
      loadSchema(selectedDatabase);
    }
  }, [selectedDatabase, activeConnectionId, loadSchema]);

  const isConnected = activeConnectionId && activeConnections.has(activeConnectionId);

  if (!isConnected) {
    return (
      <div className="empty-state h-full">
        <div className="empty-state-icon">
          <GitGraph size={24} />
        </div>
        <div className="empty-state-title">ER Diagram</div>
        <div className="empty-state-desc">Connect to a database to view ER diagram</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-accent" />
          <span className="text-xs font-medium text-primary">Database</span>
          <select
            value={selectedDatabase}
            onChange={(e) => setSelectedDatabase(e.target.value)}
            className="form-select text-xs py-1"
          >
            <option value="">Select a database</option>
            {databases.map((db) => (
              <option key={db} value={db}>{db}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div className="empty-state flex-1">
          <Loader2 size={24} className="animate-spin text-tertiary" />
          <div className="empty-state-title">Loading schema...</div>
        </div>
      )}

      {!loading && (
        <div className="flex-1">
          {nodes.length === 0 && selectedDatabase ? (
            <div className="empty-state h-full">
              <div className="empty-state-title">No tables found</div>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              fitView
            >
              <Background gap={16} size={1} color="var(--border-divider)" />
              <Controls />
              <MiniMap
                nodeColor={() => 'var(--bg-secondary)'}
                maskColor="var(--bg-overlay)"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '8px',
                }}
              />
            </ReactFlow>
          )}
        </div>
      )}
    </div>
  );
};
