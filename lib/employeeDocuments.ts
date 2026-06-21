import { supabase } from './supabase'

export const EMPLOYEE_DOCUMENTS_BUCKET = 'employee-documents'
const DEFAULT_JSPD_HUB_BASE_URL = 'https://hub.jspd.cz'
const HUB_API_TIMEOUT_MS = 20000

export type EmployeeDocumentStatusTone = 'warning' | 'success' | 'danger' | 'muted' | 'info'

type EmployeeDocumentContentField = {
  key?: string | null
  label?: string | null
  value?: string | null
}

type EmployeeDocumentContentSection = {
  title?: string | null
  body?: unknown
}

type EmployeeDocumentContent = {
  fields: EmployeeDocumentContentField[]
  sections: EmployeeDocumentContentSection[]
}

export type EmployeeDocument = {
  id: string
  employeeId: string | null
  title: string
  documentType: string
  status: string
  statusLabel: string
  statusTone: EmployeeDocumentStatusTone
  createdAt: string | null
  validFrom: string | null
  validTo: string | null
  signedAt: string | null
  signatureCount: number
  pdfStoragePath: string | null
  textContent: string | null
  isAwaitingSignature: boolean
  raw: Record<string, any>
}

export type EmployeeDocumentItem = {
  id: string
  label: string
  value: string | null
  sortOrder: number
  raw: Record<string, any>
}

export type EmployeeDocumentSignature = {
  id: string
  signedAt: string | null
  signerName: string | null
  signatureStoragePath: string | null
  raw: Record<string, any>
}

export type EmployeeDocumentDetail = {
  document: EmployeeDocument
  items: EmployeeDocumentItem[]
  signatures: EmployeeDocumentSignature[]
}

function getJspdHubBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_JSPD_HUB_URL?.trim()
  const baseUrl = configured || DEFAULT_JSPD_HUB_BASE_URL

  return baseUrl.replace(/\/+$/, '')
}

