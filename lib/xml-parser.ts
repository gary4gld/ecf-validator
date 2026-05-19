/**
 * XML parsing utilities.
 *
 * Responsible for detecting document type and extracting key header values
 * from the raw XML string. Does not validate — that's the validator's job.
 */

import type { InvoiceType } from './types'

// ── Invoice type detection ─────────────────────────────────────────────────────

/** Maps TipoeCF numeric string → InvoiceType */
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

/**
 * Detects the invoice type from the raw XML string.
 *
 * Detection order:
 *  1. If the root element is <RFCE> → E-32-R (Resumen de Factura de Consumo)
 *  2. Otherwise expect <ECF> root and read TipoeCF for the type
 *
 * Note: E-32 ECF invoices with MontoTotal < RD$250,000 are classified as 'E-32'
 * here. The threshold note (informing the user an RFCE is required) is added by
 * the cross-field validator, not by the parser.
 */
export function detectInvoiceType(xml: string): InvoiceType {
  // RFCE documents have a different root element entirely
  if (/<RFCE[\s>]/.test(xml)) return 'E-32-R'

  // Standard ECF: read TipoeCF
  const m = xml.match(/<TipoeCF>\s*(\d+)\s*<\/TipoeCF>/)
  if (!m) return 'unknown'

  return TIPO_MAP[m[1]] ?? 'unknown'
}

// ── Field extractors ──────────────────────────────────────────────────────────

function getValue(field: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${field}[^>]*>([^<]+)</${field}>`))
  return m ? m[1].trim() : null
}

/** Returns true if the XML contains a digital signature block. */
export function hasSignature(xml: string): boolean {
  return (
    xml.includes('<ds:Signature') ||
    xml.includes('<Signature ') ||
    xml.includes('<FirmaDigital') ||
    xml.includes('<SignatureValue')
  )
}

/** Extracts RNCEmisor value, or null if absent. */
export function extractRncEmisor(xml: string): string | null {
  return getValue('RNCEmisor', xml)
}

/** Extracts RNCComprador value, or null if absent. */
export function extractRncComprador(xml: string): string | null {
  return getValue('RNCComprador', xml)
}

/** Extracts eNCF value, or null if absent. */
export function extractEncf(xml: string): string | null {
  return getValue('eNCF', xml)
}

/** Extracts MontoTotal as a number, or null if absent/unparseable. */
export function extractMontoTotal(xml: string): number | null {
  const v = getValue('MontoTotal', xml)
  if (!v) return null
  const n = parseFloat(v.replace(/,/g, ''))
  return isNaN(n) ? null : n
}