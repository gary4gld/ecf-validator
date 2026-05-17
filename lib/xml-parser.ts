import type { InvoiceType } from './types'

// ── Invoice type detection ─────────────────────────────────────────────────────

/** Maps the numeric TipoeCF field value to our InvoiceType string. */
const TIPO_MAP: Record<string, InvoiceType> = {
  '31': 'E-31',
  '32': 'E-32',
  '33': 'E-33',
  '34': 'E-34',
  '41': 'E-41',
  '43': 'E-43',
  '44': 'E-44',
  '45': 'E-45',
  '46': 'E-46',
  '47': 'E-47',
}

/** E-32 invoices below this threshold use the summary (Resumen) flow. */
const E32_SUMMARY_THRESHOLD = 250_000

/**
 * Reads TipoeCF from the raw XML string and returns the matching InvoiceType.
 * For E-32, also checks MontoTotal to determine if it qualifies as a summary.
 *
 * We intentionally read from the raw string rather than a parsed DOM so this
 * function works even when the XML is partially malformed.
 */
export function detectInvoiceType(xml: string): InvoiceType {
  const tipoMatch = xml.match(/<TipoeCF>\s*(\d+)\s*<\/TipoeCF>/)
  if (!tipoMatch) return 'unknown'

  const baseType = TIPO_MAP[tipoMatch[1]]
  if (!baseType) return 'unknown'

  if (baseType === 'E-32') {
    // Look for MontoTotal to decide between full and summary E-32
    const totalMatch = xml.match(/<MontoTotal>\s*([\d.,]+)\s*<\/MontoTotal>/)
    if (totalMatch) {
      // Normalise: remove thousands separators, accept both . and , as decimal
      const raw = totalMatch[1].replace(/,(?=\d{3})/g, '')
      const total = parseFloat(raw)
      if (!isNaN(total) && total < E32_SUMMARY_THRESHOLD) {
        return 'E-32-R'
      }
    }
  }

  return baseType
}

// ── Signature detection ────────────────────────────────────────────────────────

/**
 * Returns true if the XML contains any recognisable signature element.
 * We check several possible marker elements rather than a single one to be
 * resilient to minor variation in where the signature block appears.
 */
export function hasSignature(xml: string): boolean {
  return (
    xml.includes('<FirmaDigital') ||
    xml.includes('<DigestValue') ||
    xml.includes('<SignatureValue') ||
    xml.includes('<ds:Signature') ||
    xml.includes('<Signature ')
  )
}

// ── RNC extraction ─────────────────────────────────────────────────────────────

/** Extracts the emitter RNC from the raw XML, or null if not found. */
export function extractRncEmisor(xml: string): string | null {
  const match = xml.match(/<RNCEmisor>\s*(\d+)\s*<\/RNCEmisor>/)
  return match ? match[1].trim() : null
}

/** Extracts the buyer RNC from the raw XML, or null if not present. */
export function extractRncComprador(xml: string): string | null {
  const match = xml.match(/<RNCComprador>\s*(\d+)\s*<\/RNCComprador>/)
  return match ? match[1].trim() : null
}

/** Extracts the eNCF (fiscal number) from the raw XML, or null if not found. */
export function extractEncf(xml: string): string | null {
  const match = xml.match(/<eNCF>\s*([A-Z]\d+)\s*<\/eNCF>/)
  return match ? match[1].trim() : null
}