function createHubApiUrl(path: string) {
  return `${getJspdHubBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

function firstString(row: Record<string, any>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = row[key]

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return fallback
}

function firstNullableString(row: Record<string, any>, keys: string[]) {
  const value = firstString(row, keys)
  return value.length > 0 ? value : null
}

function firstDateString(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]

    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return null
}

function normalizeStatus(status: string | null | undefined) {
  return (status ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_')
}

function getDocumentTypeLabel(type: string | null | undefined) {
  const normalized = normalizeStatus(type)

  const labels: Record<string, string> = {
    dpp: 'DPP',
    dpc: 'DPC',
    employment_contract: 'Pracovni smlouva',
    bozp: 'BOZP',
    po: 'PO',
    gdpr: 'GDPR',
    confidentiality: 'Mlcenlivost',
    ppe_handover: 'OOPP',
    vehicle_handover: 'Vozidlo',
    tools_handover: 'Naradi',
    equipment_handover: 'Technika',
    risks_acknowledgement: 'Rizika',
    heights_work: 'Prace ve vyskach',
    chemicals: 'Chemie',
    medical_check: 'Lekarska prohlidka',
    certificate: 'Certifikat',
    other: 'Ostatni dokument',
  }

  return labels[normalized] ?? type ?? 'Dokument'
}

export function getDocumentStatusMeta(statusValue: string | null | undefined) {
  const status = normalizeStatus(statusValue)

  if (status === 'pending_signature') {
    return {
      label: 'Ceka na podpis',
      tone: 'warning' as EmployeeDocumentStatusTone,
    }
  }

  if (status === 'signed') {
    return {
      label: 'Podepsano',
      tone: 'success' as EmployeeDocumentStatusTone,
    }
  }

  if (status === 'valid') {
    return {
      label: 'Platne',
      tone: 'success' as EmployeeDocumentStatusTone,
    }
  }

  if (status === 'expiring') {
    return {
      label: 'Konci platnost',
      tone: 'warning' as EmployeeDocumentStatusTone,
    }
  }

  if (status === 'invalid') {
    return {
      label: 'Neplatne',
      tone: 'danger' as EmployeeDocumentStatusTone,
    }
  }

  if (status === 'archived') {
    return {
      label: 'Archiv',
      tone: 'muted' as EmployeeDocumentStatusTone,
    }
  }

  if (status === 'ready') {
    return {
      label: 'Pripraveno',
      tone: 'info' as EmployeeDocumentStatusTone,
    }
  }

  if (status === 'draft') {
    return {
      label: 'Rozpracovano',
      tone: 'muted' as EmployeeDocumentStatusTone,
    }
  }

  if (!status) {
    return {
      label: 'Bez stavu',
      tone: 'muted' as EmployeeDocumentStatusTone,
    }
  }

  return {
    label: statusValue ?? status,
    tone: 'info' as EmployeeDocumentStatusTone,
  }
}

function parseContentJson(value: unknown): EmployeeDocumentContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { fields: [], sections: [] }
  }

  const raw = value as { fields?: unknown; sections?: unknown }
  const fields = Array.isArray(raw.fields) ? raw.fields : []
  const sections = Array.isArray(raw.sections) ? raw.sections : []

  return {
    fields: fields.filter((field): field is EmployeeDocumentContentField => {
      return !!field && typeof field === 'object' && !Array.isArray(field)
    }),
    sections: sections.filter((section): section is EmployeeDocumentContentSection => {
      return !!section && typeof section === 'object' && !Array.isArray(section)
    }),
  }
}

function normalizeSectionBody(body: unknown) {
  if (Array.isArray(body)) {
    return body
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0)
  }

  if (typeof body === 'string' && body.trim().length > 0) {
    return [body.trim()]
  }

  return []
}

function contentToText(contentJson: unknown, notes: string | null) {
  const content = parseContentJson(contentJson)
  const lines: string[] = []

  for (const section of content.sections) {
    const title = section.title?.trim()
    const body = normalizeSectionBody(section.body)

    if (title) {
      lines.push(title)
    }

    lines.push(...body)
  }

  if (lines.length === 0) {
    for (const field of content.fields) {
      const label = field.label?.trim()
      const value = field.value?.trim()

      if (label && value) {
        lines.push(`${label}: ${value}`)
      }
    }
  }

  if (lines.length === 0 && notes?.trim()) {
    lines.push(notes.trim())
  }

  return lines.length > 0 ? lines.join('\n\n') : null
}

export function isDocumentAwaitingSignature(row: Record<string, any>) {
  return normalizeStatus(row.status) === 'pending_signature' && !row.signed_at && !row.locked_at
}

export function mapEmployeeDocument(
  row: Record<string, any>,
  signatureCount = 0,
  latestSignedAt: string | null = null
): EmployeeDocument {
  const status = firstString(row, ['status'], 'unknown')
  const statusMeta = getDocumentStatusMeta(status)
  const signedAt = latestSignedAt ?? firstDateString(row, ['signed_at'])

  return {
    id: String(row.id),
    employeeId: firstNullableString(row, ['employee_id']),
    title: firstString(row, ['title'], 'Dokument bez nazvu'),
    documentType: getDocumentTypeLabel(firstNullableString(row, ['document_type'])),
    status,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    createdAt: firstDateString(row, ['created_at']),
    validFrom: firstDateString(row, ['valid_from']),
    validTo: firstDateString(row, ['valid_until']),
    signedAt,
    signatureCount,
    pdfStoragePath: firstNullableString(row, ['file_path']),
    textContent: contentToText(row.content_json, firstNullableString(row, ['notes'])),
    isAwaitingSignature: isDocumentAwaitingSignature({
      ...row,
      signed_at: signedAt,
    }),
    raw: row,
  }
}

function formatQuantity(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

function mapDocumentItem(row: Record<string, any>, index: number): EmployeeDocumentItem {
  const parts = [
    formatQuantity(row.quantity) ? `Pocet: ${formatQuantity(row.quantity)}` : null,
    row.condition_on_handover ? `Stav pri predani: ${row.condition_on_handover}` : null,
    row.condition_on_return ? `Stav pri vraceni: ${row.condition_on_return}` : null,
    row.returned_at ? `Vraceno: ${row.returned_at}` : null,
    row.notes ? String(row.notes) : null,
  ].filter((value): value is string => Boolean(value))

  return {
    id: String(row.id ?? `${index}`),
    label: firstString(row, ['item_name'], `Polozka ${index + 1}`),
    value: parts.length > 0 ? parts.join('\n') : null,
    sortOrder: index,
    raw: row,
  }
}

function mapSignature(row: Record<string, any>): EmployeeDocumentSignature {
  return {
    id: String(row.id),
    signedAt: firstDateString(row, ['signed_at']),
    signerName: firstNullableString(row, ['signer_name']),
    signatureStoragePath: firstNullableString(row, ['signature_path']),
    raw: row,
  }
}

function getLatestSignatureAt(signatures: EmployeeDocumentSignature[]) {
  return (
    signatures
      .map((item) => item.signedAt)
      .filter((value): value is string => !!value)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
  )
}

export async function loadEmployeeDocuments(profileId: string): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase
    .from('employee_documents')
    .select('id, employee_id, document_type, title, status, valid_from, valid_until, signed_at, created_at, file_path, content_json, notes, locked_at')
    .eq('employee_id', profileId)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  const rows = (data ?? []) as Record<string, any>[]
  const ids = rows.map((row) => String(row.id)).filter(Boolean)
  const signaturesByDocumentId = new Map<string, EmployeeDocumentSignature[]>()

  if (ids.length > 0) {
    const { data: signatureRows, error: signatureError } = await supabase
      .from('employee_document_signatures')
      .select('id, document_id, signer_name, signer_role, signature_path, signed_at')
      .in('document_id', ids)

    if (!signatureError) {
      for (const signatureRow of (signatureRows ?? []) as Record<string, any>[]) {
        const documentId = String(signatureRow.document_id)
        const current = signaturesByDocumentId.get(documentId) ?? []
        current.push(mapSignature(signatureRow))
        signaturesByDocumentId.set(documentId, current)
      }
    } else {
      console.warn('EMPLOYEE_DOCUMENT_SIGNATURE_COUNT_LOAD_FAILED', signatureError)
    }
  }

  return rows.map((row) => {
    const signatures = signaturesByDocumentId.get(String(row.id)) ?? []
    return mapEmployeeDocument(row, signatures.length, getLatestSignatureAt(signatures))
  })
}

export async function loadEmployeeDocumentDetail(
  documentId: string,
  profileId: string
): Promise<EmployeeDocumentDetail | null> {
  const { data: documentRow, error: documentError } = await supabase
    .from('employee_documents')
    .select('id, employee_id, document_type, title, status, valid_from, valid_until, signed_at, created_at, file_path, content_json, notes, locked_at')
    .eq('id', documentId)
    .eq('employee_id', profileId)
    .maybeSingle()

  if (documentError) {
    throw documentError
  }

  if (!documentRow) {
    return null
  }

  const [itemsResult, signaturesResult] = await Promise.all([
    supabase
      .from('employee_document_items')
      .select('id, item_name, quantity, condition_on_handover, condition_on_return, returned_at, notes, created_at')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true }),
    supabase
      .from('employee_document_signatures')
      .select('id, document_id, signer_name, signer_role, signature_path, signed_at')
      .eq('document_id', documentId)
      .order('signed_at', { ascending: false }),
  ])

  if (itemsResult.error) {
    throw itemsResult.error
  }

  if (signaturesResult.error) {
    throw signaturesResult.error
  }

  const signatures = ((signaturesResult.data ?? []) as Record<string, any>[]).map(mapSignature)
  const document = mapEmployeeDocument(
    documentRow as Record<string, any>,
    signatures.length,
    getLatestSignatureAt(signatures)
  )

  const items = ((itemsResult.data ?? []) as Record<string, any>[])
    .map(mapDocumentItem)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return {
    document,
    items,
    signatures,
  }
}

function normalizeStoragePath(path: string | null) {
  if (!path) return null

  const trimmed = path.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  const withoutLeadingSlash = trimmed.replace(/^\/+/, '')
  const bucketPrefix = `${EMPLOYEE_DOCUMENTS_BUCKET}/`

  if (withoutLeadingSlash.startsWith(bucketPrefix)) {
    return withoutLeadingSlash.slice(bucketPrefix.length)
  }

  return withoutLeadingSlash
}

export async function createEmployeeDocumentPdfUrl(document: EmployeeDocument) {
  const storagePath = normalizeStoragePath(document.pdfStoragePath)

  if (!storagePath) {
    return null
  }

  if (/^https?:\/\//i.test(storagePath)) {
    return storagePath
  }

  const { data, error } = await supabase.storage
    .from(EMPLOYEE_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 60 * 10)

  if (error) {
    throw error
  }

  return data?.signedUrl ?? null
}

function validateSignatureDataUrl(value: string) {
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i)

  if (!match || match[2].length < 120) {
    throw new Error('Podpisove pole je prazdne nebo nema platny format.')
  }
}

async function readJsonResponse(response: Response) {
  const text = await response.text()

  if (!text) return null

  try {
    return JSON.parse(text) as { error?: string; ok?: boolean }
  } catch {
    return { error: text }
  }
}

function getHubSignErrorMessage(status: number, result: { error?: string } | null, endpoint: string) {
  if (result?.error) {
    return result.error
  }

  if (status === 401) {
    return 'Hub neprijal prihlaseni z mobilu. Odhlas se a prihlas znovu, pripadne zkontroluj deploy Hubu.'
  }

  if (status === 403) {
    return 'Tento dokument nepatri prihlasenemu zamestnanci.'
  }

  if (status === 404) {
    return 'Dokument uz Hub nenasel. Obnov seznam dokumentu.'
  }

  if (status === 409) {
    return 'Dokument uz neni pripraveny k podpisu. Obnov detail dokumentu.'
  }

  if (status >= 500) {
    return 'Hub podpis prijal, ale selhalo ulozeni, storage nebo obnova PDF. Zkontroluj log Hubu.'
  }

  return `Podpis se nepodarilo ulozit. Hub vratil ${status} (${endpoint}).`
}

export async function signEmployeeDocument(params: {
  documentId: string
  signatureDataUrl: string
  accessToken: string | null | undefined
}) {
  validateSignatureDataUrl(params.signatureDataUrl)

  if (!params.accessToken) {
    throw new Error('Chybi prihlasovaci token. Prihlas se prosim znovu.')
  }

  const endpoint = createHubApiUrl(`/api/employee-documents/${encodeURIComponent(params.documentId)}/sign`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HUB_API_TIMEOUT_MS)

  let response: Response
  try {
    console.log('EMPLOYEE_DOCUMENT_SIGN_REQUEST', {
      endpoint,
      documentId: params.documentId,
      hasAccessToken: Boolean(params.accessToken),
    })

    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        signatureDataUrl: params.signatureDataUrl,
      }),
      signal: controller.signal,
    })
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Hub neodpovedel do ${Math.round(HUB_API_TIMEOUT_MS / 1000)} sekund (${endpoint}).`)
    }

    throw new Error(`Nepodarilo se spojit s Hubem (${endpoint}). Zkontroluj internet a adresu Hubu.`)
  } finally {
    clearTimeout(timeout)
  }

  const result = await readJsonResponse(response)
  console.log('EMPLOYEE_DOCUMENT_SIGN_RESPONSE', {
    endpoint,
    documentId: params.documentId,
    status: response.status,
    ok: response.ok,
    error: result?.error ?? null,
  })

  if (!response.ok) {
    throw new Error(getHubSignErrorMessage(response.status, result, endpoint))
  }

  return {
    ok: true,
  }
}
