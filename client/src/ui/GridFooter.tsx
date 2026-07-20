/* ============================================================
   GridFooter — reusable list-grid toolkit (house standard).
   • usePagination + <GridFooter>: client-side paging, page size
     persisted per table in localStorage (25 default).
   • useSortRows + <SortTh>: click-a-header asc/desc sorting.
   Same idiom as ColumnPicker's hidden-column sets.
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode, type ThHTMLAttributes } from "react";

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;

/** Client-side pagination; page size persisted under `storageKey`.
 *  `resetKey` should encode the page's filters (e.g. `${query}|${tab}`) —
 *  the page snaps back to 1 whenever it changes. */
export function usePagination(total: number, storageKey: string, resetKey = "") {
  const [pageSize, setPageSizeRaw] = useState(() => {
    const n = Number(localStorage.getItem(storageKey));
    return PAGE_SIZES.includes(n) ? n : DEFAULT_SIZE;
  });
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const setPageSize = (n: number) => {
    localStorage.setItem(storageKey, String(n));
    setPageSizeRaw(n);
    setPage(1);
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const slice = <T,>(rows: T[]) => rows.slice((page - 1) * pageSize, page * pageSize);

  return { page, setPage, pageSize, setPageSize, pageCount, total, from, to, slice };
}

export type Pager = ReturnType<typeof usePagination>;

/** Header-click sorting. `get(row, key)` returns the sortable value for a
    column key; numbers sort numerically, everything else localeCompares.
    Click a header to sort asc, click again to flip desc. */
export function useSortRows<T>(
  rows: T[],
  get: (row: T, key: string) => unknown,
  initialKey = "",
  initialDir: 1 | -1 = 1,
) {
  const [sortKey, setSortKey] = useState(initialKey);
  const [dir, setDir] = useState<1 | -1>(initialDir);
  const onSort = (k: string) => {
    if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setDir(1);
    }
  };
  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const va = get(a, sortKey);
      const vb = get(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir]);
  return { sorted, sortKey, dir, onSort };
}

export type Sorter = Pick<ReturnType<typeof useSortRows>, "sortKey" | "dir" | "onSort">;

/** Sortable <th>: shows ▲/▼ on the active column, ↕ otherwise.
    Keyboard-operable (Tab + Enter/Space) and announces aria-sort. */
export function SortTh({
  id,
  label,
  sort,
  ...thProps
}: { id: string; label: ReactNode; sort: Sorter } & ThHTMLAttributes<HTMLTableCellElement>) {
  const active = sort.sortKey === id;
  return (
    <th
      {...thProps}
      tabIndex={0}
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => sort.onSort(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          sort.onSort(id);
        }
      }}
      title={active ? (sort.dir === 1 ? "Sorted ascending — click for descending" : "Sorted descending — click for ascending") : "Click to sort"}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", ...thProps.style }}
    >
      {label}
      <span aria-hidden style={{ marginLeft: 4, fontSize: 9, opacity: active ? 0.9 : 0.55 }}>
        {active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );
}

/** Windowed page numbers: at most 5 around the current page. */
function pageWindow(page: number, pageCount: number): number[] {
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const end = Math.min(pageCount, start + 4);
  const out: number[] = [];
  for (let p = start; p <= end; p++) out.push(p);
  return out;
}

/** Footer bar: "x–y of z" · Prev / page numbers / Next · page-size select.
    Fixed to the viewport bottom (user mandate 2026-07-13: "Fixed footer.
    Always.") — .grid-footer in styles.css; one per page. */
export function GridFooter(p: Pager) {
  return (
    <div className="grid-footer">
      <span className="muted mono" style={{ fontSize: "var(--t-sm)" }}>
        {p.from}–{p.to} of {p.total}
      </span>
      <div className="row" style={{ gap: 4, alignItems: "center" }}>
        <button className="btn" disabled={p.page <= 1} onClick={() => p.setPage(p.page - 1)}>
          ‹ Prev
        </button>
        {pageWindow(p.page, p.pageCount).map((n) => (
          <button key={n} className={`btn${n === p.page ? " active" : ""}`} onClick={() => p.setPage(n)}>
            {n}
          </button>
        ))}
        <button className="btn" disabled={p.page >= p.pageCount} onClick={() => p.setPage(p.page + 1)}>
          Next ›
        </button>
        <select
          className="pg-size"
          value={p.pageSize}
          onChange={(e) => p.setPageSize(Number(e.target.value))}
          title="Rows per page"
          style={{ marginLeft: 6 }}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
