/**
 * Async RNC registry validation.
 *
 * Queries the Megaplus public endpoint to verify that RNCEmisor and RNCComprador
 * exist and are active in the DGII registry. This runs separately from the
 * synchronous validator — it is triggered in a useEffect after the main
 * validation completes and resolves when the API responds.
 *
 * Endpoint: GET https://rnc.megaplus.com.do/api/consulta?rnc={rnc}
 *
 * SILENCE WHEN VALID: this function only returns issues when something is wrong.
 * A clean result produces no output — no "RNC is valid" confirmation message.
 *
 * CORS NOTE: if CORS errors occur in production, proxy this call through a
 * Next.js API route at /api/rnc?rnc={rnc} that forwards to Megaplus server-side.
 */

import type { InvoiceType, ValidationIssue } from '../types'

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

// ── Checksum pre-check ────────────────────────────────────────────────────────

/**
 * Quick structural validity check before making an API call.
 * If the RNC fails the checksum, format-checks.ts has already flagged it —
 * no need to add a redundant registry message on top.
 */
function rncPassesChecksum(rnc: string): boolean {
  if (rnc.length === 9) {
    const weights = [7, 9, 8, 6, 5, 4, 3, 2]
    const digits = rnc.split('').map(Number)
    const sum = digits.slice(0, 8).reduce((acc, d, i) => acc + d * weights[i], 0)
    let check = 11 - (sum % 11)
    if (check === 10) check = 1
    if (check === 11) check = 0
    return digits[8] === check
  }
  if (rnc.length === 11) {
    let sum = 0; let isEven = false
    for (let i = rnc.length - 1; i >= 0; i--) {
      let d = parseInt(rnc[i], 10)
      if (isEven) { d *= 2; if (d > 9) d -= 9 }
      sum += d; isEven = !isEven
    }
    return sum % 10 === 0
  }
  return false
}



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
  // Skip the registry call to avoid a redundant or misleading second message.
  if (!rncPassesChecksum(rnc)) return []

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

  // RNC not found in registry
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