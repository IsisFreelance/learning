const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type IntakeStatus = 'new' | 'opened' | 'confirmed' | 'rejected' | 'archived' | 'deleted'
export type IntakeSource = 'camera' | 'upload'

export interface IntakeItem {
  id: string
  status: IntakeStatus
  original_filename: string
  mime_type: string
  file_size_bytes: number
  source: IntakeSource
  uploaded_at: string
  image_url: string
  thumbnail_url: string
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  return (body && typeof body.detail === 'string' && body.detail) || fallback
}

export async function uploadIntakeItem(file: File, source: IntakeSource): Promise<IntakeItem> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('source', source)

  const res = await fetch(`${API_BASE_URL}/intake-items`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Upload failed (HTTP ${res.status}).`))
  return res.json()
}

export async function listIntakeItems(status: IntakeStatus | 'all'): Promise<IntakeItem[]> {
  const url = new URL(`${API_BASE_URL}/intake-items`)
  if (status !== 'all') url.searchParams.set('status', status)

  const res = await fetch(url)
  if (!res.ok) throw new Error(await readErrorMessage(res, `Failed to load queue (HTTP ${res.status}).`))
  return res.json()
}

export async function updateIntakeItemStatus(id: string, status: IntakeStatus): Promise<IntakeItem> {
  const res = await fetch(`${API_BASE_URL}/intake-items/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Update failed (HTTP ${res.status}).`))
  return res.json()
}

export interface OcrFieldGuess {
  value: string | null
  confidence: number
  source: string
}

export interface OcrExtractResult {
  raw_text: string
  lines: Array<{ text: string; confidence: number }>
  title_guess: OcrFieldGuess
  price_guess: OcrFieldGuess
}

export async function runOcrExtract(id: string): Promise<OcrExtractResult> {
  const res = await fetch(`${API_BASE_URL}/intake-items/${id}/ocr/extract`, { method: 'POST' })
  if (!res.ok) throw new Error(await readErrorMessage(res, `OCR failed (HTTP ${res.status}).`))
  return res.json()
}
