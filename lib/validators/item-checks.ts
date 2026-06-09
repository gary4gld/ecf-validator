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
 * MontoItem should equal: (CantidadItem × PrecioUnitarioItem) - DescuentoMonto + RecargoMonto
 *
 * DescuentoMonto is the consolidated total of all sub-discounts (from PDF: "totaliza todos
 * los subdescuentos otorgados al ítem en montos"). Whether the sub-discounts in
 * TablaSubDescuento are $ or %, DescuentoMonto always holds the computed amount.
 * So the check formula is always the same simple expression.
 *
 * Skips only when neither DescuentoMonto nor RecargoMonto is present but
 * TablaSubDescuento/TablaSubRecargo are (inconsistent — missing consolidated totals).
 *
 * Severity: orange — values are structurally valid but fiscally inconsistent.
 */
function checkMontoItem(
  item: Element,
  lineaNum: number,
  lines: XmlLine[]
): ValidationIssue | null {
  const cantidadStr = childText(item, 'CantidadItem')
  const precioStr   = childText(item, 'PrecioUnitarioItem')
  const montoStr    = childText(item, 'MontoItem')

  if (!cantidadStr || !precioStr || !montoStr) return null

  const cantidad = parseFloat(cantidadStr)
  const precio   = parseFloat(precioStr)
  const monto    = parseFloat(montoStr)

  if (isNaN(cantidad) || isNaN(precio) || isNaN(monto)) return null

  const descuentoMonto = parseFloat(childText(item, 'DescuentoMonto') ?? '') || 0
  const recargoMonto   = parseFloat(childText(item, 'RecargoMonto')   ?? '') || 0

  // If TablaSubDescuento or TablaSubRecargo exist but DescuentoMonto/RecargoMonto
  // are absent, we can't verify the math — the consolidated total is missing.
  const hasSubTable = !!(
    item.querySelector(':scope > TablaSubDescuento') ||
    item.querySelector(':scope > TablaSubRecargo')
  )
  if (hasSubTable && descuentoMonto === 0 && recargoMonto === 0) return null

  const expected = round2(cantidad * precio - descuentoMonto + recargoMonto)
  const diff = Math.abs(monto - expected)

  if (diff > ITEM_MATH_TOLERANCE) {
    const adjustments = descuentoMonto > 0 || recargoMonto > 0
      ? ` - descuento ${descuentoMonto.toFixed(2)} + recargo ${recargoMonto.toFixed(2)}`
      : ''
    return {
      id: nextId(),
      severity: 'orange',
      field: 'MontoItem',
      line: findItemLine(lineaNum, lines),
      message: `Ítem ${lineaNum}: MontoItem (${monto.toFixed(2)}) no coincide con CantidadItem × PrecioUnitarioItem${adjustments}: ${cantidad} × ${precio}${adjustments} = ${expected.toFixed(2)}. Diferencia: ${diff.toFixed(2)} DOP.`,
    }
  }

  return null
}

// ── E-41/E-47 Retencion per item ──────────────────────────────────────────────

/**
 * E-41 and E-47 require a <Retencion> block inside every <Item>.
 * Also validates IndicadorAgenteRetencionoPercepcion for all types that have it.
 *
 * E-41: Retencion required, IndicadorAgenteRetencionoPercepcion required inside it.
 * E-47: Retencion required, BOTH IndicadorAgenteRetencionoPercepcion AND
 *       MontoISRRetenido required inside it (stricter than E-41).
 *
 * Enum (from XSD IndicadorAgenteRetencionoPercepcionType):
 *   1 = Retención ("R")
 *   2 = Percepción ("P") — schema allows it but footnote 52 says it's not in effect
 *
 * Footnote 53: when IndicadorFacturacion=4 (Exento) and indicator=1 (R),
 *   MontoITBISRetenido must be 0.
 */
function checkRetencionPerItem(
  item: Element,
  lineaNum: number,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const baseLine = findItemLine(lineaNum, lines)
  const retencion = item.querySelector(':scope > Retencion')

  // Presence check (E-41 and E-47 require Retencion on every item)
  if (invoiceType === 'E-41' || invoiceType === 'E-47') {
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
        message: `Ítem ${lineaNum}: IndicadorAgenteRetencionoPercepcion es obligatorio dentro de <Retencion> para ${invoiceType}. Valores: 1 (Retención) o 2 (Percepción).`,
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

    // E-47 Retencion only accepts IndicadorAgenteRetencionoPercepcion + MontoISRRetenido.
    // MontoITBISRetenido is not in the E-47 schema and will cause DGII rejection.
    // This can happen when ERP systems generate items with ITBIS tax templates and
    // the invoice type isn't checked before including the retention fields.
    if (invoiceType === 'E-47' && retencion.querySelector('MontoITBISRetenido')) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: 'MontoITBISRetenido',
        line: baseLine,
        message: `Ítem ${lineaNum}: MontoITBISRetenido no aplica para E-47 (Pagos al Exterior). El bloque <Retencion> de E-47 solo acepta IndicadorAgenteRetencionoPercepcion y MontoISRRetenido. Incluir este campo causará rechazo con el error "element is not expected".`,
      })
    }
  }

  // Enum + footnote checks for any item that has a Retencion block
  if (retencion) {
    const indicadorEl = retencion.querySelector('IndicadorAgenteRetencionoPercepcion')
    if (indicadorEl) {
      const val = parseInt(indicadorEl.textContent?.trim() ?? '', 10)
      if (val !== 1 && val !== 2) {
        issues.push({
          id: nextId(), severity: 'red',
          field: 'IndicadorAgenteRetencionoPercepcion', line: baseLine,
          message: `Ítem ${lineaNum}: IndicadorAgenteRetencionoPercepcion "${indicadorEl.textContent?.trim()}" es inválido. Valores aceptados: 1 (Retención "R") o 2 (Percepción "P").`,
        })
      } else if (val === 2) {
        // Schema allows it, but DGII footnote 52 says "Régimen de percepción no está vigente"
        issues.push({
          id: nextId(), severity: 'yellow',
          field: 'IndicadorAgenteRetencionoPercepcion', line: baseLine,
          message: `Ítem ${lineaNum}: IndicadorAgenteRetencionoPercepcion=2 (Percepción "P") — la nota 52 del Formato eCF indica que el régimen de percepción no está vigente. Verifica si este valor es intencional.`,
        })
      } else if (val === 1) {
        // Footnote 53: when IndicadorFacturacion=4 (Exento) + indicator=1 (R),
        // MontoITBISRetenido must be 0.
        const indicadorFacturacion = parseInt(
          item.querySelector(':scope > IndicadorFacturacion')?.textContent?.trim() ?? '', 10
        )
        if (indicadorFacturacion === 4) {
          const montoITBISEl = retencion.querySelector('MontoITBISRetenido')
          if (montoITBISEl) {
            const montoVal = parseFloat(montoITBISEl.textContent?.trim() ?? '')
            if (!isNaN(montoVal) && montoVal !== 0) {
              issues.push({
                id: nextId(), severity: 'red',
                field: 'MontoITBISRetenido', line: baseLine,
                message: `Ítem ${lineaNum}: cuando IndicadorFacturacion=4 (Exento) y el agente es Retención (1), MontoITBISRetenido debe ser 0.00 (nota 53 del Formato eCF). Valor actual: ${montoVal.toFixed(2)}.`,
              })
            }
          }
        }
      }
    }
  }

  return issues
}

