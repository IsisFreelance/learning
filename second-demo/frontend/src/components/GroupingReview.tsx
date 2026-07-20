import { useEffect, useState } from 'react'
import {
  exportNormalizationRun,
  getConfirmedProductGroups,
  getNormalizationRun,
  listNormalizationRuns,
  saveNormalizationRun,
  type ConfirmedProductListItem,
  type NormalizationRunDetail,
  type NormalizationRunGroup,
  type NormalizationRunMember,
  type NormalizationRunPossibleDuplicate,
  type NormalizationRunSummary,
  type ProductGroup,
  type ProductGrouping,
  type PossibleDuplicate,
} from '../api'
import ProductDetail from './ProductDetail'

// A shape both the live report (Phase 5) and a saved run's snapshot
// (Phase 6) can be turned into, so the same rendering code shows either.
interface DisplayMember {
  id: string
  product_name: string | null
  price: string | null
  thumbnail_url: string | null
}

interface DisplayGroup {
  normalized_name: string
  status: 'ready' | 'blocked'
  canonical_name: string | null
  members: DisplayMember[]
}

interface DisplayPossibleDuplicate {
  similarity: number
  group_a: DisplayMember[]
  group_b: DisplayMember[]
}

interface DisplayGrouping {
  ready_groups: DisplayGroup[]
  blocked_groups: DisplayGroup[]
  possible_duplicates: DisplayPossibleDuplicate[]
}

function liveMemberToDisplay(member: ConfirmedProductListItem): DisplayMember {
  return { id: member.id, product_name: member.product_name, price: member.price, thumbnail_url: member.thumbnail_url }
}

function liveGroupToDisplay(group: ProductGroup): DisplayGroup {
  return { ...group, members: group.members.map(liveMemberToDisplay) }
}

function liveDuplicateToDisplay(dup: PossibleDuplicate): DisplayPossibleDuplicate {
  return { similarity: dup.similarity, group_a: dup.group_a.map(liveMemberToDisplay), group_b: dup.group_b.map(liveMemberToDisplay) }
}

function liveToDisplay(data: ProductGrouping): DisplayGrouping {
  return {
    ready_groups: data.ready_groups.map(liveGroupToDisplay),
    blocked_groups: data.blocked_groups.map(liveGroupToDisplay),
    possible_duplicates: data.possible_duplicates.map(liveDuplicateToDisplay),
  }
}

function runMemberToDisplay(member: NormalizationRunMember): DisplayMember {
  return { id: member.product_id, product_name: member.product_name, price: member.price, thumbnail_url: member.thumbnail_url }
}

function runGroupToDisplay(group: NormalizationRunGroup): DisplayGroup {
  return { ...group, members: group.members.map(runMemberToDisplay) }
}

function runDuplicateToDisplay(dup: NormalizationRunPossibleDuplicate): DisplayPossibleDuplicate {
  return { similarity: dup.similarity, group_a: dup.group_a.map(runMemberToDisplay), group_b: dup.group_b.map(runMemberToDisplay) }
}

function runToDisplay(run: NormalizationRunDetail): DisplayGrouping {
  return {
    ready_groups: run.ready_groups.map(runGroupToDisplay),
    blocked_groups: run.blocked_groups.map(runGroupToDisplay),
    possible_duplicates: run.possible_duplicates.map(runDuplicateToDisplay),
  }
}

function MemberCard({ member, onClick, highlight }: { member: DisplayMember; onClick: () => void; highlight?: boolean }) {
  return (
    <div className={highlight ? 'grouping-member grouping-member-highlight' : 'grouping-member'} onClick={onClick}>
      {member.thumbnail_url ? (
        <img src={member.thumbnail_url} alt={member.product_name ?? 'Unnamed product'} className="grouping-thumb" />
      ) : (
        <div className="grouping-thumb grouping-thumb-missing" title="Photo no longer available" />
      )}
      <div className="grouping-member-info">
        <div>{member.product_name ?? '(no name)'}</div>
        <div className="grouping-meta">{member.price ?? '(no price)'}</div>
      </div>
    </div>
  )
}

