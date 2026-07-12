import { useRef, useState } from 'react'
import { uploadIntakeItem, type IntakeSource } from '../api'

function UploadSection({ onUploaded }: { onUploaded: () => void }) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleFiles(files: FileList | null, source: IntakeSource) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        await uploadIntakeItem(file, source)
      }
      onUploaded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="upload-section">
      <h2>Upload photos</h2>
      <div className="upload-buttons">
        <button type="button" disabled={uploading} onClick={() => cameraInputRef.current?.click()}>
          Take photo
        </button>
        <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          Choose photos
        </button>
      </div>

      {/* capture="environment" jumps straight into the phone's camera. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files, 'camera')
          e.target.value = ''
        }}
      />
      {/* No capture attribute -- opens the normal photo library / file picker. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files, 'upload')
          e.target.value = ''
        }}
      />

      {uploading && <p>Uploading…</p>}
      {error && <p className="error-text">{error}</p>}
    </section>
  )
}

export default UploadSection
