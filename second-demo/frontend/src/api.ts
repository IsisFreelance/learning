const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

const TOKEN_STORAGE_KEY = 'admin-session-token'

// The backend gates everything behind a login token (see app/auth.py) --
// this stores it in the browser and attaches it to every request. Kept in
// localStorage (not sessionStorage) so a re-opened tab stays logged in;
// the token itself expires server-side after 7 days regardless.
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function adminLogin(password: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Login failed (HTTP ${res.status}).`))
  const body = await res.json()
  return body.token as string
}

export async function adminCheckSession(): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/admin/me`, { headers: authHeaders() })
  return res.ok
}

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

  const res = await fetch(`${API_BASE_URL}/intake-items`, { method: 'POST', headers: authHeaders(), body: formData })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Upload failed (HTTP ${res.status}).`))
  return res.json()
}

export async function listIntakeItems(status: IntakeStatus | 'all'): Promise<IntakeItem[]> {
  const url = new URL(`${API_BASE_URL}/intake-items`)
  if (status !== 'all') url.searchParams.set('status', status)

  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Failed to load queue (HTTP ${res.status}).`))
  return res.json()
}

export async function updateIntakeItemStatus(id: string, status: IntakeStatus): Promise<IntakeItem> {
  const res = await fetch(`${API_BASE_URL}/intake-items/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
  const res = await fetch(`${API_BASE_URL}/intake-items/${id}/ocr/extract`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await readErrorMessage(res, `OCR failed (HTTP ${res.status}).`))
  return res.json()
}

export interface OcrPreflightResult {
  status: 'cached' | 'available' | 'blocked'
  reason: string | null
}

export async function runOcrPreflight(id: string): Promise<OcrPreflightResult> {
  const res = await fetch(`${API_BASE_URL}/intake-items/${id}/ocr/preflight`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await readErrorMessage(res, `OCR preflight failed (HTTP ${res.status}).`))
  return res.json()
}

export interface ConfirmIn {
  product_name: string | null
  product_name_override_reason: string | null
  price: string | null
  price_override_reason: string | null
}

export interface ConfirmedProduct {
  id: string
  intake_item_id: string
  product_name: string | null
  product_name_source: string
  product_name_override_reason: string | null
  price: string | null
  price_source: string
  price_override_reason: string | null
  confirmed_at: string
}

export async function confirmIntakeItem(id: string, payload: ConfirmIn): Promise<ConfirmedProduct> {
  const res = await fetch(`${API_BASE_URL}/intake-items/${id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Confirm failed (HTTP ${res.status}).`))
  return res.json()
}

export interface ConfirmedProductListItem {
  id: string
  intake_item_id: string
  product_name: string | null
  product_name_source: string
  price: string | null
  price_source: string
  thumbnail_url: string
  confirmed_at: string
  updated_at: string | null
}

export interface ConfirmedProductDetail extends ConfirmedProductListItem {
  product_name_override_reason: string | null
  price_override_reason: string | null
  ocr_raw_text: string | null
  ocr_title_guess: string | null
  ocr_title_confidence: number | null
  ocr_price_guess: string | null
  ocr_price_confidence: number | null
  image_url: string
}

export type ConfirmedProductSort = 'name' | 'price' | 'confirmed_at'
export type SortOrder = 'asc' | 'desc'

export interface ConfirmedProductQuery {
  q?: string
  source?: string
  sort?: ConfirmedProductSort
  order?: SortOrder
  limit?: number
  offset?: number
}

function buildProductsQueryUrl(path: string, query: ConfirmedProductQuery): URL {
  const url = new URL(`${API_BASE_URL}${path}`)
  if (query.q) url.searchParams.set('q', query.q)
  if (query.source) url.searchParams.set('source', query.source)
  if (query.sort) url.searchParams.set('sort', query.sort)
  if (query.order) url.searchParams.set('order', query.order)
  if (query.limit !== undefined) url.searchParams.set('limit', String(query.limit))
  if (query.offset !== undefined) url.searchParams.set('offset', String(query.offset))
  return url
}

export async function listConfirmedProducts(query: ConfirmedProductQuery = {}): Promise<ConfirmedProductListItem[]> {
  const url = buildProductsQueryUrl('/confirmed-products', query)
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Failed to load products (HTTP ${res.status}).`))
  return res.json()
}

export async function getConfirmedProduct(id: string): Promise<ConfirmedProductDetail> {
  const res = await fetch(`${API_BASE_URL}/confirmed-products/${id}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Failed to load product (HTTP ${res.status}).`))
  return res.json()
}

export interface ConfirmedProductPatch {
  product_name: string | null
  product_name_override_reason: string | null
  price: string | null
  price_override_reason: string | null
}

export async function updateConfirmedProduct(id: string, payload: ConfirmedProductPatch): Promise<ConfirmedProductDetail> {
  const res = await fetch(`${API_BASE_URL}/confirmed-products/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Update failed (HTTP ${res.status}).`))
  return res.json()
}

export async function deleteConfirmedProduct(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/confirmed-products/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Delete failed (HTTP ${res.status}).`))
}

export async function exportConfirmedProducts(
  format: 'csv' | 'xlsx',
  query: Omit<ConfirmedProductQuery, 'limit' | 'offset'> = {},
): Promise<void> {
  const url = buildProductsQueryUrl('/confirmed-products/export', query)
  url.searchParams.set('format', format)

  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Export failed (HTTP ${res.status}).`))

  // A plain <a href> can't attach the Authorization header, so the file is
  // fetched here and turned into a temporary local URL the browser can
  // download from instead.
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = `confirmed_products.${format}`
  link.click()
  URL.revokeObjectURL(objectUrl)
}

export interface ProductGroup {
  normalized_name: string
  status: 'ready' | 'blocked'
  canonical_name: string | null
  members: ConfirmedProductListItem[]
}

export interface PossibleDuplicate {
  similarity: number
  group_a: ConfirmedProductListItem[]
  group_b: ConfirmedProductListItem[]
}

export interface ProductGrouping {
  ready_groups: ProductGroup[]
  blocked_groups: ProductGroup[]
  possible_duplicates: PossibleDuplicate[]
}

export async function getConfirmedProductGroups(): Promise<ProductGrouping> {
  const res = await fetch(`${API_BASE_URL}/confirmed-products/groups`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await readErrorMessage(res, `Failed to load duplicate review (HTTP ${res.status}).`))
  return res.json()
}
