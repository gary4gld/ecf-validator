/**
 * Sequence validation — detects fields that are out of order.
 *
 * DGII XSD schemas use xs:sequence, which means elements MUST appear in the
 * exact order defined in the schema. Out-of-order documents fail validation
 * with a cryptic "element X is not expected" error that gives no diagnostic
 * information about ordering.
 *
 * This checker:
 *  1. Parses the XML into a DOM tree (DOMParser — browser-only)
 *  2. Extracts direct child element names from each section in document order
 *  3. Compares actual order against the expected order (hardcoded from XSDs)
 *  4. Reports any element found after an element that should come after it
 *
 * ALGORITHM:
 *   For each pair (actual[i], actual[j]) where i < j (i appears before j):
 *     If expectedPos[actual[i]] > expectedPos[actual[j]]:
 *       actual[j] should appear before actual[i] — report actual[j] as out-of-order
 *   Each out-of-order element is reported at most once.
 *
 * SEQUENCES: Hardcoded from official DGII XSD schemas v1.0, September 2024.
 * Only direct children of each section are listed (not nested elements).
 * Fields inside container tables (TablaFormasPago, ImpuestosAdicionales, etc.)
 * are checked as a single element at their parent level.
 *
 * SEVERITY: Red — DGII rejects documents with out-of-order elements.
 */

import type { InvoiceType, ValidationIssue, XmlLine } from '../types'

// ── Internals ─────────────────────────────────────────────────────────────────

let _seqCounter = 0
function nextId(): string {
  return `seq-${++_seqCounter}`
}

function findLine(pattern: RegExp, lines: XmlLine[]): number | null {
  for (const l of lines) {
    if (pattern.test(l.content)) return l.number
  }
  return null
}

// ── Expected sequences (hardcoded from XSDs) ──────────────────────────────────

/**
 * Root-level ECF children (Encabezado → DetallesItems → ... → FechaHoraFirma).
 * Same for all ECF types.
 */
const ECF_ROOT: string[] = [
  'Encabezado',
  'DetallesItems',
  'Subtotales',
  'DescuentosORecargos',
  'Paginacion',
  'InformacionReferencia',
  'FechaHoraFirma',
]

/**
 * RFCE root children (different document type).
 */
const RFCE_ROOT: string[] = [
  'Encabezado',
  'FechaHoraFirma',
]

/**
 * Encabezado section children — order of major sub-sections.
 * Same for all types (some sections may be absent per type rules).
 */
const ENCABEZADO_SECTIONS: string[] = [
  'Version',
  'IdDoc',
  'Emisor',
  'Comprador',
  'InformacionesAdicionales',
  'Transporte',
  'Totales',
  'OtraMoneda',
]

/**
 * IdDoc field sequences, per invoice type.
 * Derived from xs:sequence within each type's XSD.
 * TablaFormasPago appears as a single element (wrapper for FormaPago/MontoPago).
 */
