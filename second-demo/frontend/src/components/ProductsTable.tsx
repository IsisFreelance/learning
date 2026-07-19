import { useEffect, useState } from 'react'
import {
  listConfirmedProducts,
  exportConfirmedProducts,
  type ConfirmedProductListItem,
  type ConfirmedProductSort,
  type SortOrder,
} from '../api'
import ProductDetail from './ProductDetail'

const PAGE_SIZE = 20
const SOURCE_FILTERS = ['all', 'ocr', 'manual', 'override'] as const

function ProductsTable() {
  const [items, setItems] = useState<ConfirmedProductListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const [q, setQ] = useState('')
  const [source, setSource] = useState<(typeof SOURCE_FILTERS)[number]>('all')
  const [sort, setSort] = useState<ConfirmedProductSort>('confirmed_at')
  const [order, setOrder] = useState<SortOrder>('desc')
  const [page, setPage] = useState(0)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    listConfirmedProducts({
      q: q || undefined,
      source: source === 'all' ? undefined : source,
      sort,
      order,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load products.'))
      .finally(() => setLoading(false))
  }, [q, source, sort, order, page, refreshKey])

  // Any filter change should jump back to page 0 -- otherwise you could be
  // sitting on a page that no longer has any matching rows.
  function updateFilter(fn: () => void) {
    fn()
    setPage(0)
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    setExporting(true)
    setError('')
    try {
      await exportConfirmedProducts(format, { q: q || undefined, source: source === 'all' ? undefined : source, sort, order })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  if (selectedId) {
    return (
      <ProductDetail
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />
    )
  }

  return (
    <section className="products-section">
      <h2>Approved products</h2>

      <div className="products-controls">
        <input
          type="text"
          placeholder="Search by product name…"
          value={q}
          onChange={(e) => updateFilter(() => setQ(e.target.value))}
        />
        <select value={source} onChange={(e) => updateFilter(() => setSource(e.target.value as typeof source))}>
          {SOURCE_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All sources' : s}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => updateFilter(() => setSort(e.target.value as ConfirmedProductSort))}>
          <option value="confirmed_at">Confirmed date</option>
          <option value="name">Name</option>
          <option value="price">Price</option>
        </select>
        <select value={order} onChange={(e) => updateFilter(() => setOrder(e.target.value as SortOrder))}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <button type="button" disabled={exporting} onClick={() => handleExport('csv')}>
          Export CSV
        </button>
        <button type="button" disabled={exporting} onClick={() => handleExport('xlsx')}>
          Export XLSX
        </button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && items.length === 0 && <p>No products match.</p>}

      <ul className="products-list">
        {items.map((item) => (
          <li key={item.id} className="products-item" onClick={() => setSelectedId(item.id)}>
            <img src={item.thumbnail_url} alt={item.product_name ?? 'Unnamed product'} className="products-thumb" />
            <div className="products-info">
              <div className="products-name">{item.product_name ?? '(no name)'}</div>
              <div className="products-meta">
                {item.price ?? '(no price)'} · name: {item.product_name_source} · price: {item.price_source}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="products-pagination">
        <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button type="button" disabled={items.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </section>
  )
}

export default ProductsTable