// ── Retention totals sum ───────────────────────────────────────────────────────

/**
 * Validates TotalITBISRetenido and TotalISRRetencion in the header against
 * the sum of per-item MontoITBISRetenido and MontoISRRetenido values.
 *
 * From PDF validation rules for fields 116-117:
 *   TotalITBISRetenido = Σ(MontoITBISRetenido per item)
 *   TotalISRRetencion  = Σ(MontoISRRetenido per item)
 */
function checkRetentionTotals(
  items: Element[],
  raw: string,
  lines: XmlLine[]
): ValidationIssue[] {
  let sumITBIS = 0
  let sumISR   = 0
  let hasAny   = false

  for (const item of items) {
    const ret = item.querySelector(':scope > Retencion')
    if (!ret) continue
    hasAny = true

    const itbis = parseFloat(ret.querySelector('MontoITBISRetenido')?.textContent?.trim() ?? '') || 0
    const isr   = parseFloat(ret.querySelector('MontoISRRetenido')?.textContent?.trim() ?? '') || 0
    sumITBIS += itbis
    sumISR   += isr
  }

  if (!hasAny) return []

  sumITBIS = Math.round(sumITBIS * 100) / 100
  sumISR   = Math.round(sumISR   * 100) / 100

  const issues: ValidationIssue[] = []
  const TOLS = 0.02

  function getHeaderNum(field: string): number | null {
    const m = raw.match(new RegExp(`<${field}[^>]*>([^<]+)</${field}>`))
    if (!m) return null
    const n = parseFloat(m[1].trim())
    return isNaN(n) ? null : n
  }

  const headerITBIS = getHeaderNum('TotalITBISRetenido')
  if (headerITBIS !== null && Math.abs(headerITBIS - sumITBIS) > TOLS) {
    issues.push({
      id: nextId(), severity: 'orange',
      field: 'TotalITBISRetenido',
      line: findLine(/<TotalITBISRetenido>/, lines),
      message: `TotalITBISRetenido (${headerITBIS.toFixed(2)}) no coincide con la suma de MontoITBISRetenido por ítem: ${sumITBIS.toFixed(2)}. Diferencia: ${Math.abs(headerITBIS - sumITBIS).toFixed(2)} DOP.`,
    })
  }

  const headerISR = getHeaderNum('TotalISRRetencion')
  if (headerISR !== null && Math.abs(headerISR - sumISR) > TOLS) {
    issues.push({
      id: nextId(), severity: 'orange',
      field: 'TotalISRRetencion',
      line: findLine(/<TotalISRRetencion>/, lines),
      message: `TotalISRRetencion (${headerISR.toFixed(2)}) no coincide con la suma de MontoISRRetenido por ítem: ${sumISR.toFixed(2)}. Diferencia: ${Math.abs(headerISR - sumISR).toFixed(2)} DOP.`,
    })
  }

  return issues
}