const IDDOC_SEQUENCES: Partial<Record<InvoiceType, string[]>> = {
  'E-31': [
    'TipoeCF', 'eNCF', 'FechaVencimientoSecuencia',
    'IndicadorEnvioDiferido', 'IndicadorMontoGravado', 'IndicadorServicioTodoIncluido',
    'TipoIngresos', 'TipoPago', 'FechaLimitePago', 'TerminoPago',
    'TablaFormasPago', 'TipoCuentaPago', 'NumeroCuentaPago', 'BancoPago',
    'FechaDesde', 'FechaHasta', 'TotalPaginas',
  ],
  'E-32': [
    'TipoeCF', 'eNCF',
    'IndicadorEnvioDiferido', 'IndicadorMontoGravado', 'IndicadorServicioTodoIncluido',
    'TipoIngresos', 'TipoPago', 'FechaLimitePago', 'TerminoPago',
    'TablaFormasPago', 'TipoCuentaPago', 'NumeroCuentaPago', 'BancoPago',
    'FechaDesde', 'FechaHasta', 'TotalPaginas',
  ],
  'E-33': [
    'TipoeCF', 'eNCF', 'FechaVencimientoSecuencia',
    'IndicadorEnvioDiferido', 'IndicadorMontoGravado', 'IndicadorServicioTodoIncluido',
    'TipoIngresos', 'TipoPago', 'FechaLimitePago', 'TerminoPago',
    'TablaFormasPago', 'TipoCuentaPago', 'NumeroCuentaPago', 'BancoPago',
    'FechaDesde', 'FechaHasta', 'TotalPaginas',
  ],
  'E-34': [
    'TipoeCF', 'eNCF', 'IndicadorNotaCredito',
    'IndicadorEnvioDiferido', 'IndicadorMontoGravado', 'IndicadorServicioTodoIncluido',
    'TipoIngresos', 'TipoPago', 'FechaLimitePago',
    'FechaDesde', 'FechaHasta', 'TotalPaginas',
  ],
  'E-41': [
    'TipoeCF', 'eNCF', 'FechaVencimientoSecuencia',
    'IndicadorMontoGravado', 'TipoPago', 'FechaLimitePago', 'TerminoPago',
    'TablaFormasPago', 'TipoCuentaPago', 'NumeroCuentaPago', 'BancoPago',
    'TotalPaginas',
  ],
  'E-43': [
    'TipoeCF', 'eNCF', 'FechaVencimientoSecuencia', 'TipoPago', 'TotalPaginas',
  ],
  'E-44': [
    'TipoeCF', 'eNCF', 'FechaVencimientoSecuencia',
    'IndicadorEnvioDiferido', 'IndicadorServicioTodoIncluido',
    'TipoIngresos', 'TipoPago', 'FechaLimitePago', 'TerminoPago',
    'TablaFormasPago', 'TipoCuentaPago', 'NumeroCuentaPago', 'BancoPago',
    'FechaDesde', 'FechaHasta', 'TotalPaginas',
  ],
  'E-45': [
    'TipoeCF', 'eNCF', 'FechaVencimientoSecuencia',
    'IndicadorEnvioDiferido', 'IndicadorMontoGravado', 'IndicadorServicioTodoIncluido',
    'TipoIngresos', 'TipoPago', 'FechaLimitePago', 'TerminoPago',
    'TablaFormasPago', 'TipoCuentaPago', 'NumeroCuentaPago', 'BancoPago',
    'FechaDesde', 'FechaHasta', 'TotalPaginas',
  ],
  'E-46': [
    'TipoeCF', 'eNCF', 'FechaVencimientoSecuencia',
    'IndicadorEnvioDiferido', 'TipoIngresos', 'TipoPago', 'FechaLimitePago', 'TerminoPago',
    'TablaFormasPago', 'TipoCuentaPago', 'NumeroCuentaPago', 'BancoPago',
    'FechaDesde', 'FechaHasta', 'TotalPaginas',
  ],
  'E-47': [
    'TipoeCF', 'eNCF', 'FechaVencimientoSecuencia',
    'TipoPago', 'FechaLimitePago', 'TerminoPago',
    'TablaFormasPago', 'TipoCuentaPago', 'NumeroCuentaPago', 'BancoPago',
    'FechaDesde', 'FechaHasta', 'TotalPaginas',
  ],
  'E-32-R': [
    'TipoeCF', 'eNCF', 'TipoIngresos', 'TipoPago', 'TablaFormasPago',
  ],
}

/**
 * Emisor field sequence — same for all ECF types.
 * Critical: FechaEmision is the LAST field (counterintuitive, causes many ordering bugs).
 */
const EMISOR_SEQUENCE: string[] = [
  'RNCEmisor', 'RazonSocialEmisor', 'NombreComercial', 'Sucursal',
  'DireccionEmisor', 'Municipio', 'Provincia',
  'TablaTelefonoEmisor', 'CorreoEmisor', 'WebSite', 'ActividadEconomica',
  'CodigoVendedor', 'NumeroFacturaInterna', 'NumeroPedidoInterno',
  'ZonaVenta', 'RutaVenta', 'InformacionAdicionalEmisor',
  'FechaEmision',  // ← LAST — a very common ordering mistake
]

/**
 * RFCE Emisor — simplified.
 */
const RFCE_EMISOR_SEQUENCE: string[] = [
  'RNCEmisor', 'RazonSocialEmisor', 'FechaEmision',
]

/**
 * Comprador field sequences — varies by type.
 * E-32/33/34 add IdentificadorExtranjero after RNCComprador.
 * E-41 has a shorter set.
 */
