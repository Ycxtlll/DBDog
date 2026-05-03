import React, { useMemo, useCallback, useState, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, CellContextMenuEvent } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { useUIStore } from '../../stores/uiStore';
import { useToastStore } from '../../stores/toastStore';
import type { QueryResult } from '../../types/query';

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  result: QueryResult;
  height?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  value: unknown;
  rowData?: Record<string, unknown>;
}

const ResultGrid: React.FC<Props> = ({ result, height = '100%' }) => {
  const theme = useUIStore((s) => s.theme);
  const addToast = useToastStore((s) => s.addToast);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const gridRef = useRef<AgGridReact>(null);

  const columnDefs = useMemo<ColDef[]>(() => {
    return result.columns.map((col) => ({
      headerName: col.name,
      field: col.name,
      sortable: true,
      filter: true,
      resizable: true,
      minWidth: 80,
      tooltipField: col.name,
      headerTooltip: `${col.type_name}${col.nullable ? '' : ' NOT NULL'}`,
    }));
  }, [result.columns]);

  const rowData = useMemo(() => {
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        if (val === null) {
          obj[key] = 'NULL';
        } else if (typeof val === 'object') {
          obj[key] = JSON.stringify(val);
        } else {
          obj[key] = val;
        }
      }
      return obj;
    });
  }, [result.rows]);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: true,
    filter: true,
    resizable: true,
  }), []);

  const onGridReady = useCallback((params: GridReadyEvent) => {
    params.api.autoSizeAllColumns();
  }, []);

  const handleCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    event.event?.preventDefault();
    const mouseEvent = event.event as MouseEvent | undefined;
    if (!mouseEvent) return;
    const x = Math.min(mouseEvent.clientX, window.innerWidth - 160);
    const y = Math.min(mouseEvent.clientY, window.innerHeight - 120);
    setContextMenu({
      x,
      y,
      value: event.value,
      rowData: event.data as Record<string, unknown> | undefined,
    });
  }, []);

  const handleCopyCell = useCallback(() => {
    if (contextMenu?.value !== undefined) {
      navigator.clipboard.writeText(String(contextMenu.value));
      addToast('Cell copied to clipboard', 'success');
    }
    setContextMenu(null);
  }, [contextMenu, addToast]);

  const handleCopyRow = useCallback(() => {
    if (contextMenu?.rowData) {
      const tsv = Object.values(contextMenu.rowData).join('\t');
      navigator.clipboard.writeText(tsv);
      addToast('Row copied to clipboard', 'success');
    }
    setContextMenu(null);
  }, [contextMenu, addToast]);

  const handleCopyRowJson = useCallback(() => {
    if (contextMenu?.rowData) {
      navigator.clipboard.writeText(JSON.stringify(contextMenu.rowData, null, 2));
      addToast('Row JSON copied to clipboard', 'success');
    }
    setContextMenu(null);
  }, [contextMenu, addToast]);

  const themeClass = theme === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  return (
    <div className="relative h-full w-full">
      <div className={`${themeClass} h-full w-full`} style={{ height, '--ag-background-color': 'var(--bg-primary)', '--ag-foreground-color': 'var(--text-primary)', '--ag-border-color': 'var(--border-primary)', '--ag-header-background-color': 'var(--bg-secondary)', '--ag-header-foreground-color': 'var(--text-secondary)', '--ag-row-hover-color': 'var(--bg-hover)', '--ag-odd-row-background-color': 'var(--bg-primary)', '--ag-even-row-background-color': 'var(--bg-primary)', '--ag-font-family': 'inherit', '--ag-font-size': '13px', '--ag-header-font-family': 'inherit', '--ag-header-font-size': '12px', '--ag-header-font-weight': '600', '--ag-cell-horizontal-padding': '12px', '--ag-header-cell-horizontal-padding': '12px', '--ag-secondary-foreground-color': 'var(--text-secondary)', '--ag-disabled-foreground-color': 'var(--text-disabled)', '--ag-subheader-background-color': 'var(--bg-secondary)', '--ag-control-panel-background-color': 'var(--bg-secondary)', '--ag-side-button-selected-background-color': 'var(--bg-hover)', '--ag-range-selection-border-color': 'var(--accent-primary)', '--ag-range-selection-background-color': 'var(--accent-subtle)' } as React.CSSProperties}>
        <AgGridReact
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={defaultColDef}
          onGridReady={onGridReady}
          animateRows={false}
          rowSelection="multiple"
          suppressCellFocus={false}
          enableCellTextSelection={true}
          ensureDomOrder={true}
          onCellContextMenu={handleCellContextMenu}
        />
      </div>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="context-menu-item" onClick={handleCopyCell}>
            Copy cell
          </button>
          <button className="context-menu-item" onClick={handleCopyRow}>
            Copy row (TSV)
          </button>
          <button className="context-menu-item" onClick={handleCopyRowJson}>
            Copy row (JSON)
          </button>
        </div>
      )}
    </div>
  );
};

export default ResultGrid;
