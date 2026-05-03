import React, { useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { useUIStore } from '../../stores/uiStore';
import type { QueryResult } from '../../types/query';

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  result: QueryResult;
  height?: string;
}

const ResultGrid: React.FC<Props> = ({ result, height = '100%' }) => {
  const theme = useUIStore((s) => s.theme);

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

  const themeClass = theme === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  return (
    <div className={`${themeClass} h-full w-full`} style={{ height, '--ag-background-color': 'var(--bg-primary)', '--ag-foreground-color': 'var(--text-primary)', '--ag-border-color': 'var(--border-primary)', '--ag-header-background-color': 'var(--bg-secondary)', '--ag-header-foreground-color': 'var(--text-secondary)', '--ag-row-hover-color': 'var(--bg-hover)', '--ag-odd-row-background-color': 'var(--bg-primary)', '--ag-even-row-background-color': 'var(--bg-primary)', '--ag-font-family': 'inherit', '--ag-font-size': '13px', '--ag-header-font-family': 'inherit', '--ag-header-font-size': '12px', '--ag-header-font-weight': '600', '--ag-cell-horizontal-padding': '12px', '--ag-header-cell-horizontal-padding': '12px', '--ag-secondary-foreground-color': 'var(--text-secondary)', '--ag-disabled-foreground-color': 'var(--text-disabled)', '--ag-subheader-background-color': 'var(--bg-secondary)', '--ag-control-panel-background-color': 'var(--bg-secondary)', '--ag-side-button-selected-background-color': 'var(--bg-hover)', '--ag-range-selection-border-color': 'var(--accent-primary)', '--ag-range-selection-background-color': 'var(--accent-subtle)' } as React.CSSProperties}>
      <AgGridReact
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={defaultColDef}
        onGridReady={onGridReady}
        animateRows={false}
        rowSelection="multiple"
        suppressCellFocus={false}
        enableCellTextSelection={true}
        ensureDomOrder={true}
      />
    </div>
  );
};

export default ResultGrid;
