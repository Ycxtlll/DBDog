import React, { useState, useEffect, useCallback } from 'react';
import { ReactFlow, Node, Edge, Background, Controls, MiniMap, useNodesState, useEdgesState, addEdge, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSchemaCacheStore } from '../../stores/schemaCacheStore';
import { schemaService } from '../../services/schemaService';

interface TableNodeData {
  database: string;
  table: string;
  columns: { name: string; type: string; primaryKey: boolean }[];
  [key: string]: unknown; // Add index signature for Record<string, unknown>
}

const TableNode = ({ data }: { data: TableNodeData }) => {
  return (
    <div
      className="rounded shadow border"
      style={{
        background: 'var(--bg-primary)',
        borderColor: 'var(--border-primary)',
        minWidth: '200px',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        className="px-3 py-2 border-b text-xs font-semibold"
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border-primary)',
          color: 'var(--text-primary)',
        }}
      >
        {data.table}
      </div>
      <div className="p-2">
        {data.columns.map((col) => (
          <div
            key={col.name}
            className="flex items-center gap-2 px-2 py-1 text-xs"
            style={{
              color: col.primaryKey ? 'var(--success)' : 'var(--text-secondary)',
            }}
          >
            <span className="font-medium">{col.name}</span>
            <span className="opacity-70">{col.type}</span>
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Bottom} />
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
      // First, load tables for the database
      const tables = await schemaService.listTables(activeConnectionId, database);

      // Then, load columns for each table
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

          // Add edges for foreign keys
          for (const fk of foreignKeys) {
            tableEdges.push({
              id: `${database}.${table.name}-${fk.referenced_table}`,
              source: `${database}.${table.name}`,
              target: `${database}.${fk.referenced_table}`,
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { stroke: 'var(--text-tertiary)' },
            });
          }

          // Position next table
          x += 250;
          if (x > 1000) {
            x = 50;
            y += 300;
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
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
        Connect to a database to view ER diagram
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex items-center gap-2 p-2 border-b" style={{ borderColor: 'var(--border-primary)' }}>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Database:
        </span>
        <select
          value={selectedDatabase}
          onChange={(e) => setSelectedDatabase(e.target.value)}
          className="px-2 py-1 rounded text-xs border"
          style={{
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            borderColor: 'var(--border-primary)',
          }}
        >
          <option value="">Select a database</option>
          {databases.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
          Loading...
        </div>
      )}

      {!loading && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap
            nodeColor={() => 'var(--bg-secondary)'}
            style={{
              background: 'var(--bg-sidebar)',
              borderColor: 'var(--border-primary)',
            }}
          />
        </ReactFlow>
      )}
    </div>
  );
};