interface AjusteEntry {
  tipo:   string  // 'D' or 'R'
  ifCode: number  // IndicadorFacturacion bucket this applies to
  monto:  number  // MontoDescuentooRecargo (always the monetary amount)
}

function parseDescuentosORecargos(raw: string): AjusteEntry[] {
  const section = raw.match(/<DescuentosORecargos>([\s\S]*?)<\/DescuentosORecargos>/)
  if (!section) return []

  const entries = section[1].match(/<DescuentoORecargo>([\s\S]*?)<\/DescuentoORecargo>/g) ?? []
  return entries.flatMap((entry): AjusteEntry[] => {
    const tipo   = entry.match(/<TipoAjuste>([^<]+)<\/TipoAjuste>/)?.[1]?.trim() ?? ''
    const ifCode = parseInt(
      entry.match(/<IndicadorFacturacionDescuentooRecargo>([^<]+)<\/IndicadorFacturacionDescuentooRecargo>/)?.[1]?.trim() ?? '0'
    )
    const monto  = parseFloat(
      entry.match(/<MontoDescuentooRecargo>([^<]+)<\/MontoDescuentooRecargo>/)?.[1]?.trim() ?? '0'
    )
    if (!tipo || isNaN(monto) || monto === 0) return []
    return [{ tipo, ifCode, monto }]
  })
}

// ── Sum of items vs header totals ─────────────────────────────────────────────

