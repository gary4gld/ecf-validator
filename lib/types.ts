// ── Invoice types ─────────────────────────────────────────────────────────────
// E-32-R is the summary variant of E-32 for invoices under RD$250,000.
// It's treated as a distinct type so we can load the correct XSD and apply
// the appropriate validation rules independently.

export type InvoiceType =
  | 'E-31'    // Factura de Crédito Fiscal
  | 'E-32'    // Factura de Consumo (full)
  | 'E-32-R'  // Factura de Consumo Resumen (< RD$250,000)
  | 'E-33'    // Nota de Débito
  | 'E-34'    // Nota de Crédito
  | 'E-41'    // Compras
  | 'E-43'    // Gastos Menores
  | 'E-44'    // Regímenes Especiales
  | 'E-45'    // Gubernamentales
  | 'E-46'    // Exportaciones
  | 'E-47'    // Compras al Exterior
  | 'unknown'

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  'E-31':    'E-31 · Factura de Crédito Fiscal',
  'E-32':    'E-32 · Factura de Consumo',
  'E-32-R':  'E-32 Resumen · Factura de Consumo',
  'E-33':    'E-33 · Nota de Débito',
  'E-34':    'E-34 · Nota de Crédito',
  'E-41':    'E-41 · Compras',
  'E-43':    'E-43 · Gastos Menores',
  'E-44':    'E-44 · Regímenes Especiales',
  'E-45':    'E-45 · Gubernamentales',
  'E-46':    'E-46 · Exportaciones',
  'E-47':    'E-47 · Compras al Exterior',
  'unknown': 'Tipo desconocido',
}

// ── Validation ────────────────────────────────────────────────────────────────

export type Severity = 'red' | 'orange' | 'yellow' | 'blue'

export interface ValidationIssue {
  id: string
  severity: Severity
  field: string
  /** Line number in the beautified XML (1-based), or null if not line-specific */
  line: number | null
  message: string
}

// ── XML viewer ────────────────────────────────────────────────────────────────

export interface XmlLine {
  number: number
  content: string
  /** Set by the validator in Stage 2; null means no issue on this line */
  severity: Severity | null
  /** Links this line to a ValidationIssue.id for click-to-scroll */
  issueId: string | null
}

// ── Parsed document ───────────────────────────────────────────────────────────

export interface ParsedXml {
  raw: string
  beautified: string
  lines: XmlLine[]
  invoiceType: InvoiceType
  hasSignature: boolean
  /** Populated by the validator in Stage 2; empty array in Stage 1 */
  issues: ValidationIssue[]
}