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
  actividad_economica?:   string
  categoria?:             string
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

// ── Business-context hints (advisory, from the emitter's DGII registration) ────

/** Normalize text for matching: strip accents, uppercase, collapse whitespace. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

interface ActivityCategory {
  label: string
  /** Emitter's actividad_economica belongs to this category if it contains any of these. */
  activity: string[]
  /** An item belongs to this category if its name contains any of these — CONCRETE
   *  PRODUCTS ONLY, never generic service words (consultoría, soporte, hora…), which
   *  cross industries and would produce false advisories. */
  items: string[]
}

/**
 * Small, deliberately conservative map of DGII economic-activity categories.
 * Extend as real actividad_economica strings are observed in the wild.
 */
const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  {
    label: 'tecnología / software',
    activity: ['SOFTWARE', 'INFORMATICA', 'PROGRAMAS DE INFORMATICA', 'TECNOLOGIA', 'COMPUTAC', 'DESARROLLO DE SOFTWARE', 'CONSULTORES EN INFORMATICA'],
    items: ['SOFTWARE', 'LICENCIA DE SOFTWARE', 'APLICACION', 'APLICATIVO'],
  },
  {
    label: 'ferretería / construcción',
    activity: ['FERRETERIA', 'CONSTRUCCION', 'MATERIALES DE CONSTRUCCION'],
    items: ['CEMENTO', 'VARILLA', 'PINTURA', 'TUBERIA', 'BLOQUE', 'ACERO'],
  },
  {
    label: 'alimentos / bebidas',
    activity: ['RESTAURANTE', 'ALIMENTOS', 'BEBIDAS', 'SUPERMERCADO', 'COLMADO'],
    items: ['LECHE', 'POLLO', 'CARNE DE', 'ARROZ', 'CERVEZA', 'REFRESCO'],
  },
  {
    label: 'farmacia / salud',
    activity: ['FARMACIA', 'FARMACEUTIC'],
    items: ['MEDICAMENTO', 'MEDICINA', 'ANTIBIOTIC', 'JARABE'],
  },
  {
    label: 'combustibles / vehículos',
    activity: ['COMBUSTIBLE', 'GASOLINA', 'ESTACION DE COMBUSTIBLE', 'REPUESTOS', 'VEHICULOS'],
    items: ['GASOLINA', 'GASOIL', 'NEUMATICO'],
  },
]

function matchCategories(text: string, key: 'activity' | 'items'): Set<string> {
  const n = norm(text)
  const out = new Set<string>()
  for (const cat of ACTIVITY_CATEGORIES) {
    if (cat[key].some((kw) => n.includes(kw))) out.add(cat.label)
  }
  return out
}

function extractItemNames(raw: string): string[] {
  const out: string[] = []
  const re = /<NombreItem[^>]*>([^<]+)<\/NombreItem>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out.push(m[1].trim())
  return out
}

/**
 * Advisory business-context hints derived from the emitter's DGII registration.
 * PURE + exported so it is unit-testable without any network call. Two layers,
 * both severity 'advisory' (Consideraciones lane), never affecting validity:
 *   1. Context — surface the emitter's registered actividad/categoría (always, when known).
 *   2. Mismatch — flag an item whose name is a concrete product of a DIFFERENT industry
 *      than the emitter's registered activity. Fires only when the emitter's activity is
 *      recognized AND an item clearly belongs to another category; silent otherwise.
 * Phrased as an observation, never a hard assertion.
 */
export function getBusinessContextHints(
  data: RNCApiResponse,
  raw: string,
  maxItemFlags = 3,
): ValidationIssue[] {
  const actividad = (data.actividad_economica ?? '').trim()
  if (!actividad) return []

  const issues: ValidationIssue[] = []
  const categoria = (data.categoria ?? '').trim()
  const razon = (data.nombre_razon_social ?? '').trim()

  // Layer 1 — context (always, when the activity is known)
  issues.push({
    id: nextId(),
    severity: 'advisory',
    field: 'Actividad del emisor',
    line: null,
    message:
      `El emisor${razon ? ` (${razon})` : ''} está registrado en DGII con la actividad económica ` +
      `«${actividad}»${categoria ? `, categoría «${categoria}»` : ''}. Esta validación no comprueba ` +
      `que los ítems facturados correspondan a esa actividad; se muestra solo como contexto.`,
  })

  // Layer 2 — conservative per-item mismatch (only if we recognize the emitter's activity)
  const emitterCats = matchCategories(actividad, 'activity')
  if (emitterCats.size > 0) {
    const seen = new Set<string>()
    let flags = 0
    for (const name of extractItemNames(raw)) {
      if (flags >= maxItemFlags) break
      const itemCats = matchCategories(name, 'items')
      if (itemCats.size === 0) continue
      const allForeign = [...itemCats].every((c) => !emitterCats.has(c))
      const key = norm(name)
      if (allForeign && !seen.has(key)) {
        seen.add(key)
        flags++
        issues.push({
          id: nextId(),
          severity: 'advisory',
          field: 'Contexto de negocio',
          line: null,
          message:
            `El ítem «${name}» no parece corresponder a la actividad económica registrada del emisor ` +
            `(«${actividad}»). Es solo una observación de contexto; no afecta la validez del e-CF — ` +
            `verifique si corresponde.`,
        })
      }
    }
  }

  return issues
}

/**
 * Check a single RNC field against the registry and return any issues.
 */
async function checkSingleRNC(
  fieldName: string,
  rnc: string,
  isEmitter: boolean,
  timeoutMs: number,
  raw: string
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

    // Advisory business-context hints derived from the emitter's registered activity.
    issues.push(...getBusinessContextHints(data, raw))
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
    checks.push(checkSingleRNC('RNCEmisor', rncEmisor, true, timeoutMs, raw))
  }

  if (rncComprador) {
    checks.push(checkSingleRNC('RNCComprador', rncComprador, false, timeoutMs, raw))
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