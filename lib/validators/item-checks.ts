/**
 * Item-level validation.
 *
 * Iterates every <Item> element inside <DetallesItems> using DOM parsing and
 * validates required fields, enum values, math consistency, and type-specific
 * rules for each item individually.
 *
 * This is the only validator that requires DOM parsing for correctness — string
 * matching across items would conflate fields from different items. We use the
 * same DOMParser pattern as sequence-checks.ts.
 *
 * SOURCES:
 *   - XSD schemas: all 10 ECF types (confirmed minOccurs per field)
 *   - Formato eCF PDF, fields 1-20 of DetallesItems section
 *   - Footnote 54: E-47 IndicadorBienoServicio must be 2 (Servicio)
 *   - Footnotes 50-51: IndicadorFacturacion type-specific rules
 */

import type { InvoiceType, ValidationIssue, XmlLine } from '../types'

// ── Internals ─────────────────────────────────────────────────────────────────

let _itemCounter = 0
function nextId(): string {
  return `item-${++_itemCounter}`
}

/** Find the first line number whose content matches the pattern. */
function findLine(pattern: RegExp, lines: XmlLine[]): number | null {
  for (const l of lines) {
    if (pattern.test(l.content)) return l.number
  }
  return null
}

/** Find the line where Item N starts (via its NumeroLinea tag). */
function findItemLine(lineaNum: number, lines: XmlLine[]): number | null {
  return findLine(new RegExp(`<NumeroLinea>\\s*${lineaNum}\\s*<\\/NumeroLinea>`), lines)
}

/** Parse XML string into DOM. Returns null if DOMParser unavailable or XML broken. */
function parseDOM(xml: string): Document | null {
  if (typeof window === 'undefined' || !window.DOMParser) return null
  try {
    const parser = new window.DOMParser()
    const doc = parser.parseFromString(xml, 'application/xml')
    return doc.querySelector('parsererror') ? null : doc
  } catch {
    return null
  }
}

/** Get text content of a direct child element. */
function childText(parent: Element, tag: string): string | null {
  const el = parent.querySelector(`:scope > ${tag}`)
  return el ? el.textContent?.trim() ?? null : null
}

/** Round to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const ITEM_MATH_TOLERANCE = 0.02

// ── Required field check — per item ──────────────────────────────────────────

/**
 * Required fields for every item across all types (minOccurs=1 in all XSDs):
 *   NumeroLinea, IndicadorFacturacion, NombreItem, IndicadorBienoServicio,
 *   CantidadItem, PrecioUnitarioItem, MontoItem
 */
const REQUIRED_ITEM_FIELDS: Array<{ tag: string; label: string }> = [
  { tag: 'IndicadorFacturacion',  label: 'IndicadorFacturacion' },
  { tag: 'NombreItem',            label: 'NombreItem' },
  { tag: 'IndicadorBienoServicio',label: 'IndicadorBienoServicio' },
  { tag: 'CantidadItem',          label: 'CantidadItem' },
  { tag: 'PrecioUnitarioItem',    label: 'PrecioUnitarioItem' },
  { tag: 'MontoItem',             label: 'MontoItem' },
]

function checkItemRequiredFields(
  item: Element,
  lineaNum: number,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const baseLine = findItemLine(lineaNum, lines)

  for (const { tag, label } of REQUIRED_ITEM_FIELDS) {
    if (!item.querySelector(`:scope > ${tag}`)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: label,
        line: baseLine,
        message: `Ítem ${lineaNum}: ${label} es obligatorio pero está ausente. Este campo es requerido en todos los tipos de e-CF (minOccurs=1 en el XSD).`,
      })
    }
  }

  return issues
}

// ── NumeroLinea sequential check ──────────────────────────────────────────────

/**
 * NumeroLinea must be sequential starting at 1 with no gaps or duplicates.
 * DGII validates this at the document level.
 */
function checkNumeroLinea(
  items: Element[],
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seen = new Set<number>()

  items.forEach((item, idx) => {
    const raw = childText(item, 'NumeroLinea')
    const n = raw ? parseInt(raw, 10) : NaN
    const expected = idx + 1

    if (isNaN(n)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: 'NumeroLinea',
        line: null,
        message: `Ítem en posición ${expected} no tiene NumeroLinea o no es un número válido.`,
      })
      return
    }

    if (seen.has(n)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: 'NumeroLinea',
        line: findItemLine(n, lines),
        message: `NumeroLinea ${n} está duplicado. Cada ítem debe tener un número de línea único y secuencial.`,
      })
    }
    seen.add(n)

    if (n !== expected) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: 'NumeroLinea',
        line: findItemLine(n, lines),
        message: `NumeroLinea ${n} está fuera de secuencia — se esperaba ${expected}. Los ítems deben numerarse consecutivamente desde 1.`,
      })
    }
  })

  return issues
}

