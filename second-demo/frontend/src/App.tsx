import { useState } from 'react'
import UploadSection from './components/UploadSection'
import Queue from './components/Queue'

function App() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <main className="app">
      <h1>Catalog Intake</h1>
      <UploadSection onUploaded={() => setRefreshKey((k) => k + 1)} />
      <Queue refreshKey={refreshKey} />
    </main>
  )
}

export default App