const COMPRADOR_SEQUENCES: Partial<Record<InvoiceType, string[]>> = {
  // Full comprador (E-31, E-33, E-44, E-45)
  'E-31': [
    'RNCComprador', 'RazonSocialComprador', 'ContactoComprador', 'CorreoComprador',
    'DireccionComprador', 'MunicipioComprador', 'ProvinciaComprador',
    'FechaEntrega', 'ContactoEntrega', 'DireccionEntrega', 'TelefonoAdicional',
    'FechaOrdenCompra', 'NumeroOrdenCompra', 'CodigoInternoComprador',
    'ResponsablePago', 'InformacionAdicionalComprador', 'InformacionesAdicionales',
    'FechaEmbarque', 'NumeroEmbarque', 'NumeroContenedor',
  ],
  // E-32 Comprador adds IdentificadorExtranjero after RNCComprador
  'E-32': [
    'RNCComprador', 'IdentificadorExtranjero', 'RazonSocialComprador',
    'ContactoComprador', 'CorreoComprador', 'DireccionComprador',
    'MunicipioComprador', 'ProvinciaComprador',
    'FechaEntrega', 'ContactoEntrega', 'DireccionEntrega', 'TelefonoAdicional',
  ],
  // E-41 Comprador — shorter set, no delivery/order fields
  'E-41': [
    'RNCComprador', 'RazonSocialComprador', 'ContactoComprador', 'CorreoComprador',
    'DireccionComprador', 'MunicipioComprador', 'ProvinciaComprador',
    'CodigoInternoComprador', 'ResponsablePago', 'InformacionAdicionalComprador',
  ],
  // E-47 Comprador — only two fields. RNCComprador does NOT exist in E-47 schema.
  // Recipients are always non-resident foreigners without a Dominican RNC.
  'E-47': [
    'IdentificadorExtranjero',
    'RazonSocialComprador',
  ],
}

// Types that share the E-31 full Comprador sequence
const COMPRADOR_FULL_TYPES: InvoiceType[] = ['E-33', 'E-34', 'E-44', 'E-45', 'E-46']

/**
 * Totales field sequence — same for all ECF types that have it.
 * ImpuestosAdicionales is the container table for selective consumption taxes.
 */
const TOTALES_SEQUENCE: string[] = [
  'MontoGravadoTotal', 'MontoGravadoI1', 'MontoGravadoI2', 'MontoGravadoI3',
  'MontoExento',
  'ITBIS1', 'ITBIS2', 'ITBIS3',
  'TotalITBIS', 'TotalITBIS1', 'TotalITBIS2', 'TotalITBIS3',
  'MontoImpuestoAdicional', 'ImpuestosAdicionales',
  'MontoTotal', 'MontoNoFacturable', 'MontoPeriodo',
  'SaldoAnterior', 'MontoAvancePago', 'ValorPagar',
  'TotalITBISRetenido', 'TotalISRRetencion',
  'TotalITBISPercepcion', 'TotalISRPercepcion',
]

/**
 * InformacionReferencia sequence — same for E-33 and E-34.
 */
const INFO_REFERENCIA_SEQUENCE: string[] = [
  'NCFModificado', 'RNCOtroContribuyente', 'FechaNCFModificado',
  'CodigoModificacion', 'RazonModificacion',
]

// ── DOM parsing utilities ─────────────────────────────────────────────────────

/**
 * Parse XML string into a DOM Document.
 * Returns null if DOMParser is unavailable (SSR) or XML is malformed.
 */
function parseDOM(xml: string): Document | null {
  if (typeof window === 'undefined' || !window.DOMParser) return null
  try {
    const parser = new window.DOMParser()
    const doc = parser.parseFromString(xml, 'application/xml')
    // Check for parse errors
    const error = doc.querySelector('parsererror')
    return error ? null : doc
  } catch {
    return null
  }
}

/**
 * Get the tag names of direct element children of a DOM element.
 */
function directChildren(element: Element): string[] {
  return Array.from(element.children).map(el => el.tagName)
}

/**
 * Find a section element by tag name within the document.
 */
function findSection(doc: Document, tagName: string): Element | null {
  return doc.querySelector(tagName)
}

// ── Order comparison algorithm ─────────────────────────────────────────────────

