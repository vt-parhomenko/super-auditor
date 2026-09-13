import type { CSSProperties, ReactNode, Ref } from 'react';

import { useT } from '@renderer/i18n';

/**
 * Щільна таблиця без зовнішніх залежностей.
 *
 * «Віртуалізація» — це `overflow: auto` на контейнері + `content-visibility: auto`
 * на рядках (див. .dt у app.css): браузер не розкладає невидимі рядки, а сітка
 * лишається звичайним <table> — доступним і придатним для копіювання.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** CSS-ширина колонки; table-layout: fixed, тому ширини потрібні. */
  width?: string;
  align?: 'left' | 'right' | 'center';
  wrap?: boolean;
  render: (row: T, index: number) => ReactNode;
  /** Текст для title — щоб обрізане значення можна було прочитати. */
  title?: (row: T) => string | undefined;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T, index: number) => void;
  selectedKey?: string | number | null;
  emptyText?: string;
  maxHeight?: string;
  ref?: Ref<HTMLDivElement>;
  ariaLabel?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey = null,
  emptyText,
  maxHeight,
  ref,
  ariaLabel,
}: DataTableProps<T>) {
  const t = useT();
  const style: CSSProperties | undefined = maxHeight ? { maxHeight } : undefined;

  return (
    <div className="dt-wrap" style={style} ref={ref}>
      <table className="dt" aria-label={ariaLabel}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : undefined} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="dt-empty">
              <td colSpan={columns.length}>{emptyText ?? t.table.empty}</td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const key = rowKey(row, index);
              const classes = [
                onRowClick ? 'clickable' : '',
                selectedKey != null && selectedKey === key ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr
                  key={key}
                  className={classes || undefined}
                  onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                >
                  {columns.map((c) => {
                    const cellClasses = [
                      c.align === 'right' ? 'num' : '',
                      c.align === 'center' ? 'center' : '',
                      c.wrap ? 'wrap-cell' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <td key={c.key} className={cellClasses || undefined} title={c.title?.(row)}>
                        {c.render(row, index)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  const t = useT();
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="pager">
      <span className="tabnum">{t.table.range(from, to, total)}</span>
      <span className="spacer" />
      <button
        type="button"
        className="btn btn-sm"
        disabled={offset <= 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        {t.table.prev}
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={to >= total}
        onClick={() => onChange(offset + limit)}
      >
        {t.table.next}
      </button>
    </div>
  );
}
