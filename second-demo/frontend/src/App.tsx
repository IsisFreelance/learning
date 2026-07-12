import { useState } from 'react'
import UploadSection from './components/UploadSection'
import Queue from './components/Queue'
import ReviewScreen from './components/ReviewScreen'
import type { IntakeItem } from './api'

function App() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [reviewingItem, setReviewingItem] = useState<IntakeItem | null>(null)

  function returnToQueue() {
    setReviewingItem(null)
    setRefreshKey((k) => k + 1)
  }

  return (
    <main className="app">
      <h1>Catalog Intake</h1>
      {reviewingItem ? (
        <ReviewScreen item={reviewingItem} onDone={returnToQueue} onCancel={returnToQueue} />
      ) : (
        <>
          <UploadSection onUploaded={() => setRefreshKey((k) => k + 1)} />
          <Queue refreshKey={refreshKey} onReview={setReviewingItem} />
        </>
      )}
    </main>
  )
}

export default App