/**
 * Compare actual field order against expected sequence.
 * Returns ValidationIssues for fields that appear out of order.
 *
 * Algorithm: For each pair (actual[i], actual[j]) where i < j (i appears first
 * in document), if expectedPos[i] > expectedPos[j], then actual[j] should come
 * before actual[i] — it's out of order. Report each affected field once.
 */
function checkOrder(
  sectionTag: string,
  actualChildren: string[],
  expected: string[],
  lines: XmlLine[]
): ValidationIssue[] {
  if (actualChildren.length === 0 || expected.length === 0) return []

  const expectedPos = new Map<string, number>()
  expected.forEach((f, i) => expectedPos.set(f, i))

  // Filter actual to only fields present in the expected sequence
  const known = actualChildren.filter(f => expectedPos.has(f))
  if (known.length < 2) return []

  const issues: ValidationIssue[] = []
  const reported = new Set<string>()

  for (let i = 0; i < known.length; i++) {
    for (let j = i + 1; j < known.length; j++) {
      const posI = expectedPos.get(known[i])!
      const posJ = expectedPos.get(known[j])!

      if (posI > posJ && !reported.has(known[j])) {
        // known[j] appears after known[i] in document
        // but expected order has known[j] before known[i]
        reported.add(known[j])
        issues.push({
          id: nextId(),
          severity: 'red',
          field: known[j],
          line: findLine(new RegExp(`<${known[j]}[\\s/>]`), lines),
          message: `<${known[j]}> está fuera de orden dentro de <${sectionTag}>. Aparece después de <${known[i]}> pero debe ir antes según el esquema XSD de DGII. El orden incorrecto causa rechazo con el error "element is not expected".`,
        })
      }
    }
  }

  return issues
}

/**
 * Unified Item field sequence — covers all 10 ECF types in one ordered list.
 *
 * KEY STRUCTURAL DIFFERENCES BY TYPE (all handled by the unified sequence):
 *   - Retencion position: between IndicadorFacturacion and NombreItem in ALL
 *     types that have it (E-31/33/34 optional; E-41 required; E-47 required)
 *   - CantidadReferencia/UnidadReferencia/TablaSubcantidad/GradosAlcohol:
 *     present in E-31/32/33/34/45 — absent in E-41/43/44/46/47
 *   - FechaElaboracion/FechaVencimientoItem: present in E-31/32/33/34/41/44/45/46
 *   - Mineria: present in E-31/32/33/34/46
 *   - DescuentoMonto/TablaSubDescuento/RecargoMonto/TablaSubRecargo:
 *     absent in E-43 (code 0) and E-47 (no discounts in schema)
 *   - OtraMonedaDetalle: before MontoItem when present (all types)
 *
 * Using one unified sequence is correct because checkOrder() only compares
 * fields that ARE PRESENT in the document — absent fields are simply skipped.
 *
 * Sources: all 10 XSD item xs:sequence definitions, verified 2026.
 */
const ITEM_SEQUENCE: string[] = [
  'NumeroLinea',
  'TablaCodigosItem',
  'IndicadorFacturacion',
  'Retencion',               // MUST be before NombreItem (all types that have it)
  'NombreItem',
  'IndicadorBienoServicio',
  'DescripcionItem',
  'CantidadItem',
  'UnidadMedida',
  'CantidadReferencia',      // E-31/32/33/34/45 only
  'UnidadReferencia',        // E-31/32/33/34/45 only
  'TablaSubcantidad',        // E-31/32/33/34/45 only
  'GradosAlcohol',           // E-31/32/33/34/45 only
  'PrecioUnitarioReferencia',// E-31/32/33/34/45 only
  'FechaElaboracion',        // E-31/32/33/34/41/44/45/46
  'FechaVencimientoItem',    // E-31/32/33/34/41/44/45/46
  'Mineria',                 // E-31/32/33/34/46 only
  'PrecioUnitarioItem',
  'DescuentoMonto',          // absent in E-43, E-47
  'TablaSubDescuento',       // absent in E-43, E-47
  'RecargoMonto',            // absent in E-43, E-47
  'TablaSubRecargo',         // absent in E-43, E-47
  'OtraMonedaDetalle',       // present in some types when billing in foreign currency
  'MontoItem',
]

// ── Item-level sequence check ─────────────────────────────────────────────────

/**
 * Checks field ordering within each <Item> element.
 * The most impactful error this catches: Retencion placed after NombreItem
 * instead of before it — a common mistake in E-41/E-47 implementations.
 */
