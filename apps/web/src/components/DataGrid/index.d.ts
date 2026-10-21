import type { ReactNode } from 'react'

export interface DataGridColumn {
  field: string
  headerName?: string
  flex?: number
  width?: number
  minWidth?: number
  sortable?: boolean
  filterable?: boolean
  [key: string]: unknown
}

export interface DataGridProps<Row> {
  rowData: Row[]
  columnDefs: DataGridColumn[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRowId?: (params: any) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onRowClicked?: (event: any) => void
  onSortChange?: (state: unknown) => void
  initialSortState?: unknown
  initialFirstRowIndex?: number
  onFirstDisplayedRowChange?: (index: number) => void
  onDisplayedRowsChange?: (rows: Row[]) => void
  collapsedGroups?: Set<string>
  isLoading?: boolean
  errorMessage?: string
  emptyMessage?: string
  headerHeight?: number
  rowHeight?: number
  className?: string
  [key: string]: unknown
}

export declare function DataGrid<Row>(props: DataGridProps<Row>): ReactNode
export declare function buildDataGridSortNoteText(sortState: unknown, defaultText: string, columnLabelOverrides?: Record<string, string>): string