/**
 * Verifies header totals against the actual sum of items.
 *
 * Checks:
 *   1. MontoExento vs sum of IF=4 items
 *   2. MontoGravadoI1/I2/I3 vs sum of items per IF bucket
 *   3. MontoGravadoTotal vs sum of all taxable items
 *   4. MontoTotal consistency
 *
 * Handles:
 *   - IndicadorMontoGravado=0: item prices are pre-ITBIS, use directly
 *   - IndicadorMontoGravado=1: item prices include ITBIS, divide by (1 + rate/100)
 *   - DescuentosORecargos: document-level adjustments applied per IF bucket
 */
function checkItemSumVsHeader(
  items: Element[],
  raw: string,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const indicadorGravado = parseInt(
    raw.match(/<IndicadorMontoGravado>([^<]+)<\/IndicadorMontoGravado>/)?.[1]?.trim() ?? '0'
  )

  function getHeaderRate(field: string, fallback: number): number {
    const v = parseFloat(raw.match(new RegExp(`<${field}>([^<]+)</${field}>`))?.[1]?.trim() ?? '')
    return isNaN(v) ? fallback : v
  }
  const rateByIF: Record<number, number> = {
    1: getHeaderRate('ITBIS1', 18),
    2: getHeaderRate('ITBIS2', 16),
    3: getHeaderRate('ITBIS3', 0),
    4: 0,
    0: 0,
  }

  const buckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }

  for (const item of items) {
    const indicador = parseInt(childText(item, 'IndicadorFacturacion') ?? '', 10)
    const monto     = parseFloat(childText(item, 'MontoItem') ?? '')
    if (isNaN(monto)) continue
    if (indicador === 0) continue
    if (indicador in buckets) buckets[indicador] += monto
  }

  function toBase(ifCode: number, montoSum: number): number {
    if (indicadorGravado === 1 && ifCode in rateByIF && rateByIF[ifCode] > 0) {
      return montoSum / (1 + rateByIF[ifCode] / 100)
    }
    return montoSum
  }

  const baseI1     = toBase(1, buckets[1])
  const baseI2     = toBase(2, buckets[2])
  const baseI3     = toBase(3, buckets[3])
  const baseExento = buckets[4]

  const ajustes = parseDescuentosORecargos(raw)
  const hasDRSection = /<DescuentosORecargos>/.test(raw)

  const DR: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const a of ajustes) {
    if (!(a.ifCode in DR)) continue
    DR[a.ifCode] += a.tipo.toUpperCase() === 'D' ? -a.monto : a.monto
  }

  const adjI1     = Math.round((baseI1     + DR[1]) * 100) / 100
  const adjI2     = Math.round((baseI2     + DR[2]) * 100) / 100
  const adjI3     = Math.round((baseI3     + DR[3]) * 100) / 100
  const adjExento = Math.round((baseExento + DR[4]) * 100) / 100

  const TOLS = 0.05

  function getHeaderNum(field: string): number | null {
    const m = raw.match(new RegExp(`<${field}[^>]*>([^<]+)</${field}>`))
    if (!m) return null
    const n = parseFloat(m[1].trim())
    return isNaN(n) ? null : n
  }

  const drNote = hasDRSection ? ' (ajustado por DescuentosORecargos)' : ''
  const baseNote = indicadorGravado === 1 ? ' (base pre-ITBIS)' : ''

  const headerExento = getHeaderNum('MontoExento')
  if (headerExento !== null && (buckets[4] > 0 || DR[4] !== 0)) {
    if (Math.abs(headerExento - adjExento) > TOLS) {
      issues.push({
        id: nextId(), severity: 'orange', field: 'MontoExento',
        line: findLine(/<MontoExento>/, lines),
        message: `MontoExento (${headerExento.toFixed(2)}) no coincide con suma de ítems exentos (IF=4)${drNote}: ${adjExento.toFixed(2)}. Diferencia: ${Math.abs(headerExento - adjExento).toFixed(2)} DOP.`,
      })
    }
  }

  const headerI1 = getHeaderNum('MontoGravadoI1')
  if (headerI1 !== null && buckets[1] > 0) {
    if (Math.abs(headerI1 - adjI1) > TOLS) {
      issues.push({
        id: nextId(), severity: 'orange', field: 'MontoGravadoI1',
        line: findLine(/<MontoGravadoI1>/, lines),
        message: `MontoGravadoI1 (${headerI1.toFixed(2)}) no coincide con suma de ítems IF=1${baseNote}${drNote}: ${adjI1.toFixed(2)}. Diferencia: ${Math.abs(headerI1 - adjI1).toFixed(2)} DOP.`,
      })
    }
  }

  const headerI2 = getHeaderNum('MontoGravadoI2')
  if (headerI2 !== null && buckets[2] > 0) {
    if (Math.abs(headerI2 - adjI2) > TOLS) {
      issues.push({
        id: nextId(), severity: 'orange', field: 'MontoGravadoI2',
        line: findLine(/<MontoGravadoI2>/, lines),
        message: `MontoGravadoI2 (${headerI2.toFixed(2)}) no coincide con suma de ítems IF=2${baseNote}${drNote}: ${adjI2.toFixed(2)}. Diferencia: ${Math.abs(headerI2 - adjI2).toFixed(2)} DOP.`,
      })
    }
  }

  const headerI3 = getHeaderNum('MontoGravadoI3')
  if (headerI3 !== null && buckets[3] > 0) {
    if (Math.abs(headerI3 - adjI3) > TOLS) {
      issues.push({
        id: nextId(), severity: 'orange', field: 'MontoGravadoI3',
        line: findLine(/<MontoGravadoI3>/, lines),
        message: `MontoGravadoI3 (${headerI3.toFixed(2)}) no coincide con suma de ítems IF=3${drNote}: ${adjI3.toFixed(2)}. Diferencia: ${Math.abs(headerI3 - adjI3).toFixed(2)} DOP.`,
      })
    }
  }

  const adjGravado = Math.round((adjI1 + adjI2 + adjI3) * 100) / 100
  const headerGravado = getHeaderNum('MontoGravadoTotal')
  if (headerGravado !== null && adjGravado > 0) {
    if (Math.abs(headerGravado - adjGravado) > TOLS) {
      issues.push({
        id: nextId(), severity: 'orange', field: 'MontoGravadoTotal',
        line: findLine(/<MontoGravadoTotal>/, lines),
        message: `MontoGravadoTotal (${headerGravado.toFixed(2)}) no coincide con suma de ítems gravados${baseNote}${drNote}: ${adjGravado.toFixed(2)}. Diferencia: ${Math.abs(headerGravado - adjGravado).toFixed(2)} DOP.`,
      })
    }
  }

  const headerTotal = getHeaderNum('MontoTotal')
  if (headerTotal !== null) {
    // sumBillable is always the pre-ITBIS sum because toBase() is applied in both modes:
    //   IndicadorMontoGravado=0: MontoItem is already pre-ITBIS → toBase() returns it unchanged
    //   IndicadorMontoGravado=1: MontoItem includes ITBIS → toBase() divides it out
    // MontoTotal = MontoGravadoTotal + MontoExento + TotalITBIS always (invariant).
    // So adjustedTotal must always include TotalITBIS regardless of IndicadorMontoGravado.
    const totalITBIS    = Math.round((getHeaderNum('TotalITBIS') ?? 0) * 100) / 100
    const sumBillable   = Math.round((adjI1 + adjI2 + adjI3 + adjExento) * 100) / 100
    const adjustedTotal = Math.round((sumBillable + totalITBIS) * 100) / 100

    if (Math.abs(headerTotal - adjustedTotal) > TOLS) {
      const itbisNote = totalITBIS > 0 ? ` + TotalITBIS (${totalITBIS.toFixed(2)})` : ''
      issues.push({
        id: nextId(), severity: 'orange', field: 'MontoTotal',
        line: findLine(/<MontoTotal>/, lines),
        message: `MontoTotal (${headerTotal.toFixed(2)}) no coincide con suma de ítems facturables${itbisNote}${drNote}: ${adjustedTotal.toFixed(2)}. Diferencia: ${Math.abs(headerTotal - adjustedTotal).toFixed(2)} DOP.`,
      })
    }
  }

  return issues
}