function checkItemsOrder(
  doc: Document,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const items = Array.from(doc.querySelectorAll('DetallesItems > Item'))
  items.forEach((item) => {
    const lineaEl  = item.querySelector(':scope > NumeroLinea')
    const lineaNum = lineaEl?.textContent?.trim() ?? '?'

    const actual   = Array.from(item.children).map((el) => el.tagName)

    // Run order check — same algorithm used for all other sections.
    // Re-label the section as "Item N" so the error message is specific.
    const itemIssues = checkOrder(`Item ${lineaNum}`, actual, ITEM_SEQUENCE, lines)
    issues.push(...itemIssues)
  })

  return issues
}

function checkRootOrder(
  doc: Document,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const root = invoiceType === 'E-32-R'
    ? doc.querySelector('RFCE')
    : doc.querySelector('ECF')
  if (!root) return []

  const actual = directChildren(root)
  const expected = invoiceType === 'E-32-R' ? RFCE_ROOT : ECF_ROOT
  return checkOrder(invoiceType === 'E-32-R' ? 'RFCE' : 'ECF', actual, expected, lines)
}

function checkEncabezadoSections(
  doc: Document,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const enc = findSection(doc, 'Encabezado')
  if (!enc) return []
  const actual = directChildren(enc)
  return checkOrder('Encabezado', actual, ENCABEZADO_SECTIONS, lines)
}

function checkIdDocOrder(
  doc: Document,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const idDoc = findSection(doc, 'IdDoc')
  if (!idDoc) return []

  const expected = IDDOC_SEQUENCES[invoiceType]
  if (!expected) return []

  const actual = directChildren(idDoc)
  return checkOrder('IdDoc', actual, expected, lines)
}

function checkEmisorOrder(
  doc: Document,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const emisor = findSection(doc, 'Emisor')
  if (!emisor) return []

  const expected = invoiceType === 'E-32-R' ? RFCE_EMISOR_SEQUENCE : EMISOR_SEQUENCE
  const actual = directChildren(emisor)
  return checkOrder('Emisor', actual, expected, lines)
}

function checkCompradorOrder(
  doc: Document,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const comprador = findSection(doc, 'Comprador')
  if (!comprador) return []

  let expected: string[] | undefined

  if (COMPRADOR_FULL_TYPES.includes(invoiceType)) {
    expected = COMPRADOR_SEQUENCES['E-31'] // same structure
  } else {
    expected = COMPRADOR_SEQUENCES[invoiceType]
  }

  if (!expected) return []
  const actual = directChildren(comprador)
  return checkOrder('Comprador', actual, expected, lines)
}

function checkTotalesOrder(
  doc: Document,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  if (invoiceType === 'E-32-R') return [] // RFCE has simplified Totales
  const totales = findSection(doc, 'Totales')
  if (!totales) return []
  const actual = directChildren(totales)
  return checkOrder('Totales', actual, TOTALES_SEQUENCE, lines)
}

function checkInformacionReferenciaOrder(
  doc: Document,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  if (invoiceType !== 'E-33' && invoiceType !== 'E-34') return []
  const infoRef = findSection(doc, 'InformacionReferencia')
  if (!infoRef) return []
  const actual = directChildren(infoRef)
  return checkOrder('InformacionReferencia', actual, INFO_REFERENCIA_SEQUENCE, lines)
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run all sequence checks on the parsed XML.
 * Returns empty array if DOMParser is unavailable (SSR context).
 */
export function runSequenceChecks(
  raw: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const doc = parseDOM(raw)
  if (!doc) return [] // DOMParser unavailable or XML malformed (other checks handle this)

  return [
    ...checkRootOrder(doc, invoiceType, lines),
    ...checkEncabezadoSections(doc, invoiceType, lines),
    ...checkIdDocOrder(doc, invoiceType, lines),
    ...checkEmisorOrder(doc, invoiceType, lines),
    ...checkCompradorOrder(doc, invoiceType, lines),
    ...checkTotalesOrder(doc, invoiceType, lines),
    ...checkInformacionReferenciaOrder(doc, invoiceType, lines),
    ...checkItemsOrder(doc, lines),
  ]
}

/** Reset the sequence check ID counter (call at start of each validation run). */
export function resetSeqCounter(): void {
  _seqCounter = 0
}