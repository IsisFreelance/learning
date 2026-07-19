import { useEffect, useState } from 'react'
import { getConfirmedProductGroups, type ConfirmedProductListItem, type ProductGrouping } from '../api'
import ProductDetail from './ProductDetail'

function MemberCard({
  member,
  onClick,
  highlight,
}: {
  member: ConfirmedProductListItem
  onClick: () => void
  highlight?: boolean
}) {
  return (
    <div className={highlight ? 'grouping-member grouping-member-highlight' : 'grouping-member'} onClick={onClick}>
      <img src={member.thumbnail_url} alt={member.product_name ?? 'Unnamed product'} className="grouping-thumb" />
      <div className="grouping-member-info">
        <div>{member.product_name ?? '(no name)'}</div>
        <div className="grouping-meta">{member.price ?? '(no price)'}</div>
      </div>
    </div>
  )
}

function GroupingReview() {
  const [data, setData] = useState<ProductGrouping | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    getConfirmedProductGroups()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load duplicate review.'))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (selectedId) {
    return (
      <ProductDetail
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />
    )
  }

  if (loading) return <p>Loading…</p>
  if (error) return <p className="error-text">{error}</p>
  if (!data) return null

  const nothingToReview =
    data.ready_groups.length === 0 && data.blocked_groups.length === 0 && data.possible_duplicates.length === 0

  return (
    <section className="grouping-section">
      <h2>Review duplicates</h2>
      {nothingToReview && <p>Nothing to review — no duplicate or near-duplicate products found.</p>}

      {data.ready_groups.length > 0 && (
        <div className="grouping-bucket">
          <h3>Ready ({data.ready_groups.length})</h3>
          <p className="grouping-hint">
            Same name, same price — clearly the same product confirmed more than once. The suggested canonical name
            is the most recently confirmed or edited spelling.
          </p>
          {data.ready_groups.map((group) => (
            <div key={group.normalized_name} className="grouping-group">
              <div className="grouping-canonical">Canonical name: {group.canonical_name}</div>
              <div className="grouping-members">
                {group.members.map((member) => (
                  <MemberCard key={member.id} member={member} onClick={() => setSelectedId(member.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.blocked_groups.length > 0 && (
        <div className="grouping-bucket">
          <h3>Blocked — price conflict ({data.blocked_groups.length})</h3>
          <p className="grouping-hint">
            Same name, different price — could be a real price change or a data-entry mistake. Click a product to
            fix it.
          </p>
          {data.blocked_groups.map((group) => (
            <div key={group.normalized_name} className="grouping-group">
              <div className="grouping-members">
                {group.members.map((member) => (
                  <MemberCard key={member.id} member={member} onClick={() => setSelectedId(member.id)} highlight />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.possible_duplicates.length > 0 && (
        <div className="grouping-bucket">
          <h3>Possible duplicates ({data.possible_duplicates.length})</h3>
          <p className="grouping-hint">Similar but not identical names — not auto-grouped, worth a human look.</p>
          {data.possible_duplicates.map((dup, i) => (
            <div key={i} className="grouping-group">
              <div className="grouping-canonical">{Math.round(dup.similarity * 100)}% similar</div>
              <div className="grouping-duplicate-pair">
                <div className="grouping-members">
                  {dup.group_a.map((member) => (
                    <MemberCard key={member.id} member={member} onClick={() => setSelectedId(member.id)} />
                  ))}
                </div>
                <div className="grouping-members">
                  {dup.group_b.map((member) => (
                    <MemberCard key={member.id} member={member} onClick={() => setSelectedId(member.id)} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default GroupingReview
