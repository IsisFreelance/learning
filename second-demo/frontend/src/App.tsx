import { useEffect, useState } from 'react'
import AdminLogin from './components/AdminLogin'
import UploadSection from './components/UploadSection'
import Queue from './components/Queue'
import ReviewScreen from './components/ReviewScreen'
import ProductsTable from './components/ProductsTable'
import GroupingReview from './components/GroupingReview'
import { adminCheckSession, clearToken, getToken, type IntakeItem } from './api'

type Tab = 'intake' | 'products' | 'grouping'

function App() {
  // null = still checking a saved token; true/false = known login state.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('intake')
  const [refreshKey, setRefreshKey] = useState(0)
  const [reviewingItem, setReviewingItem] = useState<IntakeItem | null>(null)

  useEffect(() => {
    if (!getToken()) {
      setLoggedIn(false)
      return
    }
    adminCheckSession().then(setLoggedIn)
  }, [])

  function returnToQueue() {
    setReviewingItem(null)
    setRefreshKey((k) => k + 1)
  }

  function handleLogout() {
    clearToken()
    setLoggedIn(false)
  }

  if (loggedIn === null) {
    return (
      <main className="app">
        <h1>Catalog Intake</h1>
        <p>Checking session…</p>
      </main>
    )
  }

  if (!loggedIn) {
    return (
      <main className="app">
        <h1>Catalog Intake</h1>
        <AdminLogin onLoggedIn={() => setLoggedIn(true)} />
      </main>
    )
  }

  return (
    <main className="app">
      <div className="app-header">
        <h1>Catalog Intake</h1>
        <button type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <div className="app-tabs">
        <button type="button" className={tab === 'intake' ? 'active' : ''} onClick={() => setTab('intake')}>
          Intake
        </button>
        <button type="button" className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>
          Approved Products
        </button>
        <button type="button" className={tab === 'grouping' ? 'active' : ''} onClick={() => setTab('grouping')}>
          Review Duplicates
        </button>
      </div>

      {tab === 'intake' &&
        (reviewingItem ? (
          <ReviewScreen item={reviewingItem} onDone={returnToQueue} onCancel={returnToQueue} />
        ) : (
          <>
            <UploadSection onUploaded={() => setRefreshKey((k) => k + 1)} />
            <Queue refreshKey={refreshKey} onReview={setReviewingItem} />
          </>
        ))}

      {tab === 'products' && <ProductsTable />}
      {tab === 'grouping' && <GroupingReview />}
    </main>
  )
}

export default App
