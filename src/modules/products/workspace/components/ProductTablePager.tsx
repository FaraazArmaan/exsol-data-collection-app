export function ProductTablePager(props: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (n: number) => void;
}) {
  const { page, pageSize, total, onPage } = props;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="pm-pager" role="navigation" aria-label="Pagination">
      <div>Showing {from}–{to} of {total}</div>
      <div className="pm-pager-buttons">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
        <span className="pm-pager-state"> {page} / {pages} </span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}
