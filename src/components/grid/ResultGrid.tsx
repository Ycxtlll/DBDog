import React, { useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { QueryResult } from '../../types/query';

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  result: QueryResult;
  height?: string;
}

const ResultGrid: React.FC<Props> = ({ result, height = '100%' }) => {
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
    // Auto-size columns after data loads
    params.api.autoSizeAllColumns();
  }, []);

  return (
    <div className="ag-theme-alpine-dark h-full w-full" style={{ height }}>
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
