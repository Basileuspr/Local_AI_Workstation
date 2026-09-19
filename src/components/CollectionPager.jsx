export default function CollectionPager({ page, pages, onChange, label }) {
  if (pages <= 1) return null;
  return <nav className="collection-pager" aria-label={`${label} pages`}>
    <button type="button" aria-label={`Previous ${label} page`} disabled={page === 0}
      onClick={() => onChange(page - 1)}>‹ Prev</button>
    <span>{page + 1} / {pages}</span>
    <button type="button" aria-label={`Next ${label} page`} disabled={page + 1 === pages}
      onClick={() => onChange(page + 1)}>Next ›</button>
  </nav>;
}