// ── IndicadorFacturacion — enum and type-specific ─────────────────────────────

/**
 * Validates IndicadorFacturacion per item:
 *   - Must be 0, 1, 2, 3, or 4 (enum)
 *   - E-43, E-44, E-47: must be 4 (Exento) — footnote 50
 *   - E-46: must be 3 (ITBIS tasa 0%) — footnote 51
 */
function checkIndicadorFacturacion(
  item: Element,
  lineaNum: number,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const v = childText(item, 'IndicadorFacturacion')
  if (!v) return issues // absence caught by required-field check

  const n = parseInt(v, 10)
  const baseLine = findItemLine(lineaNum, lines)

  // Enum check
  if (![0, 1, 2, 3, 4].includes(n)) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'IndicadorFacturacion',
      line: baseLine,
      message: `Ítem ${lineaNum}: IndicadorFacturacion "${v}" es inválido. Valores válidos: 0 (No Facturable), 1 (Operación sujeta ITBIS tasa 1), 2 (Operación sujeta ITBIS tasa 2), 3 (ITBIS tasa 0%), 4 (Exento).`,
    })
    return issues
  }

  // Type-specific rules
  if (['E-43', 'E-44', 'E-47'].includes(invoiceType) && n !== 4) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'IndicadorFacturacion',
      line: baseLine,
      message: `Ítem ${lineaNum}: IndicadorFacturacion="${v}" es inválido para ${invoiceType}. Todos los ítems de este tipo deben ser 4 (Exento) — no aplica ITBIS en Gastos Menores, Regímenes Especiales ni Pagos al Exterior.`,
    })
  }

  if (invoiceType === 'E-46' && n !== 3) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'IndicadorFacturacion',
      line: baseLine,
      message: `Ítem ${lineaNum}: IndicadorFacturacion="${v}" es inválido para E-46 (Exportaciones). Todos los ítems deben ser 3 (ITBIS tasa 0%) — las exportaciones están gravadas a tasa cero, no exentas.`,
    })
  }

  return issues
}

// ── IndicadorBienoServicio — enum and E-47 rule ───────────────────────────────

/**
 * Validates IndicadorBienoServicio per item:
 *   - Must be 1 (Bien) or 2 (Servicio)
 *   - E-47: must be 2 (Servicio) — footnote 54: payments abroad are always services
 */
function checkIndicadorBienoServicio(
  item: Element,
  lineaNum: number,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const v = childText(item, 'IndicadorBienoServicio')
  if (!v) return issues

  const baseLine = findItemLine(lineaNum, lines)

  if (!['1', '2'].includes(v)) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'IndicadorBienoServicio',
      line: baseLine,
      message: `Ítem ${lineaNum}: IndicadorBienoServicio="${v}" es inválido. Valores válidos: 1 (Bien), 2 (Servicio).`,
    })
    return issues
  }

  if (invoiceType === 'E-47' && v !== '2') {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'IndicadorBienoServicio',
      line: baseLine,
      message: `Ítem ${lineaNum}: IndicadorBienoServicio="${v}" es inválido para E-47 (Pagos al Exterior). Todos los ítems deben ser 2 (Servicio) — los pagos al exterior corresponden siempre a servicios, no bienes.`,
    })
  }

  return issues
}

// ── MontoItem math check ──────────────────────────────────────────────────────

/**
 * MontoItem should equal CantidadItem × PrecioUnitarioItem.
 * Skips if item-level discounts (DescuentoMonto, TablaSubDescuento) or
 * surcharges (TablaSubRecargo) are present, since the formula becomes more complex.
 *
 * Severity: orange — the values are structurally valid but fiscally inconsistent.
 */