function GroupingBuckets({ data, onSelectMember }: { data: DisplayGrouping; onSelectMember: (id: string) => void }) {
  const nothingToReview =
    data.ready_groups.length === 0 && data.blocked_groups.length === 0 && data.possible_duplicates.length === 0

  return (
    <>
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
                  <MemberCard key={member.id} member={member} onClick={() => onSelectMember(member.id)} />
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
                  <MemberCard key={member.id} member={member} onClick={() => onSelectMember(member.id)} highlight />
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
                    <MemberCard key={member.id} member={member} onClick={() => onSelectMember(member.id)} />
                  ))}
                </div>
                <div className="grouping-members">
                  {dup.group_b.map((member) => (
                    <MemberCard key={member.id} member={member} onClick={() => onSelectMember(member.id)} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

type Mode = 'live' | 'history'

function GroupingReview() {
  const [mode, setMode] = useState<Mode>('live')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [liveData, setLiveData] = useState<ProductGrouping | null>(null)
  const [liveLoading, setLiveLoading] = useState(true)
  const [liveError, setLiveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  const [runs, setRuns] = useState<NormalizationRunSummary[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState('')

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runDetail, setRunDetail] = useState<NormalizationRunDetail | null>(null)
  const [runDetailLoading, setRunDetailLoading] = useState(false)
  const [runDetailError, setRunDetailError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (mode !== 'live') return
    setLiveLoading(true)
    setLiveError('')
    getConfirmedProductGroups()
      .then(setLiveData)
      .catch((err) => setLiveError(err instanceof Error ? err.message : 'Failed to load duplicate review.'))
      .finally(() => setLiveLoading(false))
  }, [mode, refreshKey])

  useEffect(() => {
    if (mode !== 'history' || selectedRunId) return
    setRunsLoading(true)
    setRunsError('')
    listNormalizationRuns()
      .then(setRuns)
      .catch((err) => setRunsError(err instanceof Error ? err.message : 'Failed to load saved runs.'))
      .finally(() => setRunsLoading(false))
  }, [mode, selectedRunId, refreshKey])

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(null)
      return
    }
    setRunDetailLoading(true)
    setRunDetailError('')
    getNormalizationRun(selectedRunId)
      .then(setRunDetail)
      .catch((err) => setRunDetailError(err instanceof Error ? err.message : 'Failed to load this run.'))
      .finally(() => setRunDetailLoading(false))
  }, [selectedRunId])

  async function handleSave() {
    setSaving(true)
    setSaveMessage('')
    try {
      await saveNormalizationRun()
      setSaveMessage('Saved — see it under "Saved runs."')
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save this check.')
    } finally {
      setSaving(false)
    }
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    if (!selectedRunId) return
    setExporting(true)
    try {
      await exportNormalizationRun(selectedRunId, format)
    } catch (err) {
      setRunDetailError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  function handleProductChanged() {
    setRefreshKey((k) => k + 1)
  }

  if (selectedProductId) {
    return (
      <ProductDetail id={selectedProductId} onClose={() => setSelectedProductId(null)} onChanged={handleProductChanged} />
    )
  }

  return (
    <section className="grouping-section">
      <h2>Review duplicates</h2>

      <div className="app-tabs">
        <button type="button" className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>
          Live check
        </button>
        <button
          type="button"
          className={mode === 'history' ? 'active' : ''}
          onClick={() => {
            setMode('history')
            setSelectedRunId(null)
          }}
        >
          Saved runs
        </button>
      </div>

      {mode === 'live' && (
        <>
          <div className="grouping-save-row">
            <button type="button" onClick={handleSave} disabled={saving}>
              Save this check
            </button>
            {saveMessage && <span className="grouping-hint">{saveMessage}</span>}
          </div>
          {liveLoading && <p>Loading…</p>}
          {liveError && <p className="error-text">{liveError}</p>}
          {liveData && <GroupingBuckets data={liveToDisplay(liveData)} onSelectMember={setSelectedProductId} />}
        </>
      )}

      {mode === 'history' && !selectedRunId && (
        <>
          {runsLoading && <p>Loading…</p>}
          {runsError && <p className="error-text">{runsError}</p>}
          {!runsLoading && runs.length === 0 && <p>No saved runs yet — save a check from "Live check" first.</p>}
          <ul className="grouping-run-list">
            {runs.map((run) => (
              <li key={run.id} className="grouping-run-item" onClick={() => setSelectedRunId(run.id)}>
                <div>{new Date(run.created_at).toLocaleString()}</div>
                <div className="grouping-meta">
                  {run.ready_count} ready · {run.blocked_count} blocked · {run.possible_duplicate_count} possible
                  duplicates
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {mode === 'history' && selectedRunId && (
        <>
          <button type="button" onClick={() => setSelectedRunId(null)}>
            ← Back to saved runs
          </button>
          {runDetailLoading && <p>Loading…</p>}
          {runDetailError && <p className="error-text">{runDetailError}</p>}
          {runDetail && (
            <>
              <p className="grouping-hint">Saved {new Date(runDetail.created_at).toLocaleString()}</p>
              <div className="grouping-save-row">
                <button type="button" disabled={exporting} onClick={() => handleExport('csv')}>
                  Export CSV
                </button>
                <button type="button" disabled={exporting} onClick={() => handleExport('xlsx')}>
                  Export XLSX
                </button>
              </div>
              <GroupingBuckets data={runToDisplay(runDetail)} onSelectMember={setSelectedProductId} />
            </>
          )}
        </>
      )}
    </section>
  )
}

export default GroupingReview