import { validateTasaISC, ISC_ALCOHOL_CODES } from './isc-rates'

/**
 * Valid TipoImpuesto codes from ImpuestosAdicionalesType (XSD enum 001-039).
 *   001-005: Ad valorem / otros impuestos (Propina Legal, Telecomunicaciones, etc.)
 *   006-039: ISC específico y ad valorem for products (alcohol, tobacco, etc.)
 *
 * Type-specific applicability (from PDF obligation table):
 *   E-31/32/33/34/45: codes 001-039 allowed at item level
 *   E-44:             codes 001-005 ONLY (footnote 18/19 — ISC específico no aplica)
 *   E-41/43/46/47:   TablaImpuestoAdicional FORBIDDEN at item level (obligation code 0)
 *
 * ISC específico (006-039) requires CantidadReferencia + UnidadReferencia when present.
 * TablaSubcantidad is NOT mandatory — only used for multi-unit packages.
 *
 * Note: ISC amount math validation (footnotes 24-26) requires a quarterly-updated
 * rate table from DGII. Structural checks (presence/codes) are implemented here.
 */
const VALID_ISC_CODES = new Set<string>(
  Array.from({ length: 39 }, (_, i) => String(i + 1).padStart(3, '0'))
)
const ISC_PRODUCT_CODES = new Set<string>(                      // 006-039
  Array.from({ length: 34 }, (_, i) => String(i + 6).padStart(3, '0'))
)
const ISC_FORBIDDEN_TYPES = new Set<InvoiceType>(['E-41', 'E-43', 'E-46', 'E-47'])

