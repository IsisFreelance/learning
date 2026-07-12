import { useEffect, useState } from 'react'
import { listIntakeItems, updateIntakeItemStatus, type IntakeItem, type IntakeStatus } from '../api'

const FILTERS: Array<IntakeStatus | 'all'> = ['all', 'new', 'archived', 'rejected', 'deleted']

function actionsFor(status: IntakeStatus): Array<{ label: string; target: IntakeStatus }> {
  if (status === 'new') {
    return [
      { label: 'Archive', target: 'archived' },
      { label: 'Reject', target: 'rejected' },
      { label: 'Delete', target: 'deleted' },
    ]
  }
  if (status === 'archived' || status === 'rejected' || status === 'deleted') {
    return [{ label: 'Restore', target: 'new' }]
  }
  return []
}

function Queue({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<IntakeItem[]>([])
  const [filter, setFilter] = useState<IntakeStatus | 'all'>('new')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError('')
    listIntakeItems(filter)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load queue.'))
      .finally(() => setLoading(false))
  }, [filter, refreshKey])

  async function handleAction(id: string, target: IntakeStatus) {
    setBusyId(id)
    setError('')
    try {
      await updateIntakeItemStatus(id, target)
      // The item no longer belongs in the current filtered view once its
      // status changes, so just drop it locally instead of a full refetch.
      setItems((prev) => prev.filter((item) => item.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="queue-section">
      <h2>Queue</h2>
      <div className="queue-filters">
        {FILTERS.map((f) => (
          <button key={f} type="button" className={f === filter ? 'active' : ''} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && items.length === 0 && <p>No items.</p>}

      <ul className="queue-list">
        {items.map((item) => (
          <li key={item.id} className="queue-row">
            <img src={item.thumbnail_url} alt={item.original_filename} className="queue-thumb" />
            <div className="queue-info">
              <div className="queue-filename">{item.original_filename}</div>
              <div className="queue-meta">
                {item.status} · {new Date(item.uploaded_at).toLocaleString()}
              </div>
            </div>
            <div className="queue-actions">
              {actionsFor(item.status).map((action) => (
                <button
                  key={action.target}
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => handleAction(item.id, action.target)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default Queue
