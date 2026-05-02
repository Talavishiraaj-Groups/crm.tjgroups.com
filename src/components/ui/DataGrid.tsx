import React from 'react';

interface Column<T> {
  header: string;
  accessor: keyof T | ((item: T) => React.ReactNode);
  width?: string;
}

interface DataGridProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
}

export function DataGrid<T extends { id: string }>({ columns, data, onRowClick }: DataGridProps<T>) {
  return (
    <div className="tj-card bg-white overflow-hidden shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-tj-bg">
            {columns.map((col, i) => (
              <th key={i} className="tj-table-header" style={{ width: col.width }}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="tj-table-cell text-center py-xl text-tj-black/40 italic">
                No records found.
              </td>
            </tr>
          ) : (
            data.map((item) => (
              <tr 
                key={item.id} 
                onClick={() => onRowClick?.(item)}
                className={`
                  hover:bg-tj-bg transition-colors
                  ${onRowClick ? 'cursor-pointer' : ''}
                `}
              >
                {columns.map((col, i) => (
                  <td key={i} className="tj-table-cell">
                    {typeof col.accessor === 'function' 
                      ? col.accessor(item) 
                      : (item[col.accessor] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