function checkISCProductFields(
  item: Element,
  lineaNum: number,
  invoiceType: InvoiceType,
  lines: XmlLine[],
  fechaEmision: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const baseLine = findItemLine(lineaNum, lines)

  // ── CantidadReferencia / UnidadReferencia pairing ──────────────────────────
  // Both optional, but must always appear together (no unit = uninterpretable qty).
  // Also: UnidadReferencia uses UnidadMedidaType (codes 1-62), same as UnidadMedida.
  const cantidadRefEl = item.querySelector(':scope > CantidadReferencia')
  const unidadRefEl   = item.querySelector(':scope > UnidadReferencia')
  const hasCantidad   = !!cantidadRefEl
  const hasUnidad     = !!unidadRefEl

  if (hasCantidad && !hasUnidad) {
    issues.push({
      id: nextId(), severity: 'yellow', field: 'UnidadReferencia', line: baseLine,
      message: `Ítem ${lineaNum}: CantidadReferencia está presente pero falta UnidadReferencia. Ambos campos deben aparecer juntos.`,
    })
  } else if (hasUnidad && !hasCantidad) {
    issues.push({
      id: nextId(), severity: 'yellow', field: 'CantidadReferencia', line: baseLine,
      message: `Ítem ${lineaNum}: UnidadReferencia está presente pero falta CantidadReferencia. Ambos campos deben aparecer juntos.`,
    })
  }

  // Validate UnidadReferencia code (1-62, same table as UnidadMedida)
  if (unidadRefEl) {
    const urCode = parseInt(unidadRefEl.textContent?.trim() ?? '', 10)
    if (isNaN(urCode) || urCode < 1 || urCode > 62) {
      issues.push({
        id: nextId(), severity: 'red', field: 'UnidadReferencia', line: baseLine,
        message: `Ítem ${lineaNum}: UnidadReferencia tiene código inválido: "${unidadRefEl.textContent?.trim()}". Usa los mismos códigos 1–62 de la Tabla IV de DGII que UnidadMedida.`,
      })
    }
  }

  // ── TablaImpuestoAdicional (item-level) ────────────────────────────────────
  const tabla = item.querySelector(':scope > TablaImpuestoAdicional')

  // Forbidden for E-41, E-43, E-46, E-47 (obligation code 0 = no aplica)
  if (tabla && ISC_FORBIDDEN_TYPES.has(invoiceType)) {
    issues.push({
      id: nextId(), severity: 'red', field: 'TablaImpuestoAdicional', line: baseLine,
      message: `Ítem ${lineaNum}: TablaImpuestoAdicional no aplica para ${invoiceType}. Este campo es exclusivo de E-31/32/33/34/44/45. DGII rechazará el documento con "element is not expected".`,
    })
    return issues
  }

  if (!tabla) return issues

  let hasISCProduct = false

  tabla.querySelectorAll('TipoImpuesto').forEach(el => {
    const val = el.textContent?.trim() ?? ''
    if (!val) return

    // Enum validation: must be 001-039
    if (!VALID_ISC_CODES.has(val)) {
      issues.push({
        id: nextId(), severity: 'red', field: 'TipoImpuesto', line: baseLine,
        message: `Ítem ${lineaNum}: TipoImpuesto "${val}" es inválido. Los valores aceptados son 001–039 según la Tabla I de Codificación de Tipos de Impuestos Adicionales del Formato eCF.`,
      })
      return
    }

    // TasaImpuestoAdicional rate validation against DGII quarterly resolution
    // Applies to codes 006–022 (ISC específico alcohol) per PDF field 106 validation rule.
    const tasaEl = el.closest('ImpuestoAdicional')?.querySelector('TasaImpuestoAdicional')
    if (tasaEl && ISC_ALCOHOL_CODES.has(val)) {
      const tasaDeclared = parseFloat(tasaEl.textContent?.trim() ?? '')
      if (!isNaN(tasaDeclared)) {
        const result = validateTasaISC(val, tasaDeclared, fechaEmision)
        if (result.status === 'mismatch') {
          issues.push({
            id: nextId(), severity: 'orange', field: 'TasaImpuestoAdicional', line: baseLine,
            message: `Ítem ${lineaNum}: TasaImpuestoAdicional (${tasaDeclared.toFixed(2)}) no coincide con la tasa vigente para el período de la FechaEmision — se esperan ${result.expected.toFixed(2)} RD$/L según ${result.resolution}. Esta tasa varía trimestralmente por inflación.`,
          })
        } else if (result.status === 'unconfirmed') {
          issues.push({
            id: nextId(), severity: 'blue', field: 'TasaImpuestoAdicional', line: baseLine,
            message: `Ítem ${lineaNum}: La tasa ISC para el período ${result.key} (${result.resolution}) no está confirmada en nuestra tabla. Verifica contra la resolución DDG-AR1 vigente en dgii.gov.do/legislacion/resoluciones/.`,
          })
        } else if (result.status === 'period_unknown') {
          issues.push({
            id: nextId(), severity: 'blue', field: 'TasaImpuestoAdicional', line: baseLine,
            message: `Ítem ${lineaNum}: No se encontró la tasa ISC para el período ${result.key}. Verifica la resolución DDG-AR1 correspondiente en dgii.gov.do/legislacion/resoluciones/.`,
          })
        }
      }
    }

    // E-44: only codes 001-005 allowed (footnote 18/19 — ISC específico no aplica)
    if (invoiceType === 'E-44' && ISC_PRODUCT_CODES.has(val)) {
      issues.push({
        id: nextId(), severity: 'red', field: 'TipoImpuesto', line: baseLine,
        message: `Ítem ${lineaNum}: TipoImpuesto "${val}" (código ISC específico 006–039) no aplica para E-44 (Regímenes Especiales). E-44 solo admite códigos 001–005 (Otros Impuestos Adicionales). Ver nota 18 del Formato eCF.`,
      })
      return
    }

    if (ISC_PRODUCT_CODES.has(val)) hasISCProduct = true
  })

  // ISC específico (006-039) requires CantidadReferencia + UnidadReferencia
  if (hasISCProduct) {
    if (!hasCantidad) {
      issues.push({
        id: nextId(), severity: 'red', field: 'CantidadReferencia', line: baseLine,
        message: `Ítem ${lineaNum}: CantidadReferencia es obligatorio cuando el ítem tiene códigos ISC específicos (006–039) en TablaImpuestoAdicional. DGII necesita esta cantidad para calcular el impuesto selectivo al consumo.`,
      })
    }
    if (!hasUnidad) {
      issues.push({
        id: nextId(), severity: 'red', field: 'UnidadReferencia', line: baseLine,
        message: `Ítem ${lineaNum}: UnidadReferencia es obligatorio cuando el ítem tiene códigos ISC específicos (006–039) en TablaImpuestoAdicional.`,
      })
    }
  }

  return issues
}