function checkMontoItem(
  item: Element,
  lineaNum: number,
  lines: XmlLine[]
): ValidationIssue | null {
  // Skip if item-level adjustments present
  if (
    item.querySelector(':scope > DescuentoMonto') ||
    item.querySelector(':scope > TablaSubDescuento') ||
    item.querySelector(':scope > TablaSubRecargo')
  ) {
    return null
  }

  const cantidadStr = childText(item, 'CantidadItem')
  const precioStr   = childText(item, 'PrecioUnitarioItem')
  const montoStr    = childText(item, 'MontoItem')

  if (!cantidadStr || !precioStr || !montoStr) return null

  const cantidad = parseFloat(cantidadStr)
  const precio   = parseFloat(precioStr)
  const monto    = parseFloat(montoStr)

  if (isNaN(cantidad) || isNaN(precio) || isNaN(monto)) return null

  const expected = round2(cantidad * precio)
  const diff = Math.abs(monto - expected)

  if (diff > ITEM_MATH_TOLERANCE) {
    return {
      id: nextId(),
      severity: 'orange',
      field: 'MontoItem',
      line: findItemLine(lineaNum, lines),
      message: `Ítem ${lineaNum}: MontoItem (${monto.toFixed(2)}) no coincide con CantidadItem × PrecioUnitarioItem: ${cantidad} × ${precio} = ${expected.toFixed(2)}. Diferencia: ${diff.toFixed(2)} DOP.`,
    }
  }

  return null
}

// ── E-41/E-47 Retencion per item ──────────────────────────────────────────────

/**
 * E-41 and E-47 require a <Retencion> block inside every <Item>.
 *
 * E-41: Retencion required, IndicadorAgenteRetencionoPercepcion required inside it.
 * E-47: Retencion required, BOTH IndicadorAgenteRetencionoPercepcion AND
 *       MontoISRRetenido required inside it (stricter than E-41).
 */
function checkRetencionPerItem(
  item: Element,
  lineaNum: number,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  if (invoiceType !== 'E-41' && invoiceType !== 'E-47') return []

  const issues: ValidationIssue[] = []
  const baseLine = findItemLine(lineaNum, lines)
  const retencion = item.querySelector(':scope > Retencion')

  if (!retencion) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'Retencion',
      line: baseLine,
      message: `Ítem ${lineaNum}: la sección <Retencion> es obligatoria en cada ítem de ${invoiceType}. Debe incluir al menos IndicadorAgenteRetencionoPercepcion${invoiceType === 'E-47' ? ' y MontoISRRetenido' : ''}.`,
    })
    return issues
  }

  if (!retencion.querySelector('IndicadorAgenteRetencionoPercepcion')) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'IndicadorAgenteRetencionoPercepcion',
      line: baseLine,
      message: `Ítem ${lineaNum}: IndicadorAgenteRetencionoPercepcion es obligatorio dentro de <Retencion> para ${invoiceType}. Valores: 1 (Retención), 2 (Percepción).`,
    })
  }

  if (invoiceType === 'E-47' && !retencion.querySelector('MontoISRRetenido')) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'MontoISRRetenido',
      line: baseLine,
      message: `Ítem ${lineaNum}: MontoISRRetenido es obligatorio dentro de <Retencion> para E-47 (Pagos al Exterior). A diferencia de E-41, el monto de retención ISR debe estar presente en cada ítem.`,
    })
  }

  return issues
}

// ── Sum of items vs header totals ─────────────────────────────────────────────

/**
 * Verifies that header totals are consistent with the sum of item amounts.
 *
 * Items with IndicadorFacturacion=4 (Exento) contribute to MontoExento.
 * Items with IndicadorFacturacion=1,2,3 contribute to MontoGravadoTotal.
 * Items with IndicadorFacturacion=0 (No Facturable) are excluded from totals.
 *
 * Skips if DescuentosORecargos section is present at document level
 * (global adjustments affect totals in ways we can't verify without that data).
 */
