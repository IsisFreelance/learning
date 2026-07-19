import { useEffect, useState } from 'react'
import { deleteConfirmedProduct, getConfirmedProduct, updateConfirmedProduct, type ConfirmedProductDetail } from '../api'

function ProductDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [product, setProduct] = useState<ConfirmedProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [productName, setProductName] = useState('')
  const [productNameOverrideReason, setProductNameOverrideReason] = useState('')
  const [price, setPrice] = useState('')
  const [priceOverrideReason, setPriceOverrideReason] = useState('')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getConfirmedProduct(id)
      .then((data) => {
        if (cancelled) return
        setProduct(data)
        setProductName(data.product_name ?? '')
        setPrice(data.price ?? '')
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load product.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

  async function handleSave() {
    setError('')
    if (!productName.trim() && !productNameOverrideReason.trim()) {
      setError('Provide a product name, or an override reason if you cannot tell.')
      return
    }
    if (!price.trim() && !priceOverrideReason.trim()) {
      setError('Provide a price, or an override reason if you cannot tell.')
      return
    }

    setSaving(true)
    try {
      await updateConfirmedProduct(id, {
        product_name: productName.trim() || null,
        product_name_override_reason: productNameOverrideReason.trim() || null,
        price: price.trim() || null,
        price_override_reason: priceOverrideReason.trim() || null,
      })
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError('')
    try {
      await deleteConfirmedProduct(id)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
      setDeleting(false)
    }
  }

  if (loading) return <p>Loading…</p>
  if (!product) return <p className="error-text">{error || 'Not found.'}</p>

  return (
    <section className="review-screen">
      <button type="button" onClick={onClose}>
        ← Back to list
      </button>

      <img src={product.image_url} alt={product.product_name ?? 'Product photo'} className="review-photo" />

      <div className="review-field">
        <label htmlFor="edit-product-name">Product name</label>
        <input id="edit-product-name" type="text" value={productName} onChange={(e) => setProductName(e.target.value)} />
        {product.ocr_title_guess && (
          <div className="review-hint">OCR originally guessed: {product.ocr_title_guess}</div>
        )}
        <label htmlFor="edit-product-name-override" className="review-override-label">
          Or, if you can't tell:
        </label>
        <input
          id="edit-product-name-override"
          type="text"
          value={productNameOverrideReason}
          onChange={(e) => setProductNameOverrideReason(e.target.value)}
        />
      </div>

      <div className="review-field">
        <label htmlFor="edit-price">Price</label>
        <input id="edit-price" type="text" value={price} onChange={(e) => setPrice(e.target.value)} />
        {product.ocr_price_guess && <div className="review-hint">OCR originally guessed: {product.ocr_price_guess}</div>}
        <label htmlFor="edit-price-override" className="review-override-label">
          Or, if you can't tell:
        </label>
        <input id="edit-price-override" type="text" value={priceOverrideReason} onChange={(e) => setPriceOverrideReason(e.target.value)} />
      </div>

      <p className="review-hint">
        Confirmed {new Date(product.confirmed_at).toLocaleString()}
        {product.updated_at && ` · edited ${new Date(product.updated_at).toLocaleString()}`}
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="review-actions">
        <button type="button" onClick={handleSave} disabled={saving || deleting}>
          Save changes
        </button>
        {confirmingDelete ? (
          <>
            <span>Delete this product?</span>
            <button type="button" onClick={handleDelete} disabled={deleting}>
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmingDelete(true)} disabled={saving || deleting}>
            Delete
          </button>
        )}
      </div>
    </section>
  )
}

export default ProductDetail