// ── TipoSubDescuento / TipoSubRecargo enum ────────────────────────────────────

/**
 * TipoDescuentoRecargoType (XSD): only '$' (monto fijo) or '%' (porcentaje).
 * Applies to TipoSubDescuento (inside TablaSubDescuento) and
 *           TipoSubRecargo  (inside TablaSubRecargo).
 */
function checkTipoDescuentoRecargo(
  item: Element,
  lineaNum: number,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const baseLine = findItemLine(lineaNum, lines)
  const valid = new Set(['$', '%'])

  const check = (fieldName: string, el: Element | null) => {
    if (!el) return
    const v = el.textContent?.trim() ?? ''
    if (v && !valid.has(v)) {
      issues.push({
        id: nextId(), severity: 'red',
        field: fieldName,
        line: baseLine,
        message: `Ítem ${lineaNum}: ${fieldName} "${v}" es inválido. Los únicos valores permitidos por el esquema XSD son "$" (monto fijo) o "%" (porcentaje).`,
      })
    }
  }

  item.querySelectorAll(':scope > TablaSubDescuento SubDescuento').forEach(sub =>
    check('TipoSubDescuento', sub.querySelector('TipoSubDescuento'))
  )
  item.querySelectorAll(':scope > TablaSubRecargo SubRecargo').forEach(sub =>
    check('TipoSubRecargo', sub.querySelector('TipoSubRecargo'))
  )

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

  // Extract FechaEmision once — needed for ISC rate period lookup
  const fechaEmision = doc.querySelector('FechaEmision')?.textContent?.trim() ?? ''

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
    issues.push(...checkTipoDescuentoRecargo(item, lineaNum, lines))
    issues.push(...checkISCProductFields(item, lineaNum, invoiceType, lines, fechaEmision))

    // Per-item NombreItem max-length (validateMaxLengths only checks first occurrence)
    const nombreEl = item.querySelector(':scope > NombreItem')
    if (nombreEl) {
      const nombre = nombreEl.textContent?.trim() ?? ''
      if (nombre.length > 80) {
        issues.push({
          id: nextId(), severity: 'red',
          field: 'NombreItem',
          line: findItemLine(lineaNum, lines),
          message: `Ítem ${lineaNum}: NombreItem excede el máximo de 80 caracteres (actual: ${nombre.length}). DGII rechazará el documento con error de estructura XML.`,
        })
      }
    }

    const mathIssue = checkMontoItem(item, lineaNum, lines)
    if (mathIssue) issues.push(mathIssue)
  }

  // 3. Retention totals vs sum of per-item MontoITBISRetenido/MontoISRRetenido
  issues.push(...checkRetentionTotals(items, raw, lines))

  // 4. Sum of items vs header totals (document-level)
  issues.push(...checkItemSumVsHeader(items, raw, lines))

  return issues
}

/** Reset the item check ID counter (call at start of each validation run). */
export function resetItemCounter(): void {
  _itemCounter = 0
}