function checkItemSumVsHeader(
  items: Element[],
  raw: string,
  lines: XmlLine[]
): ValidationIssue[] {
  // Skip if global discounts/surcharges present
  if (/<DescuentosORecargos>/.test(raw)) return []

  const issues: ValidationIssue[] = []

  let sumExento = 0
  let sumGravado = 0
  let sumTotal = 0

  for (const item of items) {
    const indicador = parseInt(childText(item, 'IndicadorFacturacion') ?? '', 10)
    const monto     = parseFloat(childText(item, 'MontoItem') ?? '')

    if (isNaN(monto)) continue

    if (indicador === 4) {
      sumExento  += monto
      sumTotal   += monto
    } else if (indicador === 0) {
      // No Facturable — excluded from all totals
    } else {
      sumGravado += monto
      sumTotal   += monto
    }
  }

  sumExento  = Math.round(sumExento  * 100) / 100
  sumGravado = Math.round(sumGravado * 100) / 100
  sumTotal   = Math.round(sumTotal   * 100) / 100

  function getHeaderNum(field: string): number | null {
    const m = raw.match(new RegExp(`<${field}[^>]*>([^<]+)</${field}>`))
    if (!m) return null
    const n = parseFloat(m[1].trim())
    return isNaN(n) ? null : n
  }

  const TOLS = 0.05 // slightly wider tolerance for accumulated item rounding

  const headerExento  = getHeaderNum('MontoExento')
  const headerGravado = getHeaderNum('MontoGravadoTotal')
  const headerTotal   = getHeaderNum('MontoTotal')

  if (headerExento !== null && sumExento > 0 && Math.abs(headerExento - sumExento) > TOLS) {
    issues.push({
      id: nextId(),
      severity: 'orange',
      field: 'MontoExento',
      line: findLine(/<MontoExento>/, lines),
      message: `MontoExento (${headerExento.toFixed(2)}) no coincide con la suma de ítems exentos (IndicadorFacturacion=4): ${sumExento.toFixed(2)}. Diferencia: ${Math.abs(headerExento - sumExento).toFixed(2)} DOP.`,
    })
  }

  if (headerGravado !== null && sumGravado > 0 && Math.abs(headerGravado - sumGravado) > TOLS) {
    issues.push({
      id: nextId(),
      severity: 'orange',
      field: 'MontoGravadoTotal',
      line: findLine(/<MontoGravadoTotal>/, lines),
      message: `MontoGravadoTotal (${headerGravado.toFixed(2)}) no coincide con la suma de ítems gravados: ${sumGravado.toFixed(2)}. Diferencia: ${Math.abs(headerGravado - sumGravado).toFixed(2)} DOP.`,
    })
  }

  if (headerTotal !== null) {
    // When IndicadorMontoGravado=0, item prices are pre-ITBIS — ITBIS is added at the
    // header level. So MontoTotal = sum(items) + TotalITBIS, not sum(items) alone.
    // When IndicadorMontoGravado=1, ITBIS is already included in item prices.
    const indicadorGravado = parseInt(
      raw.match(/<IndicadorMontoGravado>([^<]+)<\/IndicadorMontoGravado>/)?.[1]?.trim() ?? '1',
      10
    )
    const itbisAdj = indicadorGravado === 0
      ? Math.round((getHeaderNum('TotalITBIS') ?? 0) * 100) / 100
      : 0

    const adjustedSum = Math.round((sumTotal + itbisAdj) * 100) / 100
    if (Math.abs(headerTotal - adjustedSum) > TOLS) {
      issues.push({
        id: nextId(),
        severity: 'orange',
        field: 'MontoTotal',
        line: findLine(/<MontoTotal>/, lines),
        message: `MontoTotal (${headerTotal.toFixed(2)}) no coincide con la suma de todos los MontoItem facturables${itbisAdj > 0 ? ` + TotalITBIS (${itbisAdj.toFixed(2)})` : ''}: ${adjustedSum.toFixed(2)}. Diferencia: ${Math.abs(headerTotal - adjustedSum).toFixed(2)} DOP. (Ítems con IndicadorFacturacion=0 excluidos.)`,
      })
    }
  }

  return issues
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run all item-level checks.
 * Returns empty array if DOMParser is unavailable or XML is unparseable.
 */
export function runItemChecks(
  raw: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  // RFCE has no DetallesItems
  if (invoiceType === 'E-32-R') return []

  const doc = parseDOM(raw)
  if (!doc) return []

  const items = Array.from(doc.querySelectorAll('DetallesItems > Item'))
  if (items.length === 0) return []

  const issues: ValidationIssue[] = []

  // 1. NumeroLinea sequential check (document-level)
  issues.push(...checkNumeroLinea(items, lines))

  // 2. Per-item checks
  for (const item of items) {
    const lineaRaw = item.querySelector(':scope > NumeroLinea')?.textContent?.trim()
    const lineaNum = lineaRaw ? parseInt(lineaRaw, 10) : 0

    issues.push(...checkItemRequiredFields(item, lineaNum, lines))
    issues.push(...checkIndicadorFacturacion(item, lineaNum, invoiceType, lines))
    issues.push(...checkIndicadorBienoServicio(item, lineaNum, invoiceType, lines))
    issues.push(...checkRetencionPerItem(item, lineaNum, invoiceType, lines))

    const mathIssue = checkMontoItem(item, lineaNum, lines)
    if (mathIssue) issues.push(mathIssue)
  }

  // 3. Sum of items vs header totals (document-level)
  issues.push(...checkItemSumVsHeader(items, raw, lines))

  return issues
}

/** Reset the item check ID counter (call at start of each validation run). */
export function resetItemCounter(): void {
  _itemCounter = 0
}