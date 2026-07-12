import { useEffect, useState } from 'react'
import {
  confirmIntakeItem,
  runOcrExtract,
  runOcrPreflight,
  updateIntakeItemStatus,
  type IntakeItem,
  type OcrFieldGuess,
} from '../api'

function ReviewScreen({ item, onDone, onCancel }: { item: IntakeItem; onDone: () => void; onCancel: () => void }) {
  const [ocrLoading, setOcrLoading] = useState(true)
  const [ocrBlockedReason, setOcrBlockedReason] = useState('')
  const [titleGuess, setTitleGuess] = useState<OcrFieldGuess | null>(null)
  const [priceGuess, setPriceGuess] = useState<OcrFieldGuess | null>(null)

  const [productName, setProductName] = useState('')
  const [productNameOverrideReason, setProductNameOverrideReason] = useState('')
  const [price, setPrice] = useState('')
  const [priceOverrideReason, setPriceOverrideReason] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function openAndExtract() {
      // Best-effort, not blocking: only /confirm actually requires the
      // item to be "opened" server-side, so a failure here (e.g. it's
      // already opened -- StrictMode runs this effect twice in dev, and a
      // real double-open could happen too) shouldn't stop the rest of the
      // review screen from working.
      updateIntakeItemStatus(item.id, 'opened').catch(() => {})

      try {
        const preflight = await runOcrPreflight(item.id)
        if (cancelled) return

        if (preflight.status === 'blocked') {
          setOcrBlockedReason(preflight.reason ?? 'This photo cannot be read by OCR.')
          return
        }

        const result = await runOcrExtract(item.id)
        if (cancelled) return
        setTitleGuess(result.title_guess)
        setPriceGuess(result.price_guess)
        setProductName(result.title_guess.value ?? '')
        setPrice(result.price_guess.value ?? '')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load this item for review.')
      } finally {
        if (!cancelled) setOcrLoading(false)
      }
    }

    openAndExtract()
    return () => {
      cancelled = true
    }
  }, [item.id])

  async function handleConfirm() {
    setError('')
    if (!productName.trim() && !productNameOverrideReason.trim()) {
      setError('Provide a product name, or an override reason if you cannot tell.')
      return
    }
    if (!price.trim() && !priceOverrideReason.trim()) {
      setError('Provide a price, or an override reason if you cannot tell.')
      return
    }

    setSubmitting(true)
    try {
      await confirmIntakeItem(item.id, {
        product_name: productName.trim() || null,
        product_name_override_reason: productNameOverrideReason.trim() || null,
        price: price.trim() || null,
        price_override_reason: priceOverrideReason.trim() || null,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    setSubmitting(true)
    try {
      await updateIntakeItemStatus(item.id, 'new')
    } catch {
      // Best-effort — even if this fails, the item is recoverable later
      // from the "opened" filter tab in the queue.
    } finally {
      setSubmitting(false)
      onCancel()
    }
  }

  return (
    <section className="review-screen">
      <h2>Review</h2>
      <img src={item.image_url} alt={item.original_filename} className="review-photo" />

      {ocrLoading && <p>Reading text from photo…</p>}
      {ocrBlockedReason && <p className="error-text">{ocrBlockedReason} You can still fill in the fields by hand.</p>}

      <div className="review-field">
        <label htmlFor="product-name">Product name</label>
        <input
          id="product-name"
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="e.g. Widget Pro 500"
        />
        {titleGuess && titleGuess.value && (
          <div className="review-hint">
            OCR guessed this from the photo ({titleGuess.confidence}% confidence) — edit it if it's wrong.
          </div>
        )}
        <label htmlFor="product-name-override" className="review-override-label">
          Or, if you can't tell:
        </label>
        <input
          id="product-name-override"
          type="text"
          value={productNameOverrideReason}
          onChange={(e) => setProductNameOverrideReason(e.target.value)}
          placeholder="e.g. label illegible"
        />
      </div>

      <div className="review-field">
        <label htmlFor="price">Price</label>
        <input id="price" type="text" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. $24.99" />
        {priceGuess && priceGuess.value && (
          <div className="review-hint">
            OCR guessed this from the photo ({priceGuess.confidence}% confidence) — edit it if it's wrong.
          </div>
        )}
        <label htmlFor="price-override" className="review-override-label">
          Or, if you can't tell:
        </label>
        <input
          id="price-override"
          type="text"
          value={priceOverrideReason}
          onChange={(e) => setPriceOverrideReason(e.target.value)}
          placeholder="e.g. no price tag in photo"
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="review-actions">
        <button type="button" onClick={handleConfirm} disabled={submitting}>
          Confirm
        </button>
        <button type="button" onClick={handleCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export default ReviewScreen
