/**
 * Async RNC registry validation.
 *
 * Queries the local Next.js proxy route (/api/rnc?rnc={rnc}), which forwards
 * the request server-to-server to Megaplus to bypass CORS restrictions.
 *
 * This runs separately from the synchronous validator — it is triggered in a
 * useEffect after the main validation completes and resolves when the API responds.
 *
 * SILENCE WHEN VALID: this function only returns issues when something is wrong.
 * A clean result produces no output — no "RNC is valid" confirmation message.
 */

import type { InvoiceType, ValidationIssue } from '../types'
import { isValidRNC } from './format-checks'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RNCApiResponse {
  error:                  boolean
  codigo_http:            number
  mensaje:                string
  cedula_rnc?:            string
  nombre_razon_social?:   string
  nombre_comercial?:      string
  estado?:                string
  facturador_electronico?: string
  rnc_consultado?:        string
}

// ── Internals ─────────────────────────────────────────────────────────────────

let _regCounter = 0
function nextId(): string {
  return `reg-${++_regCounter}`
}

function getValue(field: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${field}[^>]*>([^<]+)</${field}>`))
  return m ? m[1].trim() : null
}

/**
 * Fetch RNC data from the Megaplus endpoint with a timeout.
 * Returns null on network error, timeout, or non-200 response.
 */
async function queryRNC(
  rnc: string,
  timeoutMs: number
): Promise<RNCApiResponse | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Call the Next.js API proxy route — avoids CORS restrictions on the browser side.
    // The proxy forwards server-to-server to rnc.megaplus.com.do.
    const res = await fetch(
      `/api/rnc?rnc=${encodeURIComponent(rnc)}`,
      { signal: controller.signal }
    )
    clearTimeout(timer)

    if (!res.ok) return null
    const data: RNCApiResponse = await res.json()
    return data
  } catch {
    clearTimeout(timer)
    return null
  }
}

/**
 * Check a single RNC field against the registry and return any issues.
 */
async function checkSingleRNC(
  fieldName: string,
  rnc: string,
  isEmitter: boolean,
  timeoutMs: number
): Promise<ValidationIssue[]> {
  // If the RNC doesn't pass checksum, format-checks.ts already flagged it.
  // Skip the registry call to avoid a redundant second error card.
  if (!isValidRNC(rnc)) return []

  const issues: ValidationIssue[] = []

  const data = await queryRNC(rnc, timeoutMs)

  // Network error or timeout
  if (data === null) {
    issues.push({
      id: nextId(),
      severity: 'blue',
      field: fieldName,
      line: null,
      message: `No se pudo verificar ${fieldName} "${rnc}" en el registro DGII — verifique la conexión o intente de nuevo.`,
    })
    return issues
  }

  // Megaplus returned an error response — distinguish service failures from genuine "not found".
  // A genuine "not found" has codigo_http=404. Any other error code (200, 500, etc. with
  // error:true) indicates a Megaplus API issue (suspended state, unexpected response, etc.)
  // and should not be treated as a confirmed "not registered" result.
  if (data.error && data.codigo_http !== 404) {
    issues.push({
      id: nextId(),
      severity: 'yellow',
      field: fieldName,
      line: null,
      message: `No se pudo verificar ${fieldName} "${rnc}" en el registro DGII — el servicio de consulta respondió con un error inesperado. Verifica manualmente en Megaplus o intenta de nuevo más tarde.`,
    })
    return issues
  }

  // RNC genuinely not found in registry (Megaplus returned 404)
  if (data.error || data.codigo_http === 404 || !data.estado) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: fieldName,
      line: null,
      message: `${fieldName} "${rnc}" no está registrado en el padrón de la DGII. Verifica que el número sea correcto.`,
    })
    return issues
  }

  // RNC found but not active
  const estado = (data.estado ?? '').toUpperCase().trim()
  if (estado !== 'ACTIVO') {
    const nombre = data.nombre_razon_social ?? rnc
    issues.push({
      id: nextId(),
      severity: 'red',
      field: fieldName,
      line: null,
      message: `${fieldName} "${rnc}" (${nombre}) tiene estado "${estado}" en el registro DGII. Solo contribuyentes ACTIVOS pueden participar en transacciones e-CF.`,
    })
    return issues
  }

  // Emitter must be authorized for electronic invoicing
  if (isEmitter) {
    const facturadorElectronico = (data.facturador_electronico ?? '').toUpperCase().trim()
    if (facturadorElectronico === 'NO' || facturadorElectronico === '') {
      const nombre = data.nombre_razon_social ?? rnc
      issues.push({
        id: nextId(),
        severity: 'yellow',
        field: fieldName,
        line: null,
        message: `${fieldName} "${rnc}" (${nombre}) no está habilitado como Facturador Electrónico en el registro DGII. El emisor de un e-CF debe tener autorización de facturación electrónica.`,
      })
    }
  }

  return issues
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run async RNC registry checks for RNCEmisor and RNCComprador.
 *
 * @param raw         Raw XML string
 * @param invoiceType Detected invoice type
 * @param timeoutMs   Per-request timeout in milliseconds (default: 5000)
 * @returns           Array of ValidationIssues (empty if all RNCs are valid)
 */
export async function checkRNCRegistry(
  raw: string,
  invoiceType: InvoiceType,
  timeoutMs = 5000
): Promise<ValidationIssue[]> {
  _regCounter = 0

  const rncEmisor    = getValue('RNCEmisor', raw)
  const rncComprador = getValue('RNCComprador', raw)

  const checks: Promise<ValidationIssue[]>[] = []

  if (rncEmisor) {
    checks.push(checkSingleRNC('RNCEmisor', rncEmisor, true, timeoutMs))
  }

  if (rncComprador) {
    checks.push(checkSingleRNC('RNCComprador', rncComprador, false, timeoutMs))
  }

  if (checks.length === 0) return []

  // Run both checks in parallel
  const results = await Promise.all(checks)
  return results.flat()
}

/** Reset the registry issue ID counter. */
export function resetRegCounter(): void {
  _regCounter = 0
}